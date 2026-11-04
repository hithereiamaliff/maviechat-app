import { describe, expect, it } from 'vitest';
import { DtClient, type FetchLike } from './http';
import {
  applyGroupFrame,
  canSummarise,
  createPartnerGroup,
  deleteGroupSession,
  deletePartnerGroup,
  groupFrames,
  groupHistory,
  groupRounds,
  groupSocketUrl,
  groupWhiteboard,
  listGroupInvocations,
  listGroupSessions,
  listPartnerGroups,
  newGroupSessionKey,
  NO_GROUP_LIVE,
  parseGroupFrame,
  pinGroupMessage,
  resolveMentions,
  unpinGroupMessage,
  updatePartnerGroup,
  type DtGroupFrame,
  type DtGroupLive,
} from './partnerGroups';

function recordingClient(answer: unknown, status = 200) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer), { status });
  };
  return { client: new DtClient({ baseUrl: 'https://learn.test', token: 't', fetch }), calls };
}

const message = (eventId: string, turnId: string, extra: Partial<Record<string, unknown>> = {}) => ({
  event_id: eventId,
  turn_id: turnId,
  session_key: 's',
  role: 'partner',
  content: `${eventId} says`,
  author_id: 'ada',
  author_name: 'Ada',
  created_at: '2026-11-04T06:00:00+00:00',
  mentions: [],
  error: false,
  kind: 'message',
  events: [],
  invocation_id: '',
  invocation: null,
  ...extra,
});
const parsed = (raw: Record<string, unknown>) => (parseGroupFrame({ type: 'partner_message', message: raw }) as Extract<DtGroupFrame, { type: 'partner_message' }>).message;
const at = (minute: number) => `2026-11-04T06:${String(minute).padStart(2, '0')}:00+00:00`;

describe('groups', () => {
  it('reads groups with every member id and the members you can use', async () => {
    const groups = await listPartnerGroups(
      recordingClient([{ group_id: 'g', name: 'Panel', member_ids: ['ada', 'gone', 'bo'], members: [{ partner_id: 'ada', name: 'Ada' }, { partner_id: 'bo', name: 'Bo' }], discussion_mode: 'debate', color: 'nope', updated_at: '2026-11-04T06:00:00+00:00' }, { name: 'no id' }]).client,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 'g', emoji: '👥', color: '', mode: 'debate', memberIds: ['ada', 'gone', 'bo'], updatedAt: Date.UTC(2026, 10, 4, 6) });
    expect(groups[0]?.members.map((member) => member.id)).toEqual(['ada', 'bo']);
  });

  it('creates, changes and deletes a group over the web’s routes', async () => {
    const { client, calls } = recordingClient({ group_id: 'g', name: 'Panel' });
    await createPartnerGroup(client, { name: ' Panel ', memberIds: ['ada', 'bo'] });
    expect(calls[0]?.body).toEqual({ name: 'Panel', description: '', member_ids: ['ada', 'bo'], discussion_mode: 'panel_parallel', shared_memory: 'whiteboard', emoji: '👥', color: '#b0501e' });
    await updatePartnerGroup(client, 'g', { mode: 'sequential', memberIds: ['bo', 'ada'] });
    expect(calls[1]).toMatchObject({ method: 'PATCH', url: 'https://learn.test/api/partner-groups/g', body: { member_ids: ['bo', 'ada'], discussion_mode: 'sequential' } });
    await deletePartnerGroup(client, 'g');
    expect(calls[2]?.method).toBe('DELETE');
  });

  it('lists discussions, makes keys as the web does, and deletes one', async () => {
    const { client, calls } = recordingClient([{ session_key: 'group-1', title: 'Colours', message_count: 3, updated_at: at(5) }]);
    expect(await listGroupSessions(client, 'g')).toEqual([{ key: 'group-1', title: 'Colours', messageCount: 3, updatedAt: Date.UTC(2026, 10, 4, 6, 5) }]);
    expect(newGroupSessionKey(36 ** 3, () => 0.5)).toBe('group-1000-iiiiiiii');
    await deleteGroupSession(client, 'g', 'group-1');
    expect(calls[1]).toMatchObject({ method: 'DELETE', url: 'https://learn.test/api/partner-groups/g/sessions/group-1' });
  });

  it('reads history, follow-up proposals and the whiteboard; pins and unpins', async () => {
    const history = await groupHistory(recordingClient([message('m1', 't1', { invocation: { invocation_id: 'i1', status: 'pending', requester_partner_id: 'ada', target_partner_id: 'bo', question: 'Why?' } }), { nonsense: true }]).client, 'g', 's');
    expect(history).toHaveLength(1);
    expect(history[0]?.invocation).toMatchObject({ id: 'i1', status: 'pending', requesterId: 'ada', targetId: 'bo', question: 'Why?' });
    expect(await listGroupInvocations(recordingClient([{ invocation_id: 'i1', status: 'odd' }]).client, 'g', 's')).toMatchObject([{ id: 'i1', status: 'pending' }]);
    expect(await groupWhiteboard(recordingClient([{ event_id: 'm1', author_name: 'Ada', content: 'Blue', pinned_at: at(1) }]).client, 'g')).toEqual([{ eventId: 'm1', authorName: 'Ada', content: 'Blue', pinnedAt: Date.UTC(2026, 10, 4, 6, 1) }]);
    const { client, calls } = recordingClient({ created: true });
    await pinGroupMessage(client, 'g', 'm1');
    await unpinGroupMessage(client, 'g', 'm1');
    expect(calls.map((call) => `${call.method} ${call.url.replace('https://learn.test/api/partner-groups/g', '')}`)).toEqual(['POST /whiteboard/pins', 'DELETE /whiteboard/pins/m1']);
  });
});

