import {
  archivePartnerSession,
  createPartner,
  currentWebSession,
  deletePartner,
  deletePartnerSession,
  DtPartnerChat,
  getLlmOptions,
  getPartner,
  listPartnerGroups,
  listPartners,
  listPartnerSessions,
  listSkillNames,
  listSouls,
  newPartnerSessionKey,
  PARTNER_COLORS,
  partnerHistoryPage,
  partnerSocketUrl,
  recentPartnerConversations,
  recordReply,
  resumePartnerSession,
  socketCookieHeader,
  stopPartner,
  type DtClient,
  type DtPartnerChatState,
  type DtPartnerTurn,
  type DtSocketFactory,
} from '@maviechat/deeptutor-protocol';
import { shapeOf } from './shape';

const NodeWebSocket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;

/** The app's sockets, in Node: the sign-in rides in the Cookie header, never the address. */
function nodeSockets(token: string): DtSocketFactory {
  return (url, handlers) => {
    const socket = new NodeWebSocket(url, { headers: { Cookie: socketCookieHeader(token) } });
    socket.onopen = () => handlers.onOpen();
    socket.onmessage = (event) => handlers.onMessage(event.data);
    socket.onclose = (event) => handlers.onClose(event.code);
    return { send: (data) => socket.send(data), close: () => socket.close() };
  };
}

