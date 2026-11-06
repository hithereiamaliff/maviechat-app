import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callerAddress, createAdmin, createGateway, privateAddress, type GatewayConfig } from './gateway.ts';
import { ASK_BEFORE_CHANGES } from './rules.ts';
import { DeviceStore } from './store.ts';
import type { Watcher } from './watch.ts';

interface Seen {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

function readAll(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    request.on('data', (chunk) => (text += chunk));
    request.on('end', () => resolve(text));
  });
}

let upstream: Server;
let gateway: Server;
let admin: Server;
let base = '';
let adminBase = '';
let seen: Seen[] = [];
let logs: string[] = [];
let store: DeviceStore;
// What the gateway asked the notification watcher to do.
let watched: { deviceId: string; pushToken: string; loginId: string; sessionId: string; directory: string }[] = [];
let unwatched: string[] = [];
let forgotten: string[] = [];
const watcher = {
  watch: (input: (typeof watched)[number]) => {
    watched.push(input);
    return () => unwatched.push(input.sessionId);
  },
  forgetDevice: (deviceId: string) => forgotten.push(deviceId),
} as unknown as Watcher;

beforeEach(async () => {
  seen = [];
  logs = [];
  watched = [];
  unwatched = [];
  forgotten = [];
  // A stand-in OpenCode server with Basic auth.
  upstream = createServer((request, response) => {
    void readAll(request).then((body) => {
      seen.push({ method: request.method ?? '', url: request.url ?? '', authorization: request.headers.authorization, body });
      if (request.headers.authorization !== `Basic ${Buffer.from('opencode:secret-pw').toString('base64')}`) {
        response.writeHead(401).end();
        return;
      }
      if (request.url?.startsWith('/global/health')) return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ healthy: true, version: '1.19.3' }));
      if (request.url?.startsWith('/event')) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write('data: {"type":"server.connected","properties":{}}\n\n');
        response.write('data: {"type":"integration.updated","properties":{"token":"secret-thing"}}\n\n');
        response.write('data: {"type":"session.idle","properties":{"sessionID":"ses_1"}}\n\n');
        return;
      }
      if (request.method === 'POST' && request.url?.startsWith('/session?')) return response.writeHead(200, { 'Content-Type': 'application/json' }).end(body);
      if (request.url?.startsWith('/session/ses_broken/')) return response.writeHead(500, { 'Content-Type': 'application/json' }).end('{}');
      if (request.method === 'PATCH' && request.url?.startsWith('/global/config')) {
        if (body.includes('broken')) return response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'write failed near sk-mcp-secret' }));
        const saved = { ...(JSON.parse(body) as object), mcp: { exa: { type: 'remote', headers: { 'x-api-key': 'sk-mcp-secret' } } } };
        return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(saved));
      }
      if (request.url?.startsWith('/config?')) {
        if (request.url.includes('broken')) return response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'mcp exa: x-api-key sk-mcp-secret rejected' }));
        const settings = { model: 'opencode-go/glm-5.2', small_model: 'opencode-go/glm-5.2', mcp: { exa: { type: 'remote', url: 'https://mcp.example.com', headers: { 'x-api-key': 'sk-mcp-secret' } } }, provider: { openai: { options: { apiKey: 'sk-mcp-secret' } } } };
        return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(settings));
      }
      if (request.url?.startsWith('/config/providers')) {
        return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ providers: [{ id: 'p', name: 'P', key: 'sk-live-secret', options: { apiKey: 'sk-live-secret' }, models: {} }], default: {} }));
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([{ id: 'ses_1' }]));
    });
  });
  const upstreamUrl = await listen(upstream);
  const config: GatewayConfig = {
    machineName: 'my-server',
    publicUrl: 'https://code.example.com',
    folders: ['/home/dev/work', '/srv/projects'],
    logins: [{ id: 'root', name: 'OpenCode', url: upstreamUrl, username: 'opencode', password: 'secret-pw' }],
    log: (line) => logs.push(line),
  };
  store = new DeviceStore(null);
  const handle = createGateway(config, store, (input, init) => fetch(input, init), Date.now, watcher);
  const handleAdmin = createAdmin(config, store, watcher);
  gateway = createServer((request, response) => void handle(request, response));
  admin = createServer((request, response) => void handleAdmin(request, response));
  base = await listen(gateway);
  adminBase = await listen(admin);
});

afterEach(() => {
  for (const server of [gateway, admin, upstream]) server.closeAllConnections();
  for (const server of [gateway, admin, upstream]) server.close();
});

async function pair(): Promise<string> {
  const link = (await (await fetch(`${adminBase}/admin/pair`, { method: 'POST' })).json()) as { code: string; link: string };
  expect(link.link).toBe(`maviechat://pair?url=${encodeURIComponent('https://code.example.com')}&code=${encodeURIComponent(link.code)}`);
  const answer = await fetch(`${base}/v1/pair`, { method: 'POST', body: JSON.stringify({ code: link.code, deviceName: 'Test iPhone' }) });
  expect(answer.status).toBe(200);
  const paired = (await answer.json()) as { token: string; machine: { name: string } };
  expect(paired.machine.name).toBe('my-server');
  return paired.token;
}

