import { createServer } from 'node:http';
import path from 'node:path';
import { createRelay } from './relay.ts';
import { DeviceStore } from './store.ts';

const MAX_BODY = 1024 * 1024;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const eventsSecret = required('EVENTS_SECRET');
if (eventsSecret.length < 32) throw new Error('EVENTS_SECRET must be at least 32 characters');

const handle = createRelay(
  { eventsSecret, owuiUrl: required('OWUI_URL') },
  new DeviceStore(path.join(process.env.DATA_DIR ?? '/data', 'devices.json')),
  (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
);

const server = createServer((request, response) => {
  const started = Date.now();
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;

  const reply = (status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
    // Never logs the events secret, tokens or message text.
    const shown = (request.url ?? '').split('?')[0]?.replace(/^\/v1\/events\/.*/, '/v1/events/…');
    console.log(`${request.method} ${shown} ${status} ${Date.now() - started}ms`);
  };

  request.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY) tooLarge = true;
    else chunks.push(chunk);
  });
  request.on('end', () => {
    if (tooLarge) return reply(413, { error: 'Too large' });
    // Traefik is the only way in, so its X-Forwarded-For names the caller.
    const forwarded = String(request.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim();
    handle({
      method: request.method ?? 'GET',
      path: (request.url ?? '/').split('?')[0] ?? '/',
      authorization: request.headers.authorization,
      body: Buffer.concat(chunks).toString('utf8'),
      ip: forwarded || request.socket.remoteAddress || 'unknown',
    })
      .then((result) => reply(result.status, result.body))
      .catch(() => reply(500, { error: 'Relay error' }));
  });
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => console.log(`push relay listening on ${port}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.close(() => process.exit(0)));
