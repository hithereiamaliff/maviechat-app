import vm from 'node:vm';
import {
  applyMessageEvent,
  buildCompletionRequest,
  buildTurn,
  chatFeatures,
  createAdminFunction,
  deleteAdminFunction,
  deleteChat,
  listModels,
  openSocketSession,
  outputText,
  requestParams,
  setFunctionActive,
  startCompletion,
  templateVariables,
  toolScriptMessage,
  toolScriptSource,
  type Capabilities,
  type HistoryMessage,
  type OwuiClient,
  type ToolScriptMessage,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

const PIPE = 'app_probe_script';
// A pipe that asks the browser to run JavaScript twice (one returns, one throws) and says what came back.
const PIPE_CODE = `"""
title: APP PROBE script
"""
import json


class Pipe:
    async def pipe(self, body: dict, __event_call__=None) -> str:
        if __event_call__ is None:
            return "APP PROBE no event call"
        answered = await __event_call__({"type": "execute", "data": {"code": "await new Promise((done) => setTimeout(done, 20)); return 6 * 7;"}})
        failed = await __event_call__({"type": "execute", "data": {"code": "throw new Error('APP PROBE thrown');"}})
        return "APP PROBE answers " + json.dumps([answered, failed])
`;

/** The app's sealed page, stood in for by a sandbox: the same script, its messages read the app's way. */
async function runAsTheAppDoes(code: string): Promise<unknown> {
  const raw: string[] = [];
  const sandbox: Record<string, unknown> = { Blob, btoa, setTimeout, URL: { createObjectURL: () => 'blob:sealed/1' }, ReactNativeWebView: { postMessage: (message: string) => raw.push(message) } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(toolScriptSource(code, 1), sandbox);
  for (let tries = 0; tries < 300; tries += 1) {
    const end = raw.map((message) => toolScriptMessage(message, 1)).find((message): message is ToolScriptMessage => message?.type === 'done' || message?.type === 'error');
    if (end?.type === 'done') return end.result;
    if (end?.type === 'error') return { error: `The code failed: ${end.error}` };
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { error: 'The code failed: It ran too long.' };
}

const textOf = (message: HistoryMessage | null) => (outputText(message?.output) || message?.content || '').trim();

/**
 * A tool's JavaScript over the socket, the app's way (admins, scratch servers only: it installs a
 * function, which runs Python on the server). A throwaway pipe asks the browser to run code
 * twice; the probe answers each request as the app does, by running the same sealed page script
 * (in a sandbox here), and the pipe's reply carries the answers back: 42, and the error. The
 * function and the chat are deleted after.
 */
export async function probeToolScript(input: { client: OwuiClient; baseUrl: string; token: string; userId: string; userName: string; capabilities: Capabilities }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client, capabilities } = input;
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  if (!capabilities.isAdmin || !/^http:\/\/127\.0\.0\.1:(3013|3014)\/?$/.test(input.baseUrl)) {
    steps.push({ name: 'tools’ JavaScript', ok: true, note: 'skipped: admins on the scratch servers only' });
    return { steps, fixture };
  }

  let made = false;
  let chatId: string | undefined;
  const socket = openSocketSession({ baseUrl: input.baseUrl, token: input.token, expectedUserId: input.userId, websocketOnly: capabilities.websocketOnly, heartbeatIntervalSec: capabilities.heartbeatIntervalSec });
  try {
    await createAdminFunction(client, { id: PIPE, name: 'APP PROBE script', description: 'APP PROBE', content: PIPE_CODE });
    made = true;
    await setFunctionActive(client, PIPE, true);
    let model = (await listModels(client)).find((item) => item.id === PIPE);
    for (let tries = 0; !model && tries < 10; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      model = (await listModels(client)).find((item) => item.id === PIPE);
    }
    if (!model) throw new Error('the pipe’s model never showed up');
    const chosen = model;

    let reply: HistoryMessage | null = null;
    const requests: string[] = [];
    let wake: () => void = () => undefined;
    socket.onChatEvent((event, answer) => {
      if (event.data.type === 'execute') {
        const code = String((event.data.data as { code?: unknown } | undefined)?.code ?? '');
        requests.push(code);
        void runAsTheAppDoes(code).then((value) => answer?.(value));
        return;
      }
      if (answer) answer({ error: 'unsupported in probe' });
      if (!reply || event.message_id !== reply.id) return;
      reply = applyMessageEvent(reply, event.data.type, event.data.data);
      if (reply.done) wake();
    });
    await socket.joined;

    await check('a tool’s JavaScript requests reach the app’s socket, and its answers (a value, an error) reach the tool', async () => {
      const turn = buildTurn({ history: { messages: {}, currentId: null }, content: 'APP PROBE: run the code', models: [chosen] });
      reply = turn.replies[0] as HistoryMessage;
      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no reply within 2 minutes')), 120_000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      const body = buildCompletionRequest({
        turn,
        chatId: null,
        sessionId: socket.sessionId ?? '',
        model: chosen,
        params: requestParams(undefined, {}),
        features: chatFeatures(capabilities, {}, false),
        variables: templateVariables({ name: input.userName }),
        tasks: { title: false, tags: false, followUps: false },
      });
      chatId = (await startCompletion(client, body)).chat_id;
      await done;
      const said = textOf(reply);
      fixture.requests = requests.length;
      if (requests.length !== 2) throw new Error(`${requests.length} requests came over the socket`);
      if (!said.includes('APP PROBE answers [42, {"error": "The code failed: APP PROBE thrown"}]')) throw new Error(`the reply reads "${said.slice(0, 120)}"`);
      return '2 requests over the socket; the tool got 42, then {"error": "The code failed: APP PROBE thrown"}';
    });
  } finally {
    socket.close();
    await check('the throwaway pipe and its chat deleted', async () => {
      if (chatId) await deleteChat(client, chatId);
      if (made) await deleteAdminFunction(client, PIPE);
      return `${made ? 'the pipe' : 'nothing made'}${chatId ? ' and the chat' : ''} gone`;
    });
  }
  return { steps, fixture };
}
