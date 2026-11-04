/**
 * OpenCode through MavieChat's gateway, as the app uses it (M7.2):
 *
 *   OC_GATEWAY=http://127.0.0.1:8092 OC_PAIR_CODE=<from maviechat-gateway pair> npm run probe:opencode -- [--prompts] [--model provider/model]
 *
 * Pairs a test device, checks the machine and what the gateway refuses (other folders, paths
 * outside a project, closed routes), and counts sessions. With --prompts it runs short turns in a
 * scratch folder it creates and removes (/root/work/maviechat-opencode-scratch): an edit refused
 * at the approval, a command allowed once, and a reply stopped mid-way. It deletes the sessions it
 * made and unpairs the test device. Prints no tokens, codes or session titles.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  abortSession,
  createSession,
  deleteSession,
  getMachine,
  getMessages,
  getStatuses,
  listSessions,
  OcClient,
  OcHttpError,
  pairDevice,
  readEvents,
  listFiles,
  replyPermission,
  revokeDevice,
  sendPrompt,
  type OcEvent,
} from '@maviechat/opencode-protocol';

const SCRATCH = '/root/work/maviechat-opencode-scratch';
const gateway = process.env.OC_GATEWAY ?? '';
const code = process.env.OC_PAIR_CODE ?? '';
const withPrompts = process.argv.includes('--prompts');
// `--model provider/model` for the prompts; without it OpenCode uses its own default.
const modelArg = process.argv[process.argv.indexOf('--model') + 1] ?? '';
const model = process.argv.includes('--model') && modelArg.includes('/') ? { providerID: modelArg.slice(0, modelArg.indexOf('/')), modelID: modelArg.slice(modelArg.indexOf('/') + 1) } : undefined;
const results: { name: string; ok: boolean; note: string }[] = [];

async function step(name: string, run: () => Promise<string>): Promise<boolean> {
  try {
    results.push({ name, ok: true, note: await run() });
    return true;
  } catch (error) {
    results.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

const statusOf = (run: () => Promise<unknown>) =>
  run().then(
    () => 200,
    (error: unknown) => (error instanceof OcHttpError ? error.status : -1),
  );

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(what: string, check: () => T | undefined | null | false, timeoutMs: number): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = check();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function main(): Promise<void> {
  if (!gateway || !code) throw new Error('Set OC_GATEWAY and OC_PAIR_CODE (from `maviechat-gateway pair`).');
  const paired = await pairDevice((input, init) => fetch(input, init), gateway, code, 'APP PROBE');
  const client = new OcClient({ gatewayUrl: gateway, token: paired.token, login: 'root', timeoutMs: 60_000 });
  const created: string[] = [];
  let folder = '';
  try {
    await step('pairing: a one-time code becomes a device token', async () => {
      const again = await pairDevice((input, init) => fetch(input, init), gateway, code, 'APP PROBE').then(
        () => 'accepted',
        () => 'refused',
      );
      if (again !== 'refused') throw new Error('the same code paired twice');
      return 'paired; the same code is refused the second time';
    });

    await step('machine: name, OpenCode logins and allowed folders', async () => {
      const machine = await getMachine(client);
      folder = machine.folders[0] ?? '';
      const logins = machine.logins.map((login) => `${login.id} ${login.version ?? 'offline'}`).join(', ');
      if (!machine.logins.some((login) => login.online)) throw new Error(`no OpenCode answers (${logins})`);
      return `${machine.name}: ${logins}; ${machine.folders.length} folders`;
    });

    await step('refusals: other folders, paths outside a project, closed routes', async () => {
      const outside = await statusOf(() => listSessions(client, '/etc'));
      const escape = await statusOf(() => listFiles(client, folder, '../../etc'));
      const closed = await statusOf(() => client.oc('GET', '/config', { query: { directory: folder } }));
      const contents = await statusOf(() => client.oc('GET', '/file/content', { query: { directory: folder, path: 'README.md' } }));
      if (outside !== 403 || escape !== 403 || closed !== 404 || contents !== 404) throw new Error(`answered ${outside}, ${escape}, ${closed}, ${contents}`);
      return 'outside folder 403, path escape 403, closed routes 404 (config, file contents)';
    });

    await step('sessions: listed for an allowed folder', async () => `${(await listSessions(client, folder)).length} sessions in the first folder (titles not shown)`);

    if (withPrompts) {
      const scratch = path.posix.resolve(SCRATCH);
      if (!existsSync(scratch)) mkdirSync(scratch, { recursive: true });
      const events: OcEvent[] = [];
      const stream = new AbortController();
      const response = await fetch(client.url(`/v1/oc/root/event`, { directory: scratch }), { headers: { ...client.authHeaders(), Accept: 'text/event-stream' }, signal: stream.signal });
      if (!response.ok || !response.body) throw new Error(`the event stream answered ${response.status}`);
      void readEvents(response.body as ReadableStream<Uint8Array>, (event) => events.push(event), stream.signal).catch(() => undefined);
      const asked = (sessionID: string, after: number) => events.slice(after).find((event) => event.type === 'permission.asked' && event.properties.sessionID === sessionID);
      const idle = async (sessionID: string) => {
        await sleep(1500);
        const until = Date.now() + 180_000;
        while (Date.now() < until) {
          const statuses = await getStatuses(client, scratch);
          if ((statuses[sessionID]?.type ?? 'idle') === 'idle') return;
          await sleep(1000);
        }
        throw new Error('the session never finished');
      };

      try {
        await step('an edit is asked about first, and refusing it leaves the file alone', async () => {
          const session = await createSession(client, scratch, { title: 'APP PROBE refused edit' });
          created.push(session.id);
          const mark = events.length;
          await sendPrompt(client, scratch, session.id, { text: 'Create a file named hello.txt containing the word hi. Do nothing else.', model });
          const request = await waitFor('an approval request', () => asked(session.id, mark), 180_000);
          await replyPermission(client, scratch, String(request.properties.id), 'reject');
          await idle(session.id);
          if (existsSync(path.join(scratch, 'hello.txt'))) throw new Error('the file was written anyway');
          return `asked for "${String(request.properties.permission)}"; refused; no file written`;
        });

        await step('a command allowed once runs, and its output comes back', async () => {
          const session = await createSession(client, scratch, { title: 'APP PROBE allowed command' });
          created.push(session.id);
          const mark = events.length;
          await sendPrompt(client, scratch, session.id, { text: 'Run the shell command `ls -a` here and reply with just the number of lines it printed.', model });
          const request = await waitFor('an approval request', () => asked(session.id, mark), 180_000);
          await replyPermission(client, scratch, String(request.properties.id), 'once');
          await idle(session.id);
          const messages = await getMessages(client, scratch, session.id);
          const tools = messages.flatMap((entry) => entry.parts).filter((part) => part.type === 'tool') as { tool: string; state: { status: string } }[];
          const ran = tools.find((part) => part.tool === 'bash' && part.state.status === 'completed');
          if (!ran) throw new Error(`no finished command (${tools.map((part) => `${part.tool}:${part.state.status}`).join(', ') || 'no tools'})`);
          const deltas = events.slice(mark).filter((event) => event.type === 'message.part.delta').length;
          return `asked for "${String(request.properties.permission)}"; allowed once; the command finished; ${deltas} streamed deltas`;
        });

        await step('a reply can be stopped mid-way', async () => {
          const session = await createSession(client, scratch, { title: 'APP PROBE stop' }, false);
          created.push(session.id);
          const mark = events.length;
          await sendPrompt(client, scratch, session.id, { text: 'Write the numbers from 1 to 400, one per line, with nothing else.', model });
          await waitFor('the reply to start', () => events.slice(mark).find((event) => event.type === 'message.part.delta' && event.properties.sessionID === session.id), 180_000);
          await abortSession(client, scratch, session.id);
          await idle(session.id);
          const last = (await getMessages(client, scratch, session.id)).filter((entry) => entry.info.role === 'assistant').at(-1);
          const error = (last?.info as { error?: { name?: string } } | undefined)?.error?.name ?? 'none';
          if (error !== 'MessageAbortedError') throw new Error(`the last reply ended with ${error}`);
          return 'stopped; the reply is marked as stopped';
        });
      } finally {
        stream.abort();
        for (const id of created) await deleteSession(client, scratch, id).catch(() => undefined);
        // Only the probe's own scratch folder, never anything else.
        if (scratch === SCRATCH && existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
      }
    }
  } finally {
    await step('unpairing: the test device is revoked and its token stops working', async () => {
      await revokeDevice(client, paired.deviceId);
      const after = await statusOf(() => getMachine(client));
      if (after !== 401) throw new Error(`the token still answers ${after}`);
      return 'revoked; 401 afterwards';
    });
  }
}

main()
  .catch((error: unknown) => results.push({ name: 'probe', ok: false, note: error instanceof Error ? error.message : String(error) }))
  .finally(() => {
    for (const result of results) console.log(`${result.ok ? '✓' : '✗'} ${result.name}: ${result.note}`);
    process.exit(results.every((result) => result.ok) ? 0 : 1);
  });
