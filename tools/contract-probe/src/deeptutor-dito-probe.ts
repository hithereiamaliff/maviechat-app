import {
  acceptableHere,
  anchorNoteThread,
  applyTurnEvent,
  createNotePage,
  deleteNotePage,
  deleteNoteThread,
  deleteSession,
  DtTurnConnection,
  emptyReply,
  getNotePage,
  getSession,
  listNoteSuggestions,
  listNoteThreads,
  reviewNoteSuggestion,
  socketCookieHeader,
  turnSocketUrl,
  type DtClient,
  type DtReply,
} from '@maviechat/deeptutor-protocol';

const NodeWebSocket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;

/**
 * B8.2 against a live DeepTutor, in the test account: a scratch page with one line; one short
 * conversation with Dito about it, sent as the app sends it (`note_document_id`), which reads the
 * page and files a suggestion; the chat kept the page; tied to the page's line, it's listed with
 * the page's conversations; the suggestion accepted as the app accepts it (Markdown turned into
 * blocks here, which DeepTutor checks), or dismissed when only DeepTutor's editor could turn it;
 * the conversation, its chat and the page deleted. One reply from the account's model.
 */
export async function probeDito(baseUrl: string, token: string, client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const fixture: Record<string, unknown> = {};
  const page = await createNotePage(client, { title: `APP PROBE Dito ${Date.now().toString(36)}` });
  let sessionId = '';
  try {
    const block = { id: 'line1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Photosynthesis is the process by which green plants, using the energy of sunlight, turn water and carbon dioxide into sugar and oxygen.', styles: {} }], children: [] };
    await client.send('PUT', `/api/documents/${page.id}`, { body: { blocks: [block], expected_revision: 0 } });
    const before = await getNotePage(client, page.id);

    let reply: DtReply = emptyReply();
    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const connection = new DtTurnConnection({
      url: turnSocketUrl(baseUrl),
      connect: (url, handlers) => {
        const socket = new NodeWebSocket(url, { headers: { Cookie: socketCookieHeader(token) } });
        socket.onopen = () => handlers.onOpen();
        socket.onmessage = (event) => handlers.onMessage(event.data);
        socket.onclose = (event) => handlers.onClose(event.code);
        return { send: (data) => socket.send(data), close: () => socket.close() };
      },
      onEvent: (event) => {
        reply = applyTurnEvent(reply, event);
        if (event.type === 'done') finish();
      },
    });
    try {
      const started = await connection.startTurn({ content: 'APP PROBE: suggest a shorter version of the first line, as an edit to the page.', capability: 'chat', tools: [], noteDocumentId: page.id });
      sessionId = started.sessionId;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([finished, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('no done event within 3 minutes')), 180_000)))]).finally(() => clearTimeout(timer));
    } finally {
      connection.close();
    }
    if (reply.status !== 'completed') throw new Error(`Dito's turn ended ${reply.status}${reply.error ? `: ${reply.error}` : ''}`);
    fixture.tools = [...new Set(reply.tools.map((tool) => tool.name))].sort();
    if (!reply.tools.some((tool) => tool.name === 'note_read')) throw new Error('Dito didn’t read the page');
    const kept = (await getSession(client, sessionId)).preferences?.note_document_id;
    fixture.keptPage = kept === page.id;
    if (kept !== page.id) throw new Error('the chat didn’t keep the page it is about');

    await anchorNoteThread(client, page.id, { sessionId, blockId: 'line1', quote: 'APP PROBE' });
    const threads = await listNoteThreads(client, page.id);
    if (!threads.some((thread) => thread.sessionId === sessionId && thread.blockId === 'line1')) throw new Error('the conversation wasn’t listed with the page');

    const pending = (await listNoteSuggestions(client, page.id)).filter((suggestion) => suggestion.status === 'pending');
    fixture.suggestions = pending.map((suggestion) => ({ operation: suggestion.operation, blocks: suggestion.blocks !== null }));
    if (!pending.length) throw new Error('Dito filed no suggestion');
    const first = pending[0]!;
    if (acceptableHere(first) && (first.operation === 'replace' || first.operation === 'insert')) {
      // Accepted as the app accepts it: Markdown-only suggestions turned into blocks here, which DeepTutor checks.
      const after = await reviewNoteSuggestion(client, page.id, first, true);
      if (after.content === before.content) throw new Error('accepting the suggestion left the page as it was');
      fixture.reviewed = first.blocks ? 'accepted with its own blocks' : 'accepted with blocks made from its Markdown';
    } else {
      const after = await reviewNoteSuggestion(client, page.id, first, false);
      if (after.content !== before.content) throw new Error('dismissing a suggestion changed the page');
      fixture.reviewed = 'dismissed';
    }
    const status = (await listNoteSuggestions(client, page.id)).find((suggestion) => suggestion.id === first.id)?.status;
    if (status === 'pending') throw new Error('the suggestion was still pending');

    await deleteNoteThread(client, page.id, sessionId);
    if ((await listNoteThreads(client, page.id)).length) throw new Error('the conversation was still listed');
  } finally {
    if (sessionId) await deleteSession(client, sessionId).catch(() => undefined);
    await deleteNotePage(client, page.id).catch(() => undefined);
  }
  return { note: `Dito read the page (${(fixture.tools as string[]).join(', ')}) and filed ${(fixture.suggestions as unknown[]).length} suggestion(s); the chat kept the page; tied to its line and listed; ${String(fixture.reviewed)}; conversation, chat and page deleted`, fixture };
}
