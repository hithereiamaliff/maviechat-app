import { chmodSync, mkdirSync, rmSync } from 'node:fs';
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

// Pairing and unpairing, for `maviechat-gateway` only: a socket that only the gateway's own user
// can open, kept in the container's own files (never in a shared volume or on the network).
const adminSocket = process.env.ADMIN_SOCKET || '/run/maviechat/admin.sock';
try {
  mkdirSync(path.dirname(adminSocket), { recursive: true, mode: 0o700 });
  rmSync(adminSocket, { force: true });
} catch {
  // Listening then fails, and says so in the log (below).
}
const adminServer = createServer((request, response) => {
  admin(request, response).catch(() => response.end());
});

const port = Number(process.env.PORT ?? 8080);
// HOST=127.0.0.1 keeps the gateway to this machine when it shares the host's network behind a proxy.
const host = process.env.HOST || undefined;
const started = () => {
  log(`opencode gateway listening on ${host ?? '*'}:${port} for ${config.machineName}: ${config.logins.length} OpenCode login(s), ${config.folders.length} folder(s)`);
  watcher.start();
};
if (host) server.listen(port, host, started);
else server.listen(port, started);
// A socket that can't open (a read-only container without a tmpfs there) turns off pairing from the
// command line, but never the gateway itself.
adminServer.on('error', (error: NodeJS.ErrnoException) =>
  log(`admin socket unavailable (${error.code ?? 'error'}): maviechat-gateway pair, devices and revoke won't work until ${path.dirname(adminSocket)} is writable (in a read-only container, mount a tmpfs there)`),
);
adminServer.listen(adminSocket, () => chmodSync(adminSocket, 0o600));
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    watcher.stop();
    adminServer.close();
    server.close(() => process.exit(0));
    // Open event streams don't hold up a restart.
    setTimeout(() => process.exit(0), 3000).unref();
  });