describe('mentions', () => {
  const members = [
    { id: 'ada', name: 'Ada' },
    { id: 'bo', name: 'Bo Li' },
    { id: 'cy', name: 'Cy' },
  ];
  it('names members by id or name (longest first), in member order', () => {
    expect(resolveMentions('@Bo Li and @ada, what do you think?', members)).toEqual({ mentions: ['ada', 'bo'], targets: ['ada', 'bo'], unknown: [] });
    expect(resolveMentions('@cy hi', members).mentions).toEqual(['cy']);
  });
  it('reads no mention or @all as everyone, and reports names it doesn’t know', () => {
    expect(resolveMentions('What do you all think?', members)).toEqual({ mentions: [], targets: ['ada', 'bo', 'cy'], unknown: [] });
    expect(resolveMentions('@all go', members).mentions).toEqual([]);
    expect(resolveMentions('@所有人 go', members).mentions).toEqual([]);
    expect(resolveMentions('@ada and @zed', members)).toEqual({ mentions: ['ada'], targets: ['ada'], unknown: ['@zed'] });
    expect(resolveMentions('@zed only', members)).toEqual({ mentions: null, targets: ['ada', 'bo', 'cy'], unknown: ['@zed'] });
  });
});

describe('rounds', () => {
  const order = ['ada', 'bo'];
  it('lays a round out in member order: openings, then rebuttals, then a summary', () => {
    const history = [
      parsed(message('u1', 't1', { role: 'user', author_id: 'me', content: 'Colours?', mentions: ['ada', 'bo'], created_at: at(0) })),
      parsed(message('r-bo', 't1', { author_id: 'bo', author_name: 'Bo', kind: 'debate_rebuttal', created_at: at(4) })),
      parsed(message('o-bo', 't1', { author_id: 'bo', author_name: 'Bo', created_at: at(1) })),
      parsed(message('o-ada', 't1', { created_at: at(2) })),
      parsed(message('r-ada', 't1', { kind: 'debate_rebuttal', created_at: at(3) })),
      parsed(message('sum', 't1', { kind: 'round_summary', created_at: at(5) })),
    ];
    const [round] = groupRounds(history, order);
    expect(round?.user?.content).toBe('Colours?');
    expect(round?.seats.map((seat) => seat.key)).toEqual(['o-ada', 'o-bo', 'r-ada', 'r-bo', 'sum']);
    expect(round?.summarised).toBe(true);
    expect(canSummarise(round!)).toBe(false);
  });

  it('shows a failed seat, a stopped round, and when a round can be summed up', () => {
    const history = [
      parsed(message('u1', 't1', { role: 'user', created_at: at(0) })),
      parsed(message('a1', 't1', { created_at: at(1) })),
      parsed(message('b1', 't1', { author_id: 'bo', error: true, content: 'Model down', created_at: at(2) })),
      parsed(message('u2', 't2', { role: 'user', created_at: at(3) })),
      parsed(message('stop', 't2', { role: 'system', kind: 'round_stopped', content: '', created_at: at(4) })),
    ];
    const [first, second] = groupRounds(history, order);
    expect(first?.seats.map((seat) => [seat.key, seat.state])).toEqual([
      ['a1', 'done'],
      ['b1', 'error'],
    ]);
    expect(first?.seats[1]?.reply.error).toBe('Model down');
    expect(canSummarise(first!)).toBe(false);
    expect(second?.stopped).toBe(true);
    const fine = groupRounds([...history.slice(0, 2), parsed(message('b2', 't1', { author_id: 'bo', created_at: at(2) }))], order)[0];
    expect(canSummarise(fine!)).toBe(true);
  });

  it('makes a follow-up a round of its own: the question, then the answer', () => {
    const history = [
      parsed(message('u1', 't1', { role: 'user', created_at: at(0) })),
      parsed(message('a1', 't1', { created_at: at(1), invocation: { invocation_id: 'i1', parent_turn_id: 't1', status: 'pending', requester_partner_id: 'ada', target_partner_id: 'bo', question: 'Bo, why green?' } })),
      parsed(message('q', 'f1', { kind: 'invocation_question', invocation_id: 'i1', content: 'Bo, why green?', mentions: ['bo'], created_at: at(2) })),
      parsed(message('ans', 'f1', { kind: 'invocation_reply', invocation_id: 'i1', author_id: 'bo', author_name: 'Bo', created_at: at(3) })),
    ];
    const live: DtGroupLive = { ...NO_GROUP_LIVE, invocations: { i1: { id: 'i1', sessionKey: 's', parentTurnId: 't1', requesterId: 'ada', requesterName: 'Ada', targetId: 'bo', targetName: 'Bo', question: 'Bo, why green?', status: 'completed', error: '', replyEventId: 'ans' } } };
    const [round, followUp] = groupRounds(history, order, live);
    expect(round?.seats[0]?.message?.invocation?.status).toBe('completed');
    expect(followUp).toMatchObject({ turnId: 'f1', user: null, question: { eventId: 'q' } });
    expect(followUp?.seats.map((seat) => [seat.key, seat.kind])).toEqual([['ans', 'invocation_reply']]);
  });
});

