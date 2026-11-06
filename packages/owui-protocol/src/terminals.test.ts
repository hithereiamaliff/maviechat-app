import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import type { ModelItem } from './models';
import { activeTerminal, canUseTerminal, chatTerminals, listTerminals, modelTerminal, terminalLabel, type TerminalServer } from './terminals';

function answering(status: number, body: unknown) {
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    return new Response(JSON.stringify(body), { status });
  };
  return { client: new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), urls };
}

const BOX1: TerminalServer = { id: 'box-1', name: 'Build box', url: 'http://10.0.0.5:8000', contexts: {}, config: { chat_uploads: 'default' } };
const BOX2: TerminalServer = { id: 'box-2', name: 'Staging box', contexts: { chat: { context_id: 'chat_id' } } };
const NOT_IN_CHATS: TerminalServer = { id: 'notes-only', name: 'Notes box', contexts: { chat: false } };
const model = (capabilities?: Record<string, boolean>, terminalId?: string): ModelItem => ({ id: 'm', name: 'M', info: { meta: { capabilities: capabilities ?? null, ...(terminalId ? { terminalId } : {}) } } });

describe('systems the model can work on', () => {
  it('reads the list for this account, and treats a server without one as having none', async () => {
    const ok = answering(200, [BOX1, { name: 'no id' }]);
    expect(await listTerminals(ok.client)).toEqual([BOX1]);
    expect(ok.urls).toEqual(['https://chat.test/api/v1/terminals/']);
    expect(await listTerminals(answering(404, { detail: 'Not Found' }).client)).toEqual([]);
    expect(await listTerminals(answering(200, { detail: 'odd' }).client)).toEqual([]);
  });

  it('offers in chats only those meant for chats; a temporary chat leaves out per-chat workspaces', () => {
    const list = [BOX1, BOX2, NOT_IN_CHATS];
    expect(chatTerminals(list, false).map((item) => item.id)).toEqual(['box-1', 'box-2']);
    expect(chatTerminals(list, true).map((item) => item.id)).toEqual(['box-1']);
    expect(terminalLabel({ id: 'raw' })).toBe('raw');
  });

  it('lets a model use one unless its terminal capability is off, and finds the one a model comes with', () => {
    expect(canUseTerminal(model())).toBe(true);
    expect(canUseTerminal(model({ terminal: true }))).toBe(true);
    expect(canUseTerminal(model({ terminal: false }))).toBe(false);
    expect(canUseTerminal(undefined)).toBe(false);
    expect(modelTerminal(model(undefined, 'box-2'), [BOX1, BOX2])).toBe('box-2');
    expect(modelTerminal(model(undefined, 'gone'), [BOX1])).toBeNull();
  });

  it('sends the chosen one while it is offered here and a model answering may use it', () => {
    const list = [BOX1, BOX2];
    expect(activeTerminal(list, 'box-1', [model()], false)).toBe(BOX1);
    expect(activeTerminal(list, 'box-1', [model({ terminal: false }), model()], false)).toBe(BOX1);
    expect(activeTerminal(list, 'box-1', [model({ terminal: false })], false)).toBeNull();
    expect(activeTerminal(list, 'box-2', [model()], true)).toBeNull();
    expect(activeTerminal(list, 'gone', [model()], false)).toBeNull();
    expect(activeTerminal(list, null, [model()], false)).toBeNull();
  });
});
