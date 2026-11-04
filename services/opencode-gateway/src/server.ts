import { createServer } from 'node:http';
import path from 'node:path';
import { loadConfig } from './config.ts';
import { createAdmin, createGateway } from './gateway.ts';
import { DeviceStore } from './store.ts';
import { Watcher } from './watch.ts';

const log = (line: string) => console.log(line);
const config = loadConfig(process.env, log);
const store = new DeviceStore(path.join(process.env.DATA_DIR ?? '/data', 'devices.json'));
// Notifications for sessions started from a phone: it follows each OpenCode login's events.
const watcher = new Watcher({ machineUrl: config.publicUrl, logins: config.logins, fetch: (input, init) => fetch(input, init), log });

const gateway = createGateway(config, store, (input, init) => fetch(input, init), Date.now, watcher);
const admin = createAdmin(config, store, watcher);

const server = createServer((request, response) => {
  gateway(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Gateway error' }));
  });
});
// Event streams stay open as long as the phone listens.
server.requestTimeout = 0;
server.headersTimeout = 30_000;

// Only `maviechat-gateway` inside the container reaches this one.
const adminServer = createServer((request, response) => {
  admin(request, response).catch(() => response.end());
});

const port = Number(process.env.PORT ?? 8080);
const adminPort = Number(process.env.ADMIN_PORT ?? 8081);
server.listen(port, () => {
  log(`opencode gateway listening on ${port} for ${config.machineName}: ${config.logins.length} OpenCode login(s), ${config.folders.length} folder(s)`);
  watcher.start();
});
adminServer.listen(adminPort, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    watcher.stop();
    adminServer.close();
    server.close(() => process.exit(0));
    // Open event streams don't hold up a restart.
    setTimeout(() => process.exit(0), 3000).unref();
  });