describe('the group socket', () => {
  it('has its own address (no token in it) and reads its frames', () => {
    expect(groupSocketUrl('https://learn.test', 'g 1')).toBe('wss://learn.test/ws/partner-groups/g%201');
    expect(parseGroupFrame('{"type":"done","result":{}}')).toEqual({ type: 'done' });
    expect(parseGroupFrame({ type: 'partner_started', partner_id: 'ada' })).toEqual({ type: 'partner_started', partnerId: 'ada', turnId: '', invocationId: '', retry: false });
    expect(parseGroupFrame({ type: 'cancelled', content: 'Stopped' })).toEqual({ type: 'cancelled', content: 'Stopped' });
    expect(parseGroupFrame({ type: 'partner_message', message: {} })).toBeNull();
    expect(parseGroupFrame('nope')).toBeNull();
  });

  it('follows a round from your message to every answer', () => {
    const user = parsed(message('u1', 't1', { role: 'user', mentions: ['ada', 'bo'], created_at: at(0) }));
    let live: DtGroupLive = { ...NO_GROUP_LIVE, running: 1 };
    live = applyGroupFrame(live, { type: 'user_message', message: user });
    let [round] = groupRounds([], order(), live);
    expect(round?.seats.map((seat) => seat.state)).toEqual(['waiting', 'waiting']);
    live = applyGroupFrame(live, { type: 'partner_started', partnerId: 'bo', turnId: '', invocationId: '', retry: false });
    live = applyGroupFrame(live, parseGroupFrame({ type: 'partner_trace', turn_id: 't1', partner_id: 'bo', partner_name: 'Bo', event: { type: 'content', content: 'Gre', metadata: {}, seq: 1 } }) as DtGroupFrame);
    live = applyGroupFrame(live, parseGroupFrame({ type: 'partner_trace', turn_id: 't1', partner_id: 'bo', partner_name: 'Bo', event: { type: 'content', content: 'en', metadata: {}, seq: 2 } }) as DtGroupFrame);
    [round] = groupRounds([], order(), live);
    expect(round?.seats.map((seat) => [seat.partnerId, seat.state, seat.reply.answer])).toEqual([
      ['ada', 'waiting', ''],
      ['bo', 'working', 'Green'],
    ]);
    live = applyGroupFrame(live, { type: 'partner_message', message: parsed(message('b1', 't1', { author_id: 'bo', author_name: 'Bo', content: 'Green.', created_at: at(1) })), retry: false });
    live = applyGroupFrame(live, { type: 'partner_message', message: parsed(message('a1', 't1', { content: 'Blue.', created_at: at(2) })), retry: false });
    [round] = groupRounds([], order(), live);
    expect(round?.seats.map((seat) => [seat.key, seat.state])).toEqual([
      ['a1', 'done'],
      ['b1', 'done'],
    ]);
    live = applyGroupFrame(live, { type: 'done' });
    expect(live.running).toBe(0);
    expect(groupRounds([], order(), live)[0]?.live).toBe(false);
  });

  it('follows a follow-up: its question, its member at work, its answer', () => {
    const question = parsed(message('q', 'f1', { kind: 'invocation_question', invocation_id: 'i1', content: 'Why?', created_at: at(2) }));
    let live: DtGroupLive = { ...NO_GROUP_LIVE, running: 1 };
    live = applyGroupFrame(live, { type: 'partner_message', message: question, retry: false });
    live = applyGroupFrame(live, { type: 'partner_started', partnerId: 'bo', turnId: '', invocationId: 'i1', retry: false });
    live = applyGroupFrame(live, parseGroupFrame({ type: 'partner_trace', turn_id: 'f1', partner_id: 'bo', partner_name: 'Bo', invocation_id: 'i1', event: { type: 'content', content: 'Because', metadata: {}, seq: 1 } }) as DtGroupFrame);
    let [round] = groupRounds([], order(), live);
    expect(round?.seats.map((seat) => [seat.kind, seat.state, seat.reply.answer])).toEqual([['invocation_reply', 'working', 'Because']]);
    live = applyGroupFrame(live, { type: 'partner_message', message: parsed(message('ans', 'f1', { kind: 'invocation_reply', invocation_id: 'i1', author_id: 'bo', content: 'Because.', created_at: at(3) })), retry: false });
    [round] = groupRounds([], order(), live);
    expect(round?.seats.map((seat) => [seat.key, seat.state])).toEqual([['ans', 'done']]);
  });

  it('ends what’s on the way when every operation has finished, keeping an error', () => {
    let live: DtGroupLive = { ...NO_GROUP_LIVE, running: 2 };
    live = applyGroupFrame(live, { type: 'partner_started', partnerId: 'ada', turnId: 't1', invocationId: '', retry: false });
    live = applyGroupFrame(live, { type: 'cancelled', content: 'Stopped' });
    expect(Object.keys(live.working)).toHaveLength(1);
    live = applyGroupFrame(live, { type: 'error', content: 'No Partner Group turn is currently running.' });
    expect(live).toMatchObject({ running: 0, working: {}, error: 'No Partner Group turn is currently running.' });
  });

  it('writes the client’s frames under DeepTutor’s names', () => {
    expect(JSON.parse(groupFrames.message('s', 'Hi', null))).toEqual({ content: 'Hi', session_key: 's', mentions: null });
    expect(JSON.parse(groupFrames.approve('s', 'i1'))).toEqual({ action: 'approve_invocation', invocation_id: 'i1', session_key: 's' });
    expect(JSON.parse(groupFrames.ask('s', 'ada', 'bo', 'Why?'))).toEqual({ action: 'create_invocation', session_key: 's', requester_partner_id: 'ada', target_partner_id: 'bo', question: 'Why?' });
    expect(JSON.parse(groupFrames.summarise('s', 't1', 'ada'))).toEqual({ action: 'summarize_round', session_key: 's', turn_id: 't1', partner_id: 'ada' });
    expect(JSON.parse(groupFrames.cancel('s'))).toEqual({ action: 'cancel', session_key: 's' });
  });
});

