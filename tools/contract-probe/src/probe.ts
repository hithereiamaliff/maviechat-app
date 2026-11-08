/**
 * Read-only contract probe against a live Open WebUI server.
 *
 *   npm run probe -- [--url http://127.0.0.1:3003] [--env ~/.config/maviechat/owui-test.env] [--no-fixtures] [--write] [--a2] [--a3] [--a4] [--a5] [--a6] [--folders] [--newchat] [--attach] [--integrations] [--messages] [--interface] [--search] [--models] [--notes] [--status] [--oauth] [--webhooks] [--eventhooks] [--uidefaults] [--chatvars] [--codeedit] [--sharedfolders --peer-env FILE] [--a8] [--m3] [--m3text] [--m3kb] [--m3tools] [--m4users] [--m4settings] [--m4connections] [--m4models] [--m4forms] [--m4functions] [--m4evaluations] [--m5mfa]
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
 * `--folders` makes, changes, exports and deletes probe folders, with a probe chat inside
 * (src/folders-probe.ts).
 * `--newchat` reads the banners, and pins a model and switches the landing mode in the test
 * account's own settings, then puts them back (src/newchat-probe.ts).
 * `--attach` reads the lists the + menu offers and saves a temporary chat the app's way, then
 * deletes it (src/attach-probe.ts).
 * `--integrations` reads your notes, skills and the models' filters, and asks `/compact` of a
 * one-message probe chat (turned down before any model runs), then deletes it (src/integrations-probe.ts).
 * `--messages` checks where Run runs (the server's own Pyodide, file by file, or Jupyter), saves a
 * probe message with a file taken out, and on the scratch servers answers the code interpreter's
 * `execute:python` through the echo model (src/messages-probe.ts).
 * `--interface` saves the settings slice's switches, chat direction, background, quick actions
 * and photo size the app's way, reads each back, then puts the settings back (src/interface-probe.ts).
 * `--search` finds a probe chat by a word, `tag:none`, its tag and `folder:`, reads `/status`'s
 * figures, and on the scratch servers attaches a web page as a `load-url` link does (src/search-probe.ts).
 * `--models` tries the Workspace models slice on private probe models only: a model's terminal and
 * voice, the "… All" actions, import (three export formats; a taken id refused), Keep in Sidebar and
 * custom parameters in your settings (put back as they were); all deleted after (src/models-probe.ts).
 * `--notes` asks a model for a note title (one short completion), makes a probe note the app's way (Markdown and the web editor's HTML), finds it, saves it
 * while a socket follows it (the note event and its time), renames, pins, keeps its sharing through
 * a save, and deletes it (src/notes-probe.ts).
 * `--sharedfolders [--peer-env FILE]` shares an "APP PROBE:" folder with a second account (FILE: its
 * OWUI_EMAIL and OWUI_PASSWORD; without it, an admin probe makes a throwaway user and deletes it
 * after), to read then to write, and checks each side's view; all deleted after
 * (src/shared-folders-probe.ts).
 * `--status` sets your status the app's way (a short name, an emoji kept as itself, cleared) and the
 * web's recent emoji list, each put back as it was (src/status-probe.ts).
 * `--oauth` checks a tool's Connect as far as a server without a sign-in tool shows it: the tools
 * list's sign-in marks, the account page's cookie, the tool sign-in page with and without it, and
 * Disconnect for a tool not connected; nothing is started, kept or removed (src/oauth-probe.ts).
 * `--webhooks` adds, switches, changes, makes default, renames and removes a notification target
 * that never sends (off, no events, example.com), then puts the account's targets back; where
 * webhooks aren't allowed it checks the refusal (src/webhooks-probe.ts).
 * `--eventhooks` (admins) adds an event webhook that can't fire (off, for a person who doesn't
 * exist), switches it, changes whose and which events alone, has a bad pattern, an unknown event
 * and an unreachable address refused, deletes it and checks the list is as before; a non-admin
 * gets the refusal (src/eventhooks-probe.ts). Addresses are never printed.
 * `--uidefaults` (admins) saves everyone's Interface defaults the app's way over the admin
 * config, checks the rest of it, `/api/config` and your merged settings, takes one away, clears
 * them, then puts the defaults back exactly; a non-admin gets the refusal (src/uidefaults-probe.ts).
 * `--chatvars` makes a throwaway model whose system prompt asks for chat variables: its form, a
 * saved chat keeping its values, and (on the echo model) the instructions filled in from a
 * temporary chat's values, a saved chat's, and none for an unknown option; all deleted after
 * (src/chatvars-probe.ts).
 * `--codeedit` (admins, scratch servers only: saving runs code) makes a tool and a filter, saves
 * their code, has broken code refused with the old kept, tries the formatter and a link, and
 * deletes them (src/codeedit-probe.ts).
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
  addUser,
  deleteUser,
  signOut,
  type Capabilities,
  type FeatureId,
  type ServerConfig,
} from '@maviechat/owui-protocol';
import { DEFAULT_ENV_FILE, expandHome, loadEnvFile } from './env';
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
import { probeAttach } from './attach-probe';
import { probeFolders } from './folders-probe';
import { probeIntegrations } from './integrations-probe';
import { probeInterface } from './interface-probe';
import { probeMessages } from './messages-probe';
import { probeModels } from './models-probe';
import { probeNotes } from './notes-probe';
import { probeOAuth } from './oauth-probe';
import { probeWebhooks } from './webhooks-probe';
import { probeEventHooks } from './eventhooks-probe';
import { probeUiDefaults } from './uidefaults-probe';
import { probeChatVars } from './chatvars-probe';
import { probeCodeEdit } from './codeedit-probe';
import { probeStatus } from './status-probe';
import { probeSharedFolders } from './shared-folders-probe';
import { probeSearch } from './search-probe';
import { probeNewChat } from './newchat-probe';
import { probeA8Account } from './a8-account-probe';
import { probeA8Data } from './a8-data-probe';
import { probeA8 } from './a8-probe';
import { probeM3Knowledge } from './m3-knowledge-probe';
import { probeM3Models } from './m3-models-probe';
import { probeM3Text } from './m3-text-probe';
import { probeM3Tools } from './m3-tools-probe';
import { probeM4Connections } from './m4-connections-probe';
import { probeM4Evaluations } from './m4-evaluations-probe';
import { probeM4Forms } from './m4-forms-probe';
import { probeM4Functions } from './m4-functions-probe';
import { probeM4Models } from './m4-models-probe';
import { probeM4Settings } from './m4-settings-probe';
import { probeM4Users } from './m4-users-probe';
import { probeM5Mfa } from './m5-mfa-probe';
import { probeChatActions } from './write-probe';

/**
 * The owner-approved scratch servers (Open WebUI 0.11.3 on 3013, 0.12.5 on 3014): the only ones
 * probes write admin settings to, or save code on (tools and functions run when saved).
 */
