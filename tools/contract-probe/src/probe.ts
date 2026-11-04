/**
 * Read-only contract probe against a live Open WebUI server.
 *
 *   npm run probe -- [--url http://127.0.0.1:3003] [--env ~/.config/maviechat/owui-test.env] [--no-fixtures] [--write] [--a2] [--a3] [--a4] [--a5] [--a6] [--a8] [--m3] [--m3text]
 *
 * Without a test account it checks only the public endpoints. With one it signs in,
 * reads config, models, the chat list and one saved chat's tree, joins the socket,
 * then signs out again (revoking the token). It sends no other writes unless --write
 * is given: then it also runs the chat actions on a throwaway "APP PROBE:" chat in the
 * test account and deletes it afterwards (src/write-probe.ts). `--a2` runs only milestone 2's
 * reply checks (edit, save as copy, continue, rating, actions; src/a2-probe.ts). `--a3` runs
 * the chat controls checks (system prompt, params, files, streaming off, Overview, valves;
 * src/a3-probe.ts). `--a4` sends one message to two models and merges the answers
 * (src/a4-probe.ts; `OWUI_PROBE_MODEL_2`, in the env file or the environment, picks the second
 * model, else the first answers twice). `--a5` has the model ask a question with its `ask_user`
 * tool and answers it as the app does (src/a5-probe.ts). `--a6` tags, shares, clones and forks a
 * probe chat made without a model, and builds the downloads (src/a6-probe.ts).
 * `--a8` saves settings the app's way and puts them back exactly (src/a8-probe.ts), then tries
 * memories, the profile, your variables, a refused password change and an API key (src/a8-account-probe.ts),
 * and the data controls: export, import, shared chats and files (src/a8-data-probe.ts).
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
  modelImagePath,
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
import { probeSend } from './send-probe';
import { probeSlice3 } from './slice3-probe';
import { probeSlice4 } from './slice4-probe';
import { probeA2 } from './a2-probe';
import { probeA3 } from './a3-probe';
import { probeA4 } from './a4-probe';
import { probeA5 } from './a5-probe';
import { probeA6 } from './a6-probe';
import { probeA8Account } from './a8-account-probe';
import { probeA8Data } from './a8-data-probe';
import { probeA8 } from './a8-probe';
import { probeM3Models } from './m3-models-probe';
import { probeM3Text } from './m3-text-probe';
import { probeChatActions } from './write-probe';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    env: { type: 'string' },
    'no-fixtures': { type: 'boolean' },
    write: { type: 'boolean' },
    a2: { type: 'boolean' },
    a3: { type: 'boolean' },
    a4: { type: 'boolean' },
    a5: { type: 'boolean' },
    a6: { type: 'boolean' },
    a8: { type: 'boolean' },
    m3: { type: 'boolean' },
    m3text: { type: 'boolean' },
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
      let serverConfig: ServerConfig | undefined;

      const user = await step('GET /api/v1/auths/', async () => {
        const value = await getSessionUser(client);
        fixtures['auths.session'] = { shape: shapeOf(value) };
        return { value, note: `expires_at ${value.expires_at ? 'set' : 'none'}` };
      });

      await step('GET /api/config (signed in)', async () => {
        const value = await getConfig(client);
        serverConfig = value;
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

      const models = await step('GET /api/models', async () => {
        const value = await client.get<{ data?: unknown[] }>('/api/models');
        const list = value.data ?? [];
        fixtures.models = { count: list.length, shape: shapeOf(value) };
        if (list.length === 0) throw new Error('the test account sees no models: give it access to at least one');
        return { value: list, note: `${list.length} visible` };
      });

      // The picture the app shows beside a model: the image itself, or a redirect (the server's logo or a linked image).
      const firstModelId = (models?.[0] as { id?: unknown } | undefined)?.id;
      if (typeof firstModelId === 'string') {
        await step('GET /api/v1/models/model/profile/image', async () => {
          const response = await fetch(`${client.baseUrl}${modelImagePath(firstModelId)}`, {
            headers: { Authorization: `Bearer ${client.token ?? ''}` },
            redirect: 'manual',
          });
          await response.body?.cancel();
          const location = response.headers.get('location');
          const target = location ? new URL(location, client.baseUrl) : null;
          const note =
            response.status === 200
              ? `image (${response.headers.get('content-type') ?? 'no type'})`
              : target
                ? `redirect to ${target.origin === new URL(client.baseUrl).origin ? target.pathname : 'an external image'}`
                : null;
          if (!note || ![200, 302, 307].includes(response.status)) throw new Error(`answered ${response.status}`);
          fixtures['models.profile-image'] = { status: response.status, kind: response.status === 200 ? 'image' : 'redirect' };
          return { value: response.status, note };
        });
      }

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

      if (args.a2 && capabilities) {
        const a2 = await probeA2({
          client,
          baseUrl,
          token: session.token,
          userId: session.id,
          userName: session.name,
          capabilities,
          canDelete: capabilities.can('chat.delete'),
          modelId: env.OWUI_PROBE_MODEL,
        });
        for (const result of a2.steps) results.push({ ...result, name: `A2: ${result.name}` });
        fixtures['write.a2'] = a2.fixture;
      }

      if (args.a3 && capabilities) {
        const a3 = await probeA3({
          client,
          baseUrl,
          token: session.token,
          userId: session.id,
          userName: session.name,
          capabilities,
          canDelete: capabilities.can('chat.delete'),
          modelId: env.OWUI_PROBE_MODEL,
        });
        for (const result of a3.steps) results.push({ ...result, name: `A3: ${result.name}` });
        fixtures['write.a3'] = a3.fixture;
      }

      if (args.a4 && capabilities) {
        const a4 = await probeA4({
          client,
          baseUrl,
          token: session.token,
          userId: session.id,
          userName: session.name,
          capabilities,
          canDelete: capabilities.can('chat.delete'),
          modelId: env.OWUI_PROBE_MODEL,
          secondModelId: env.OWUI_PROBE_MODEL_2 ?? process.env.OWUI_PROBE_MODEL_2,
        });
        for (const result of a4.steps) results.push({ ...result, name: `A4: ${result.name}` });
        fixtures['write.a4'] = a4.fixture;
      }

      if (args.a5 && capabilities) {
        const a5 = await probeA5({
          client,
          baseUrl,
          token: session.token,
          userId: session.id,
          userName: session.name,
          capabilities,
          canDelete: capabilities.can('chat.delete'),
          modelId: env.OWUI_PROBE_MODEL,
        });
        for (const result of a5.steps) results.push({ ...result, name: `A5: ${result.name}` });
        fixtures['write.a5'] = a5.fixture;
      }

      if (args.a6 && capabilities) {
        const a6 = await probeA6({ client, baseUrl, userId: session.id, capabilities, canDelete: capabilities.can('chat.delete') });
        for (const result of a6.steps) results.push({ ...result, name: `A6: ${result.name}` });
        fixtures['write.a6'] = a6.fixture;
      }

      if (args.a8 && capabilities) {
        const a8 = await probeA8({ client, capabilities });
        for (const result of a8.steps) results.push({ ...result, name: `A8: ${result.name}` });
        fixtures['write.a8'] = a8.fixture;
        const account = await probeA8Account({ client, capabilities, config: serverConfig });
        for (const result of account.steps) results.push({ ...result, name: `A8: ${result.name}` });
        fixtures['write.a8-account'] = account.fixture;
        const data = await probeA8Data({ client, capabilities });
        for (const result of data.steps) results.push({ ...result, name: `A8: ${result.name}` });
        fixtures['write.a8-data'] = data.fixture;
      }

      if (args.m3 && capabilities) {
        const m3 = await probeM3Models({ client, capabilities });
        for (const result of m3.steps) results.push({ ...result, name: `M3: ${result.name}` });
        fixtures['write.m3-models'] = m3.fixture;
      }

      if (args.m3text && capabilities) {
        const m3text = await probeM3Text({ client, capabilities });
        for (const result of m3text.steps) results.push({ ...result, name: `M3: ${result.name}` });
        fixtures['write.m3-text'] = m3text.fixture;
      }

      if (args.write) {
        const canDelete = capabilities?.can('chat.delete') ?? false;
        const writeSteps = await probeChatActions(client, { canDelete });
        for (const result of writeSteps) results.push({ ...result, name: `write: ${result.name}` });
        fixtures['write.chat-actions'] = Object.fromEntries(writeSteps.map((result) => [result.name, result.ok]));

        if (capabilities) {
          const sendReport = await probeSend({
            client,
            baseUrl,
            token: session.token,
            userId: session.id,
            userName: session.name,
            capabilities,
            canDelete,
            modelId: env.OWUI_PROBE_MODEL,
          });
          for (const result of sendReport.steps) results.push({ ...result, name: `send: ${result.name}` });
          fixtures['write.send'] = { steps: Object.fromEntries(sendReport.steps.map((s) => [s.name.replace(/ to .*/, ''), s.ok])), ...sendReport.fixture };

          const slice3 = await probeSlice3({
            client,
            baseUrl,
            token: session.token,
            userId: session.id,
            userName: session.name,
            capabilities,
            canDelete,
            modelId: env.OWUI_PROBE_MODEL,
          });
          for (const result of slice3.steps) results.push({ ...result, name: `slice 3: ${result.name}` });
          fixtures['write.slice3'] = slice3.fixture;

          const slice4 = await probeSlice4({
            client,
            baseUrl,
            token: session.token,
            userId: session.id,
            capabilities,
            canDelete,
            modelId: env.OWUI_PROBE_MODEL,
          });
          for (const result of slice4.steps) results.push({ ...result, name: `slice 4: ${result.name}` });
          fixtures['write.slice4'] = slice4.fixture;
        }
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