function order() {
  return ['ada', 'bo'];
}

describe('group socket connection', () => {
  it('follows the discussion once open, sends only while open, and reconnects', async () => {
    const { DtGroupSocket } = await import('./groupSocket');
    const sockets: { handlers: import('./turnConnection').DtSocketHandlers; sent: string[] }[] = [];
    const timers: { run: () => void; ms: number }[] = [];
    const frames: string[] = [];
    const states: string[] = [];
    const socket = new DtGroupSocket({
      url: 'wss://learn.test/ws/partner-groups/g',
      connect: (_url, handlers) => {
        const fake = { handlers, sent: [] as string[] };
        sockets.push(fake);
        return { send: (data) => fake.sent.push(data), close: () => undefined };
      },
      timers: { set: (run, ms) => timers.push({ run, ms }), clear: () => undefined },
      onFrame: (frame) => frames.push(frame.type),
      onState: (state) => states.push(state),
    });
    socket.open('s1');
    expect(socket.send('x')).toBe(false);
    sockets[0]!.handlers.onOpen();
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ action: 'attach', session_key: 's1' });
    socket.open('s2');
    expect(JSON.parse(sockets[0]!.sent[1]!)).toEqual({ action: 'attach', session_key: 's2' });
    sockets[0]!.handlers.onMessage('{"type":"done"}');
    expect(frames).toEqual(['done']);
    sockets[0]!.handlers.onClose(1006);
    expect(timers[0]?.ms).toBe(250);
    timers[0]!.run();
    sockets[1]!.handlers.onOpen();
    expect(JSON.parse(sockets[1]!.sent[0]!)).toEqual({ action: 'attach', session_key: 's2' });
    sockets[1]!.handlers.onClose(4404);
    expect(states.at(-1)).toBe('unavailable');
  });
});