const SCRATCH_URLS = new Set(['http://127.0.0.1:3013', 'http://127.0.0.1:3014']);

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
    folders: { type: 'boolean' },
    newchat: { type: 'boolean' },
    attach: { type: 'boolean' },
    integrations: { type: 'boolean' },
    messages: { type: 'boolean' },
    interface: { type: 'boolean' },
    search: { type: 'boolean' },
    models: { type: 'boolean' },
    notes: { type: 'boolean' },
    status: { type: 'boolean' },
    oauth: { type: 'boolean' },
    webhooks: { type: 'boolean' },
    eventhooks: { type: 'boolean' },
    uidefaults: { type: 'boolean' },
    chatvars: { type: 'boolean' },
    codeedit: { type: 'boolean' },
    sharedfolders: { type: 'boolean' },
    'peer-env': { type: 'string' },
    a8: { type: 'boolean' },
    m3: { type: 'boolean' },
    m3text: { type: 'boolean' },
    m3kb: { type: 'boolean' },
    m3tools: { type: 'boolean' },
    m4users: { type: 'boolean' },
    m4settings: { type: 'boolean' },
    m4connections: { type: 'boolean' },
    m4models: { type: 'boolean' },
    m4forms: { type: 'boolean' },
    m4functions: { type: 'boolean' },
    m4evaluations: { type: 'boolean' },
    m5mfa: { type: 'boolean' },
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

      if (args.folders && capabilities) {
        const folders = await probeFolders({ client, capabilities, canDelete: capabilities.can('chat.delete') });
        for (const result of folders.steps) results.push({ ...result, name: `Folders: ${result.name}` });
        fixtures['write.folders'] = folders.fixture;
      }

      if (args.newchat && capabilities) {
        const newChat = await probeNewChat({ client, capabilities });
        for (const result of newChat.steps) results.push({ ...result, name: `New chat: ${result.name}` });
        fixtures['write.newchat'] = newChat.fixture;
      }

      if (args.attach && capabilities) {
        const attach = await probeAttach({ client, canDelete: capabilities.can('chat.delete') });
        for (const result of attach.steps) results.push({ ...result, name: `Attach: ${result.name}` });
        fixtures['write.attach'] = attach.fixture;
      }

      if (args.integrations && capabilities) {
        const integrations = await probeIntegrations({ client, capabilities, canDelete: capabilities.can('chat.delete') });
        for (const result of integrations.steps) results.push({ ...result, name: `Integrations: ${result.name}` });
        fixtures['write.integrations'] = integrations.fixture;
      }

      if (args.messages && capabilities) {
        const messages = await probeMessages({
          client,
          baseUrl,
          token: session.token,
          userId: session.id,
          userName: session.name,
          capabilities,
          config: serverConfig,
          canDelete: capabilities.can('chat.delete'),
          scratch: SCRATCH_URLS.has(baseUrl),
        });
        for (const result of messages.steps) results.push({ ...result, name: `Messages: ${result.name}` });
        fixtures['write.messages'] = messages.fixture;
      }

      if (args.interface && capabilities) {
        const settingsProbe = await probeInterface({ client, capabilities });
        for (const result of settingsProbe.steps) results.push({ ...result, name: `Interface: ${result.name}` });
        fixtures['write.interface'] = settingsProbe.fixture;
      }

      if (args.search && capabilities) {
        const searchProbe = await probeSearch({ client, capabilities, canDelete: capabilities.can('chat.delete'), scratch: SCRATCH_URLS.has(baseUrl) });
        for (const result of searchProbe.steps) results.push({ ...result, name: `Search: ${result.name}` });
        fixtures['write.search'] = searchProbe.fixture;
      }

      if (args.models && capabilities) {
        const modelsProbe = await probeModels({ client, capabilities });
        for (const result of modelsProbe.steps) results.push({ ...result, name: `Models: ${result.name}` });
        fixtures['write.models'] = modelsProbe.fixture;
      }

      if (args.sharedfolders) {
        const peerEnv = loadEnvFile(args['peer-env'] ?? '') ?? {};
        let peerEmail = peerEnv.OWUI_EMAIL;
        let peerPassword = peerEnv.OWUI_PASSWORD;
        // With no second account given, an admin probe makes one for this run and deletes it after.
        let madePeer = '';
        if ((!peerEmail || !peerPassword) && session.role === 'admin') {
          const stamp = Date.now().toString(36);
          peerEmail = `app-probe-peer-${stamp}@maviechat.invalid`;
          peerPassword = `Probe-${stamp}-${Math.random().toString(36).slice(2, 10)}`;
          madePeer = (await addUser(client, { name: 'APP PROBE peer', email: peerEmail, password: peerPassword, role: 'user' })).id;
        }
        try {
          if (!peerEmail || !peerPassword) {
            results.push({ name: 'Shared folders', ok: true, note: 'skipped: give --peer-env (a second account), or run as an admin' });
          } else {
            const peerSignIn = await signIn(anonymous, peerEmail, peerPassword);
            if (peerSignIn.kind !== 'session') {
              results.push({ name: 'Shared folders', ok: false, note: `the peer's sign-in answered "${peerSignIn.kind}"` });
            } else {
              const sharedProbe = await probeSharedFolders({ owner: client, ownerId: session.id, peer: anonymous.withToken(peerSignIn.session.token), peerId: peerSignIn.session.id });
              for (const result of sharedProbe.steps) results.push({ ...result, name: `Shared folders: ${result.name}` });
              fixtures['write.shared-folders'] = { ...sharedProbe.fixture, peer: madePeer ? 'made for the run' : 'given' };
            }
          }
        } finally {
          if (madePeer) await deleteUser(client, madePeer).catch(() => undefined);
        }
      }

      if (args.status) {
        const statusProbe = await probeStatus({ client, config: serverConfig });
        for (const result of statusProbe.steps) results.push({ ...result, name: `Status: ${result.name}` });
        fixtures['write.status'] = statusProbe.fixture;
      }

      if (args.oauth) {
        const oauthProbe = await probeOAuth({ client, baseUrl, token: session.token });
        for (const result of oauthProbe.steps) results.push({ ...result, name: `OAuth: ${result.name}` });
        fixtures['write.oauth'] = oauthProbe.fixture;
      }

      if (args.webhooks && capabilities) {
        const webhooksProbe = await probeWebhooks({ client, capabilities });
        for (const result of webhooksProbe.steps) results.push({ ...result, name: `Webhooks: ${result.name}` });
        fixtures['write.webhooks'] = webhooksProbe.fixture;
      }

      if (args.eventhooks && capabilities) {
        const eventHooksProbe = await probeEventHooks({ client, capabilities });
        for (const result of eventHooksProbe.steps) results.push({ ...result, name: `Event webhooks: ${result.name}` });
        fixtures['write.eventhooks'] = eventHooksProbe.fixture;
      }

      if (args.uidefaults && capabilities) {
        const uiDefaultsProbe = await probeUiDefaults({ client, capabilities });
        for (const result of uiDefaultsProbe.steps) results.push({ ...result, name: `Interface defaults: ${result.name}` });
        fixtures['write.uidefaults'] = uiDefaultsProbe.fixture;
      }

      if (args.chatvars) {
        const chatVarsProbe = await probeChatVars({ client });
        for (const result of chatVarsProbe.steps) results.push({ ...result, name: `Chat Variables: ${result.name}` });
        fixtures['write.chatvars'] = chatVarsProbe.fixture;
      }

      if (args.codeedit && capabilities) {
        const codeProbe = await probeCodeEdit({ client, capabilities, baseUrl });
        for (const result of codeProbe.steps) results.push({ ...result, name: `Code editor: ${result.name}` });
        fixtures['write.codeedit'] = codeProbe.fixture;
      }

      if (args.notes && capabilities) {
        const notesProbe = await probeNotes({ client, baseUrl, token: session.token, userId: session.id, capabilities, modelId: typeof firstModelId === 'string' ? firstModelId : undefined });
        for (const result of notesProbe.steps) results.push({ ...result, name: `Notes: ${result.name}` });
        fixtures['write.notes'] = notesProbe.fixture;
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

      if (args.m3kb && capabilities) {
        const m3kb = await probeM3Knowledge({ client, capabilities });
        for (const result of m3kb.steps) results.push({ ...result, name: `M3: ${result.name}` });
        fixtures['write.m3-knowledge'] = m3kb.fixture;
      }

      if (args.m3tools && capabilities) {
        // Saving a tool runs its code on the server: only ever on the scratch instance's port.
        const m3tools = await probeM3Tools({ client, capabilities, allowCode: SCRATCH_URLS.has(baseUrl) });
        for (const result of m3tools.steps) results.push({ ...result, name: `M3: ${result.name}` });
        fixtures['write.m3-tools'] = m3tools.fixture;
      }

      if (args.m4users && capabilities) {
        // Admin writes only ever on the scratch instance's port.
        const m4users = await probeM4Users({ client, capabilities, allowWrites: SCRATCH_URLS.has(baseUrl) });
        for (const result of m4users.steps) results.push({ ...result, name: `M4: ${result.name}` });
        fixtures['write.m4-users'] = m4users.fixture;
      }

      if (args.m4settings && capabilities) {
        // Admin writes only ever on the scratch instance's port.
        const m4settings = await probeM4Settings({ client, capabilities, allowWrites: SCRATCH_URLS.has(baseUrl) });
        for (const result of m4settings.steps) results.push({ ...result, name: `M4: ${result.name}` });
        fixtures['write.m4-settings'] = m4settings.fixture;
      }

      if (args.m4connections && capabilities) {
        // Admin writes only ever on the scratch instance's port.
        const m4connections = await probeM4Connections({ client, capabilities, allowWrites: SCRATCH_URLS.has(baseUrl) });
        for (const result of m4connections.steps) results.push({ ...result, name: `M4: ${result.name}` });
        fixtures['write.m4-connections'] = m4connections.fixture;
      }

      if (args.m4models && capabilities) {
        // Admin writes only ever on the scratch instance's port.
        const m4models = await probeM4Models({ client, capabilities, allowWrites: SCRATCH_URLS.has(baseUrl) });
        for (const result of m4models.steps) results.push({ ...result, name: `M4: ${result.name}` });
        fixtures['write.m4-models'] = m4models.fixture;
      }

      if (args.m4forms && capabilities) {
        // Admin writes only ever on the scratch instance's port.
        const m4forms = await probeM4Forms({ client, capabilities, allowWrites: SCRATCH_URLS.has(baseUrl) });
        for (const result of m4forms.steps) results.push({ ...result, name: `M4: ${result.name}` });
        fixtures['write.m4-forms'] = m4forms.fixture;
      }

      if (args.m4functions && capabilities) {
        // Saving a function runs its code on the server: only ever on the scratch instance's port.
        const m4functions = await probeM4Functions({ client, capabilities, allowCode: SCRATCH_URLS.has(baseUrl) });
        for (const result of m4functions.steps) results.push({ ...result, name: `M4: ${result.name}` });
        fixtures['write.m4-functions'] = m4functions.fixture;
      }

      if (args.m4evaluations && capabilities) {
        // Admin writes only ever on the scratch instance's port.
        const m4evaluations = await probeM4Evaluations({ client, capabilities, allowWrites: SCRATCH_URLS.has(baseUrl) });
        for (const result of m4evaluations.steps) results.push({ ...result, name: `M4: ${result.name}` });
        fixtures['write.m4-evaluations'] = m4evaluations.fixture;
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

  // Last, after the probe's own session is gone: switching two-step sign-in signs everyone out.
  if (args.m5mfa) {
    if (!SCRATCH_URLS.has(baseUrl) || !env.OWUI_EMAIL || !env.OWUI_PASSWORD) {
      results.push({ name: 'M5: two-step sign-in', ok: false, note: 'only on a scratch server, as its admin' });
    } else {
      const m5 = await probeM5Mfa({ baseUrl, version: version?.version, admin: { email: env.OWUI_EMAIL, password: env.OWUI_PASSWORD, mfaSecret: env.OWUI_MFA_SECRET }, envFile: expandHome(envFile) });
      for (const result of m5.steps) results.push({ ...result, name: `M5: ${result.name}` });
      fixtures['write.m5-mfa'] = m5.fixture;
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
