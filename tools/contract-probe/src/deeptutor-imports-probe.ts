import { chatGptImportSessions, deleteSession, getSession, importChatHistory, importedChatId, listImportedChats, listSessions, type DtClient } from '@maviechat/deeptutor-protocol';
import { shapeOf } from './shape';

/**
 * B7.5 against a live DeepTutor, in the test account: imported conversations listed; one made-up
 * ChatGPT conversation imported, listed with its source, opened with both messages, imported
 * again without a copy, kept out of the chat history, then deleted. No model, nothing outside.
 */
export async function probeImports(client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const fixture: Record<string, unknown> = {};
  const before = await listImportedChats(client);
  fixture.before = before.length;
  const external = `mc-probe-${Date.now().toString(36)}`;
  const now = Date.now() / 1000;
  const sessions = chatGptImportSessions([
    { id: external, title: '', created: now - 60, updated: now, messages: [{ role: 'user', text: 'APP PROBE: what is two plus two?', at: now - 60 }, { role: 'assistant', text: 'Four.', at: now - 59 }] },
  ]);
  const id = importedChatId('chatgpt', external);
  const first = await importChatHistory(client, 'chatgpt', sessions);
  try {
    if (first.imported !== 1) throw new Error(`importing one conversation gave ${JSON.stringify(first)}`);
    const listed = (await listImportedChats(client)).find((chat) => chat.id === id);
    if (!listed || listed.imported.source !== 'chatgpt') throw new Error('the imported chat was not listed as ChatGPT’s');
    fixture.row = shapeOf(listed, 3);
    const session = await getSession(client, id);
    if (session.messages.length !== 2 || session.messages[1]?.content !== 'Four.') throw new Error('the imported chat did not open with its two messages');
    const again = await importChatHistory(client, 'chatgpt', sessions);
    if (again.imported !== 0 || again.skipped !== 1) throw new Error(`importing it again gave ${JSON.stringify(again)}`);
    if ((await listSessions(client, { limit: 200 })).some((row) => row.id === id)) throw new Error('the imported chat showed up in the chat history');
    fixture.title = session.title === 'APP PROBE: what is two plus two?' ? 'from the first question' : session.title;
  } finally {
    await deleteSession(client, id).catch(() => undefined);
  }
  if ((await listImportedChats(client)).some((chat) => chat.id === id)) throw new Error('the probe’s imported chat was left behind');
  return { note: `${before.length} imported chats before; one ChatGPT conversation imported (titled from its first question), opened, imported again without a copy, kept out of the chat history, deleted`, fixture };
}
