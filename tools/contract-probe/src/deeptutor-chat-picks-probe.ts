import {
  applyTurnEvent,
  deleteSession,
  DtTurnConnection,
  emptyReply,
  getSession,
  listChatResources,
  listModules,
  listPersonas,
  socketCookieHeader,
  turnSocketUrl,
  type DtClient,
  type DtReply,
  type DtTurnRequest,
} from '@maviechat/deeptutor-protocol';

const NodeWebSocket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;

/** One turn through the app's own connection, to its end. */
async function runTurn(baseUrl: string, token: string, request: DtTurnRequest): Promise<{ sessionId: string; reply: DtReply }> {
  let reply = emptyReply();
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
    const started = await connection.startTurn(request);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([finished, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('no done event within 3 minutes')), 180_000)))]).finally(() => clearTimeout(timer));
    return { sessionId: started.sessionId, reply };
  } finally {
    connection.close();
  }
}

/**
 * B7.3 against a live DeepTutor, in the test account: the skills and MCP servers a chat may use;
 * a new chat answering in a preset's voice with one skill and the memory's big picture, which the
 * chat then keeps (its preferences); a second turn back to the default voice and every skill;
 * the chat deleted. Two short replies from the account's model.
 */
export async function probeChatPicks(baseUrl: string, token: string, client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const fixture: Record<string, unknown> = {};
  const resources = await listChatResources(client);
  fixture.resources = { skills: resources.skills.map((skill) => skill.id), mcp: resources.mcp.length };
  const preset = (await listPersonas(client)).find((persona) => persona.preset)?.name;
  if (!preset) throw new Error('no preset persona to answer in');
  const skill = resources.skills.find((row) => row.id === 'skill-creator')?.id ?? resources.skills[0]?.id;
  if (!skill) throw new Error('no skill a chat may use');
  const memory = (await listModules(client)).some((module) => module.id === 'memory' && module.enabled);

  const first = await runTurn(baseUrl, token, { content: 'APP PROBE: Reply with just the word OK.', tools: [], persona: preset, skills: [skill], ...(memory ? { memoryReferences: ['summary', 'profile'] } : {}) });
  try {
    if (first.reply.status !== 'completed') throw new Error(`the first turn ended ${first.reply.status}${first.reply.error ? `: ${first.reply.error}` : ''}`);
    let preferences = (await getSession(client, first.sessionId)).preferences ?? {};
    fixture.kept = { persona: preferences.persona ?? null, skills: preferences.skills ?? null, mcp: preferences.mcp ?? null };
    if (preferences.persona !== preset) throw new Error(`the chat kept the voice "${String(preferences.persona)}", not "${preset}"`);
    if (JSON.stringify(preferences.skills) !== JSON.stringify([skill])) throw new Error(`the chat kept the skills ${JSON.stringify(preferences.skills)}, not ["${skill}"]`);

    const second = await runTurn(baseUrl, token, { content: 'APP PROBE: Once more, just OK.', sessionId: first.sessionId, tools: [], persona: '', skills: [] });
    if (second.reply.status !== 'completed') throw new Error(`the second turn ended ${second.reply.status}`);
    preferences = (await getSession(client, first.sessionId)).preferences ?? {};
    fixture.cleared = { persona: preferences.persona ?? null, skills: preferences.skills ?? null };
    if (preferences.persona) throw new Error(`the default voice wasn't kept (still "${String(preferences.persona)}")`);
    if (Array.isArray(preferences.skills) && preferences.skills.length) throw new Error('every skill wasn’t given back');
  } finally {
    await deleteSession(client, first.sessionId).catch(() => undefined);
  }
  return { note: `${resources.skills.length} skills and ${resources.mcp.length} MCP servers a chat may use; a chat in the "${preset}" voice with "${skill}"${memory ? ' and the memory’s big picture' : ''} kept both; a second turn put back the default voice and every skill; chat deleted`, fixture };
}