/** A partner chat that reports to promises: ready, and each reply's end. */
function chatHarness(baseUrl: string, token: string, partnerId: string) {
  let state: DtPartnerChatState = 'closed';
  let live: DtPartnerTurn | null = null;
  let sawStream = 0;
  const waiters: { test: () => boolean; resolve: () => void }[] = [];
  const ended: DtPartnerTurn[] = [];
  const refused: string[] = [];
  const check = () => {
    for (const waiter of [...waiters]) {
      if (waiter.test()) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  };
  const chat = new DtPartnerChat({
    url: partnerSocketUrl(baseUrl, partnerId),
    connect: nodeSockets(token),
    onState: (next) => {
      state = next;
      check();
    },
    onTurn: (turn) => {
      if (turn && live && turn.reply.answer !== live.reply.answer) sawStream += 1;
      live = turn;
      check();
    },
    onEnd: (turn) => {
      ended.push(turn);
      check();
    },
    onRefused: (_prompt, reason, message) => {
      refused.push(`${reason}: ${message}`);
      check();
    },
  });
  const until = (what: string, test: () => boolean, ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (test()) return resolve();
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what} (state ${state}${refused.length ? `; refused ${refused.join(', ')}` : ''})`)), ms);
      waiters.push({ test, resolve: () => (clearTimeout(timer), resolve()) });
    });
  return {
    chat,
    ended,
    refused,
    get state() {
      return state;
    },
    get live() {
      return live;
    },
    get streamed() {
      return sawStream;
    },
    ready: (ms = 90_000) => until('ready', () => state === 'ready', ms),
    nextEnd: (count: number, ms = 180_000) => until(`reply ${count}`, () => ended.length >= count || refused.length > 0, ms),
    streaming: (ms = 120_000) => until('the reply to stream', () => Boolean(live && live.accepted && live.reply.answer.length > 0), ms),
  };
}

/**
 * B6.1 against a live DeepTutor, in the test account: a partner made as the app makes one (a
 * library soul, the default model, every skill), then a conversation over `/ws/partners/{id}`
 * (the sign-in in the Cookie header): a reply streamed and read back from history the same; a
 * second reply followed again after the socket was dropped mid-way; the conversation listed,
 * archived, brought back and deleted; the partner stopped and deleted. No chat-app channels, so
 * nothing outside DeepTutor is contacted. Uses the account's model for two short replies.
 */
export async function probePartners(baseUrl: string, token: string, client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const fixture: Record<string, unknown> = {};
  const own = await listPartners(client);
  const groups = await listPartnerGroups(client);
  const recent = await recentPartnerConversations(client);
  const souls = await listSouls(client);
  const models = await getLlmOptions(client);
  const skills = await listSkillNames(client);
  fixture.before = { partners: own.length, groups: groups.length, recent: recent.length, souls: souls.map((soul) => soul.id), models: models.options.length, skills: skills.length };
  const soul = souls.find((item) => item.id === 'companion') ?? souls[0];
  if (!soul) throw new Error('the soul library is empty');

  const name = `APP PROBE partner ${Date.now().toString(36)}`;
  let partnerId = '';
  let harness: ReturnType<typeof chatHarness> | null = null;
  try {
    const made = await createPartner(client, { name, description: 'Made by the app’s probe; deleted at the end.', emoji: '🦉', color: PARTNER_COLORS[3], language: 'en', soul: { source: 'library', id: soul.id }, skills });
    partnerId = made.partner.id;
    if (!partnerId) throw new Error('no partner id came back');
    if (made.startError) throw new Error(`created, but: ${made.startError}`);
    const detail = await getPartner(client, partnerId);
    fixture.partner = { shape: shapeOf(detail) };
    if (!detail.canManage || detail.channels.length || detail.name !== name || detail.emoji !== '🦉') throw new Error('the new partner reads back different');

    // A reply, streamed, then read back from history the same.
    const key = newPartnerSessionKey();
    harness = chatHarness(baseUrl, token, partnerId);
    harness.chat.open(key);
    await harness.ready();
    if (!harness.chat.send('APP PROBE: reply with just the word tangerine, nothing else.')) throw new Error('the message could not be sent');
    await harness.nextEnd(1);
    if (harness.refused.length) throw new Error(`refused: ${harness.refused.join('; ')}`);
    const first = harness.ended[0] as DtPartnerTurn;
    if (!first.accepted || first.reply.status !== 'completed' || !/tangerine/i.test(first.reply.answer)) throw new Error(`the reply was ${first.reply.status}: ${first.reply.answer.slice(0, 80) || first.reply.error || '(empty)'}`);
    let page = await partnerHistoryPage(client, partnerId, key);
    const saved = page.records.filter((record) => record.role === 'assistant').at(-1);
    fixture.history = { total: page.total, shape: page.records[1] ? shapeOf({ ...page.records[1], events: page.records[1].events.slice(0, 1) }) : null };
    if (page.records.length !== 2 || !saved) throw new Error(`history has ${page.records.length} messages`);
    if (recordReply(saved).answer.trim() !== first.reply.answer.trim()) throw new Error('the saved reply differs from the streamed one');

    // A longer reply, the socket dropped mid-way, then followed again to its end.
    if (!harness.chat.send('APP PROBE: count from 1 to 30, one number per line, then write DONE.')) throw new Error('the second message could not be sent');
    await harness.streaming();
    harness.chat.reconnect();
    await harness.ready();
    await harness.nextEnd(2);
    const second = harness.ended[1] as DtPartnerTurn;
    page = await partnerHistoryPage(client, partnerId, key);
    const latest = page.records.filter((record) => record.role === 'assistant').at(-1);
    if (second.reply.status !== 'completed' || !latest || latest.content.trim() !== second.reply.answer.trim()) throw new Error(`after reconnecting, the reply was ${second.reply.status} and ${latest?.content.trim() === second.reply.answer.trim() ? 'matched' : 'did not match'} history`);
    if (!/DONE/.test(second.reply.answer)) throw new Error('the followed reply is missing its end');
    harness.chat.close();
    harness = null;

    // The conversation: listed, archived, brought back, deleted.
    let sessions = await listPartnerSessions(client, partnerId);
    fixture.sessions = { shape: sessions[0] ? shapeOf(sessions[0]) : null };
    if (currentWebSession(sessions)?.key !== key) throw new Error('the conversation is not the one to carry on');
    await archivePartnerSession(client, partnerId, key);
    sessions = await listPartnerSessions(client, partnerId);
    if (!sessions.find((session) => session.key === key)?.archived || currentWebSession(sessions)) throw new Error('archiving did not take');
    await resumePartnerSession(client, partnerId, key);
    if ((await listPartnerSessions(client, partnerId)).find((session) => session.key === key)?.archived !== false) throw new Error('bringing it back did not take');
    const navigation = await recentPartnerConversations(client);
    if (!navigation.some((row) => row.kind === 'partner' && row.ownerId === partnerId && row.sessionKey === key)) throw new Error('the sidebar does not list the conversation');
    await deletePartnerSession(client, partnerId, key);
    if ((await listPartnerSessions(client, partnerId)).some((session) => session.key === key)) throw new Error('the conversation is still listed after deleting');

    await stopPartner(client, partnerId);
    if ((await getPartner(client, partnerId)).running) throw new Error('still running after stop');
    return {
      note: `a partner made from the "${soul.id}" soul; a reply streamed and read back the same; a second followed again after a dropped socket; the conversation listed, archived, brought back and deleted; the partner stopped (${own.length} partners and ${groups.length} groups of the account's own left alone)`,
      fixture,
    };
  } finally {
    harness?.chat.close();
    if (partnerId) await deletePartner(client, partnerId).catch(() => undefined);
  }
}