const authed = (token: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });

describe('opencode gateway', () => {
  it('pairs a phone once per code, and refuses other codes', async () => {
    const link = (await (await fetch(`${adminBase}/admin/pair`, { method: 'POST' })).json()) as { code: string };
    const first = await fetch(`${base}/v1/pair`, { method: 'POST', body: JSON.stringify({ code: link.code, deviceName: 'A' }) });
    expect(first.status).toBe(200);
    const again = await fetch(`${base}/v1/pair`, { method: 'POST', body: JSON.stringify({ code: link.code, deviceName: 'B' }) });
    expect(again.status).toBe(401);
    const wrong = await fetch(`${base}/v1/pair`, { method: 'POST', body: JSON.stringify({ code: 'not-a-code' }) });
    expect(wrong.status).toBe(401);
  });

  it('needs a paired token for everything else, and locks out guessing', async () => {
    expect((await fetch(`${base}/v1/machine`)).status).toBe(401);
    expect((await fetch(`${base}/v1/machine`, authed('nope'))).status).toBe(401);
    for (let i = 0; i < 8; i++) await fetch(`${base}/v1/machine`, authed(`guess-${i}`));
    expect((await fetch(`${base}/v1/machine`, authed('one-more'))).status).toBe(429);
  });

  it('describes the machine and its OpenCode logins', async () => {
    const token = await pair();
    const machine = (await (await fetch(`${base}/v1/machine`, authed(token))).json()) as Record<string, unknown>;
    expect(machine).toMatchObject({ name: 'my-server', folders: ['/home/dev/work', '/srv/projects'], logins: [{ id: 'root', name: 'OpenCode', version: '1.19.3', online: true }] });
  });

  it('forwards allowed requests with OpenCode’s password, never the phone’s token', async () => {
    const token = await pair();
    const answer = await fetch(`${base}/v1/oc/root/session?directory=${encodeURIComponent('/home/dev/work/app')}&roots=true`, authed(token));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual([{ id: 'ses_1' }]);
    const request = seen.at(-1);
    expect(request?.url).toBe(`/session?directory=${encodeURIComponent('/home/dev/work/app')}&roots=true`);
    expect(request?.authorization).toBe(`Basic ${Buffer.from('opencode:secret-pw').toString('base64')}`);
    // The logs carry no query strings or tokens.
    expect(logs.join('\n')).not.toContain('directory=');
    expect(logs.join('\n')).not.toContain(token);
  });

  it('refuses projects outside the folders, paths outside the project, other routes and unknown logins', async () => {
    const token = await pair();
    const count = seen.length;
    expect((await fetch(`${base}/v1/oc/root/session?directory=/etc`, authed(token))).status).toBe(403);
    expect((await fetch(`${base}/v1/oc/root/session`, authed(token))).status).toBe(403);
    expect((await fetch(`${base}/v1/oc/root/file?directory=/home/dev/work/app&path=../../.ssh`, authed(token))).status).toBe(403);
    expect((await fetch(`${base}/v1/oc/root/session/ses_1/shell?directory=/home/dev/work/app`, authed(token, { method: 'POST', body: '{}' }))).status).toBe(404);
    expect((await fetch(`${base}/v1/oc/other/session?directory=/home/dev/work/app`, authed(token))).status).toBe(404);
    expect(seen.length).toBe(count);
  });

  it('starts sessions that ask before changes, unless the phone turned approvals off', async () => {
    const token = await pair();
    const asked = await fetch(`${base}/v1/oc/root/session?directory=/home/dev/work/app`, authed(token, { method: 'POST', body: JSON.stringify({ title: 'Fix it' }) }));
    expect(await asked.json()).toEqual({ title: 'Fix it', permission: ASK_BEFORE_CHANGES });
    const free = await fetch(
      `${base}/v1/oc/root/session?directory=/home/dev/work/app`,
      authed(token, { method: 'POST', body: JSON.stringify({ title: 'Fix it' }), headers: { 'x-maviechat-approvals': 'off' } }),
    );
    expect(await free.json()).toEqual({ title: 'Fix it' });
  });

  it('passes the event stream straight through', async () => {
    const token = await pair();
    const controller = new AbortController();
    const answer = await fetch(`${base}/v1/oc/root/event?directory=/home/dev/work/app`, authed(token, { signal: controller.signal }));
    expect(answer.headers.get('content-type')).toContain('text/event-stream');
    const reader = answer.body!.getReader();
    let text = '';
    while (!text.includes('session.idle')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    expect(text).toContain('"type":"server.connected"');
    expect(text).toContain('"type":"session.idle"');
    expect(text).not.toContain('secret-thing');
    controller.abort();
  });

  it('never forwards provider API keys', async () => {
    const token = await pair();
    const text = await (await fetch(`${base}/v1/oc/root/config/providers?directory=/home/dev/work/app`, authed(token))).text();
    expect(text).not.toContain('sk-live-secret');
    expect(JSON.parse(text)).toEqual({ providers: [{ id: 'p', name: 'P', models: {} }], default: {} });
  });

  it('passes on only the default model from the config, even when OpenCode fails', async () => {
    const token = await pair();
    const text = await (await fetch(`${base}/v1/oc/root/config?directory=/home/dev/work/app`, authed(token))).text();
    expect(text).not.toContain('sk-mcp-secret');
    expect(JSON.parse(text)).toEqual({ model: 'opencode-go/glm-5.2' });
    const failed = await fetch(`${base}/v1/oc/root/config?directory=/home/dev/work/broken`, authed(token));
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain('sk-mcp-secret');
  });

  it('changes only the default model in OpenCode’s settings, and answers with only that', async () => {
    const token = await pair();
    const patch = (body: unknown) => fetch(`${base}/v1/oc/root/global/config`, authed(token, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const patches = () => seen.filter((item) => item.method === 'PATCH');
    const answer = await patch({ model: 'opencode-go/deepseek-v4.1-flash', mcp: { evil: { type: 'local', command: ['sh', '-c', 'id'] } } });
    const text = await answer.text();
    expect(answer.status).toBe(200);
    expect(text).not.toContain('sk-mcp-secret');
    expect(JSON.parse(text)).toEqual({ model: 'opencode-go/deepseek-v4.1-flash' });
    expect(JSON.parse(patches().at(-1)?.body ?? '')).toEqual({ model: 'opencode-go/deepseek-v4.1-flash' });
    // Anything but a plain model name is refused before OpenCode sees it.
    const count = patches().length;
    expect((await patch({ model: 'not a model' })).status).toBe(400);
    expect((await patch({ mcp: { evil: {} } })).status).toBe(400);
    expect(patches().length).toBe(count);
    const failed = await patch({ model: 'opencode-go/broken' });
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain('sk-mcp-secret');
    expect((await fetch(`${base}/v1/oc/root/global/config`, authed(token))).status).toBe(404);
  });

  it('watches a prompted session for the phone that sent its push token, and lets go when OpenCode refuses', async () => {
    const token = await pair();
    const prompt = (session: string, headers: Record<string, string>) =>
      fetch(`${base}/v1/oc/root/session/${session}/prompt_async?directory=/home/dev/work/app`, authed(token, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{"parts":[]}' }));
    const pushToken = 'ExponentPushToken[abc123DEF]';
    expect((await prompt('ses_1', { 'x-maviechat-push': pushToken })).status).toBe(200);
    expect(watched).toEqual([{ deviceId: expect.any(String), pushToken, loginId: 'root', sessionId: 'ses_1', directory: '/home/dev/work/app' }]);
    // OpenCode never sees the token.
    expect(seen.at(-1)?.url).toBe('/session/ses_1/prompt_async?directory=/home/dev/work/app');
    // No token, or something that isn't one: no watch.
    await prompt('ses_2', {});
    await prompt('ses_3', { 'x-maviechat-push': 'not-a-token' });
    expect(watched).toHaveLength(1);
    expect((await prompt('ses_broken', { 'x-maviechat-push': pushToken })).status).toBe(500);
    expect(unwatched).toEqual(['ses_broken']);
  });

  it('unpairs a phone: its token stops working', async () => {
    const token = await pair();
    const devices = (await (await fetch(`${base}/v1/devices`, authed(token))).json()) as { id: string; current: boolean }[];
    const self = devices.find((device) => device.current);
    expect(self).toBeDefined();
    expect((await fetch(`${base}/v1/devices/${self?.id}`, authed(token, { method: 'DELETE' }))).status).toBe(200);
    expect((await fetch(`${base}/v1/machine`, authed(token))).status).toBe(401);
    // Its notifications stop too.
    expect(forgotten).toEqual([self?.id]);
  });
});

describe('caller address', () => {
  it('believes X-Forwarded-For only from a proxy on this machine or a private network', () => {
    // A proxy in Docker or on this machine: the address it saw is the last one.
    expect(callerAddress('172.18.0.5', '198.51.100.7')).toBe('198.51.100.7');
    expect(callerAddress('::ffff:172.18.0.5', 'made-up, 198.51.100.7')).toBe('198.51.100.7');
    expect(callerAddress('fd00::2', ['198.51.100.7'])).toBe('198.51.100.7');
    expect(callerAddress('127.0.0.1', undefined)).toBe('127.0.0.1');
    // Straight from the internet the header could be made up, so the connection counts.
    expect(callerAddress('203.0.113.9', '10.0.0.1')).toBe('203.0.113.9');
    expect(callerAddress('2001:db8::1', '198.51.100.7')).toBe('2001:db8::1');
    expect(callerAddress(undefined, '198.51.100.7')).toBe('unknown');
  });

  it('knows loopback and private ranges', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '::1', '::ffff:10.0.0.1', 'fc00::1', 'fd12:3456::1', 'fe80::1']) {
      expect(privateAddress(address)).toBe(true);
    }
    for (const address of ['172.15.0.1', '172.32.0.1', '100.64.0.1', '8.8.8.8', '2001:db8::1', '::ffff:8.8.8.8']) {
      expect(privateAddress(address)).toBe(false);
    }
  });
});
