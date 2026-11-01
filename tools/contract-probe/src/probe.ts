/**
 * Read-only contract probe against a live Open WebUI server.
 *
 *   npm run probe -- [--url http://127.0.0.1:3003] [--env ~/.config/maviechat/owui-test.env] [--no-fixtures] [--write]
 *
 * Without a test account it checks only the public endpoints. With one it signs in,
 * reads config, models, the chat list and one saved chat's tree, joins the socket,
 * then signs out again (revoking the token). It sends no other writes unless --write
 * is given: then it also runs the chat actions on a throwaway "APP PROBE:" chat in the
 * test account and deletes it afterwards (src/write-probe.ts).
 *
 * It never prints or stores tokens, passwords, emails or message text: fixtures
 * hold response shapes, counts and feature flags only (fixtures/<server version>/).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildCapabilities,
  FEATURES,
  getConfig,
  getSessionUser,
  getVersion,
  openSocketSession,
  OwuiClient,
  signIn,
  signOut,
  type Capabilities,
  type FeatureId,
  type ServerConfig,
} from '@maviechat/owui-protocol';
import { DEFAULT_ENV_FILE, loadEnvFile } from './env';
import { shapeOf } from './shape';
import { summarizeTree } from './tree-summary';
import { probeChatActions } from './write-probe';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    env: { type: 'string' },
    'no-fixtures': { type: 'boolean' },
    write: { type: 'boolean' },
  },
});

interface StepResult {
  name: string;
  ok: boolean;
  note: string;
}

const results: StepResult[] = [];
const fixtures: Record<string, unknown> = {};

async function step<T>(name: string, run: () => Promise<{ value: T; note: string }>): Promise<T | undefined> {
  try {
    const { value, note } = await run();
    results.push({ name, ok: true, note });
    return value;
  } catch (error) {
    results.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

function scalarFeatures(config: ServerConfig): Record<string, boolean | number> {
  const out: Record<string, boolean | number> = {};
  for (const [key, value] of Object.entries(config.features ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (typeof value === 'boolean' || typeof value === 'number') out[key] = value;
  }
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  const envFile = args.env ?? DEFAULT_ENV_FILE;
  const env = loadEnvFile(envFile) ?? {};
  const baseUrl = args.url ?? env.OWUI_URL ?? 'http://127.0.0.1:3003';
  const anonymous = new OwuiClient({ baseUrl });

  const version = await step('GET /api/version', async () => {
    const value = await getVersion(anonymous);
    fixtures.version = { version: value.version, shape: shapeOf(value) };
    return { value, note: value.version };
  });

  await step('GET /api/config (anonymous)', async () => {
    const value = await getConfig(anonymous);
    fixtures['config.anonymous'] = { shape: shapeOf(value), features: scalarFeatures(value) };
    return { value, note: `${Object.keys(value.features ?? {}).length} feature keys` };
  });

  const email = env.OWUI_EMAIL;
  const password = env.OWUI_PASSWORD;
  if (!email || !password) {
    results.push({ name: 'signed-in checks', ok: true, note: `skipped: no OWUI_EMAIL/OWUI_PASSWORD in ${envFile}` });
  } else {
    const session = await step('POST /api/v1/auths/signin', async () => {
      const result = await signIn(anonymous, email, password);
      if (result.kind !== 'session') {
        throw new Error(`sign-in answered "${result.kind}": the test account must be an approved user without two-step sign-in`);
      }
      fixtures.signin = { kind: result.kind, shape: shapeOf(result.session) };
      return { value: result.session, note: `role ${result.session.role}` };
    });

    if (session) {
      const client = anonymous.withToken(session.token);
      let capabilities: Capabilities | undefined;

      const user = await step('GET /api/v1/auths/', async () => {
        const value = await getSessionUser(client);
        fixtures['auths.session'] = { shape: shapeOf(value) };
        return { value, note: `expires_at ${value.expires_at ? 'set' : 'none'}` };
      });

      await step('GET /api/config (signed in)', async () => {
        const value = await getConfig(client);
        capabilities = buildCapabilities({ config: value, user: user ?? session, version: version?.version });
        const features = Object.fromEntries(
          (Object.keys(FEATURES) as FeatureId[]).map((id) => [id, capabilities?.feature(id) ?? false]),
        );
        fixtures['config.signed-in'] = { shape: shapeOf(value), features: scalarFeatures(value) };
        fixtures.capabilities = {
          support: capabilities.support,
          isAdmin: capabilities.isAdmin,
          websocketOnly: capabilities.websocketOnly,
          heartbeatIntervalSec: capabilities.heartbeatIntervalSec,
          features,
        };
        return { value, note: `support ${capabilities.support}` };
      });

      await step('GET /api/models', async () => {
        const value = await client.get<{ data?: unknown[] }>('/api/models');
        const list = value.data ?? [];
        fixtures.models = { count: list.length, shape: shapeOf(value) };
        if (list.length === 0) throw new Error('the test account sees no models: give it access to at least one');
        return { value: list, note: `${list.length} visible` };
      });

      const chats = await step('GET /api/v1/chats/?page=1', async () => {
        const value = await client.get<unknown[]>('/api/v1/chats/', { query: { page: 1 } });
        fixtures['chats.list'] = { count: value.length, shape: shapeOf(value) };
        return { value, note: `${value.length} on page 1` };
      });

      const first = chats?.[0] as { id?: unknown } | undefined;
      if (typeof first?.id === 'string') {
        const chatId = first.id;
        await step('GET /api/v1/chats/{id}', async () => {
          const value = await client.get<Record<string, unknown>>(`/api/v1/chats/${chatId}`);
          const tree = summarizeTree(value);
          fixtures.chat = { tree, shape: shapeOf(value) };
          return { value, note: `${tree.messageCount} messages, ${tree.branchPoints} branch points` };
        });
      } else {
        results.push({ name: 'GET /api/v1/chats/{id}', ok: true, note: 'skipped: the test account has no chats yet' });
      }

      await step('socket connect + user-join', async () => {
        const socket = openSocketSession({
          baseUrl,
          token: session.token,
          expectedUserId: session.id,
          websocketOnly: capabilities?.websocketOnly,
          heartbeatIntervalSec: capabilities?.heartbeatIntervalSec,
        });
        try {
          const joined = await withTimeout(socket.joined, 15_000, 'user-join');
          fixtures.socket = {
            joined: true,
            sameUser: joined.id === session.id,
            transport: capabilities?.websocketOnly === false ? 'polling+websocket' : 'websocket',
          };
          return { value: joined, note: 'joined as the signed-in user' };
        } finally {
          socket.close();
        }
      });

      if (args.write) {
        const writeSteps = await probeChatActions(client, { canDelete: capabilities?.can('chat.delete') ?? false });
        for (const result of writeSteps) results.push({ ...result, name: `write: ${result.name}` });
        fixtures['write.chat-actions'] = Object.fromEntries(writeSteps.map((result) => [result.name, result.ok]));
      }

      await step('POST /api/v1/auths/signout', async () => {
        await signOut(client);
        return { value: true, note: 'probe token revoked' };
      });
    }
  }

  const label = version?.version ?? 'unknown';
  const dir = path.resolve(import.meta.dirname, '..', 'fixtures', label);
  if (!args['no-fixtures'] && Object.keys(fixtures).length > 0) {
    mkdirSync(dir, { recursive: true });
    for (const [name, data] of Object.entries(fixtures)) {
      writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
    }
  }

  for (const result of results) console.log(`${result.ok ? '✓' : '✗'} ${result.name}${result.note ? ` — ${result.note}` : ''}`);
  if (!args['no-fixtures']) console.log(`fixtures: ${path.relative(process.cwd(), dir)}`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

void main();
