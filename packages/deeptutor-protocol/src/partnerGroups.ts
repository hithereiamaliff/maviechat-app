import type { DtClient } from './http';
import { partnerOf, partnerTime, streamEventOf, type DtPartner } from './partners';
import { applyTurnEvent, emptyReply, type DtReply } from './turnReply';
import type { DtStreamEvent } from './turns';

/*
 * DeepTutor's Partner Groups (1.7.1, `/api/partner-groups`): several of your partners answering
 * one discussion, side by side, in turn, or arguing it out. A message opens a round; each member
 * answers in its seat. A member may propose asking another a follow-up question, which waits for
 * your approval. Pinned messages (the whiteboard) go into every member's context. Groups are
 * private to their owner (admins can't see others').
 */

type Tree = Record<string, unknown>;
const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const groupPath = (id: string) => `/api/partner-groups/${encodeURIComponent(id)}`;

// ── Groups ───────────────────────────────────────────────────────────────────

export type DtGroupMember = Pick<DtPartner, 'id' | 'name' | 'description' | 'emoji' | 'color' | 'avatar' | 'running'>;

export interface DtPartnerGroup {
  id: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  /** Every member, in order (some may no longer be yours to use). */
  memberIds: string[];
  /** The members you can still use, in order. */
  members: DtGroupMember[];
  /** `panel_parallel`, `sequential` or `debate`. */
  mode: string;
  /** Milliseconds. */
  updatedAt: number | null;
}

/** How members take turns, in our words. */
export const DISCUSSION_MODES: { mode: string; label: string; hint: string }[] = [
  { mode: 'panel_parallel', label: 'Side by side', hint: 'Every member answers at once: the quickest.' },
  { mode: 'sequential', label: 'One after another', hint: 'Each builds on the answers before it: slower.' },
  { mode: 'debate', label: 'Argue it out', hint: 'Answers, then a round where each challenges the others: about twice the wait.' },
];
export const DISCUSSION_MODE_LABELS: Record<string, string> = Object.fromEntries(DISCUSSION_MODES.map((item) => [item.mode, item.label]));

/** The colours DeepTutor's group form offers (its first is the default). */
export const GROUP_COLORS = ['#b0501e', '#8c6a2f', '#4f7a5b', '#3d6b8a', '#6d5a8c', '#8a4f5f', '#a8763e', '#5b8a8a'] as const;

export function groupOf(raw: unknown): DtPartnerGroup {
  const row = isTree(raw) ? raw : {};
  return {
    id: text(row.group_id),
    name: text(row.name) || 'Group',
    description: text(row.description),
    emoji: text(row.emoji) || '👥',
    color: /^#[0-9a-f]{6}$/i.test(text(row.color)) ? text(row.color) : '',
    memberIds: list(row.member_ids).map(text).filter(Boolean),
    members: list(row.members).map(partnerOf),
    mode: text(row.discussion_mode) || 'panel_parallel',
    updatedAt: partnerTime(row.updated_at),
  };
}

/** Your groups, the latest change first. */
export async function listPartnerGroups(client: DtClient): Promise<DtPartnerGroup[]> {
  return list(await client.get<unknown>('/api/partner-groups'))
    .map(groupOf)
    .filter((group) => group.id);
}

/** One group; 404 when it's gone or not yours. */
export async function getPartnerGroup(client: DtClient, id: string): Promise<DtPartnerGroup> {
  return groupOf(await client.get<unknown>(groupPath(id)));
}

export interface DtGroupInput {
  name: string;
  description?: string;
  /** Two or more of your partners, in the order they answer. */
  memberIds: string[];
  mode?: string;
  emoji?: string;
  color?: string;
}

/** A new group (its whiteboard on); 422 with fewer than two members or a name that's too long. */
export async function createPartnerGroup(client: DtClient, input: DtGroupInput): Promise<DtPartnerGroup> {
  return groupOf(
    await client.post<unknown>('/api/partner-groups', {
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      member_ids: input.memberIds,
      discussion_mode: input.mode ?? 'panel_parallel',
      shared_memory: 'whiteboard',
      emoji: input.emoji || '👥',
      color: input.color || GROUP_COLORS[0],
    }),
  );
}

/** Changes a group's name, description, members or mode (the others are left as they are). */
export async function updatePartnerGroup(client: DtClient, id: string, change: Partial<Omit<DtGroupInput, 'emoji' | 'color'>>): Promise<DtPartnerGroup> {
  const body: Tree = {};
  if (change.name !== undefined) body.name = change.name.trim();
  if (change.description !== undefined) body.description = change.description.trim();
  if (change.memberIds !== undefined) body.member_ids = change.memberIds;
  if (change.mode !== undefined) body.discussion_mode = change.mode;
  const raw = await client.send<unknown>('PATCH', groupPath(id), { body });
  return groupOf(raw.data);
}

/** Deletes the group with all its discussions (the partners stay). */
export async function deletePartnerGroup(client: DtClient, id: string): Promise<void> {
  await client.delete<unknown>(groupPath(id));
}

// ── Discussions ──────────────────────────────────────────────────────────────

export interface DtGroupSession {
  key: string;
  /** The first message's start. */
  title: string;
  messageCount: number;
  updatedAt: number | null;
}

/** A group's discussions with at least one message, the latest first. */
export async function listGroupSessions(client: DtClient, id: string): Promise<DtGroupSession[]> {
  return list(await client.get<unknown>(`${groupPath(id)}/sessions`))
    .filter(isTree)
    .map((row) => ({ key: text(row.session_key), title: text(row.title), messageCount: typeof row.message_count === 'number' ? row.message_count : 0, updatedAt: partnerTime(row.updated_at) }))
    .filter((session) => session.key);
}

/** A new discussion's key, as the web makes them (`group-` time `-` 8 letters or digits). */
export function newGroupSessionKey(now: number = Date.now(), random: () => number = Math.random): string {
  let tail = '';
  while (tail.length < 8) tail += Math.floor(random() * 36).toString(36);
  return `group-${now.toString(36)}-${tail}`;
}

/** Deletes a discussion (409 while it runs); its pinned messages stay on the whiteboard. */
export async function deleteGroupSession(client: DtClient, id: string, key: string): Promise<void> {
  await client.delete<unknown>(`${groupPath(id)}/sessions/${encodeURIComponent(key)}`);
}

// ── Messages ─────────────────────────────────────────────────────────────────

export type DtInvocationStatus = 'pending' | 'approved' | 'completed' | 'failed' | 'cancelled' | 'rejected';

/** A member's proposal to ask another member something, which waits for you. */
export interface DtInvocation {
  id: string;
  sessionKey: string;
  /** The round it came from ("" when you asked it). */
  parentTurnId: string;
  requesterId: string;
  requesterName: string;
  targetId: string;
  targetName: string;
  question: string;
  status: DtInvocationStatus;
  error: string;
  replyEventId: string;
}

export function invocationOf(raw: unknown): DtInvocation | null {
  if (!isTree(raw) || !text(raw.invocation_id)) return null;
  const status = text(raw.status) as DtInvocationStatus;
  return {
    id: text(raw.invocation_id),
    sessionKey: text(raw.session_key),
    parentTurnId: text(raw.parent_turn_id),
    requesterId: text(raw.requester_partner_id),
    requesterName: text(raw.requester_partner_name) || text(raw.requester_partner_id),
    targetId: text(raw.target_partner_id),
    targetName: text(raw.target_partner_name) || text(raw.target_partner_id),
    question: text(raw.question),
    status: ['pending', 'approved', 'completed', 'failed', 'cancelled', 'rejected'].includes(status) ? status : 'pending',
    error: text(raw.error),
    replyEventId: text(raw.reply_event_id),
  };
}

export type DtGroupMessageKind = 'message' | 'debate_rebuttal' | 'round_summary' | 'invocation_question' | 'invocation_reply' | 'round_stopped';

export interface DtGroupMessage {
  eventId: string;
  turnId: string;
  sessionKey: string;
  role: 'user' | 'partner' | 'system';
  content: string;
  authorId: string;
  authorName: string;
  createdAt: number | null;
  /** On your message: the members it went to. */
  mentions: string[];
  /** The member couldn't answer (`content` says why). */
  error: boolean;
  kind: DtGroupMessageKind;
  /** The member's steps (reasoning, tools), seen only by you. */
  events: DtStreamEvent[];
  /** A follow-up this answer proposes, or answers. */
  invocation: DtInvocation | null;
  /** On a follow-up's question and answer: which follow-up. */
  invocationId: string;
}

const KINDS = new Set<DtGroupMessageKind>(['message', 'debate_rebuttal', 'round_summary', 'invocation_question', 'invocation_reply', 'round_stopped']);

export function groupMessageOf(raw: unknown): DtGroupMessage | null {
  if (!isTree(raw) || !text(raw.event_id)) return null;
  const role = raw.role === 'user' || raw.role === 'system' ? raw.role : 'partner';
  const kind = text(raw.kind) as DtGroupMessageKind;
  return {
    eventId: text(raw.event_id),
    turnId: text(raw.turn_id),
    sessionKey: text(raw.session_key),
    role,
    content: text(raw.content),
    authorId: text(raw.author_id),
    authorName: text(raw.author_name),
    createdAt: partnerTime(raw.created_at),
    mentions: list(raw.mentions).map(text).filter(Boolean),
    error: raw.error === true,
    kind: KINDS.has(kind) ? kind : 'message',
    events: list(raw.events).map(streamEventOf).filter((event): event is DtStreamEvent => event !== null),
    invocation: invocationOf(raw.invocation),
    invocationId: text(raw.invocation_id),
  };
}

/** A discussion's messages, oldest first (the last 200 at most: DeepTutor has no pages here). */
export async function groupHistory(client: DtClient, id: string, sessionKey: string, limit = 200): Promise<DtGroupMessage[]> {
  return list(await client.get<unknown>(`${groupPath(id)}/history`, { query: { session_key: sessionKey, limit } }))
    .map(groupMessageOf)
    .filter((message): message is DtGroupMessage => message !== null);
}

/** A discussion's follow-up proposals, oldest first. */
export async function listGroupInvocations(client: DtClient, id: string, sessionKey: string): Promise<DtInvocation[]> {
  return list(await client.get<unknown>(`${groupPath(id)}/invocations`, { query: { session_key: sessionKey } }))
    .map(invocationOf)
    .filter((invocation): invocation is DtInvocation => invocation !== null);
}

// ── The whiteboard ───────────────────────────────────────────────────────────

export interface DtWhiteboardPin {
  eventId: string;
  authorName: string;
  content: string;
  pinnedAt: number | null;
}

/** What's pinned for every member to keep in mind, across the group's discussions. */
export async function groupWhiteboard(client: DtClient, id: string): Promise<DtWhiteboardPin[]> {
  return list(await client.get<unknown>(`${groupPath(id)}/whiteboard`))
    .filter(isTree)
    .map((row) => ({ eventId: text(row.event_id), authorName: text(row.author_name), content: text(row.content), pinnedAt: partnerTime(row.pinned_at) }))
    .filter((pin) => pin.eventId);
}

/** Pins a message (409 for a failed or empty one); pinning twice is fine. */
export async function pinGroupMessage(client: DtClient, id: string, eventId: string): Promise<void> {
  await client.post<unknown>(`${groupPath(id)}/whiteboard/pins`, { event_id: eventId });
}

export async function unpinGroupMessage(client: DtClient, id: string, eventId: string): Promise<void> {
  await client.delete<unknown>(`${groupPath(id)}/whiteboard/pins/${encodeURIComponent(eventId)}`);
}

// ── Mentions ─────────────────────────────────────────────────────────────────

const EVERYONE = new Set(['all', '所有人', '全部']);

/**
 * Who a message goes to, as the web works it out: `@all` (or no mention) means everyone (`[]`);
 * members named by id or by name (names with spaces are matched longest first) are listed in
 * member order; when nothing can be matched, null lets DeepTutor read the text itself.
 */
export function resolveMentions(input: string, members: Pick<DtGroupMember, 'id' | 'name'>[]): { mentions: string[] | null; targets: string[]; unknown: string[] } {
  const tokens = [...input.matchAll(/(^|\s)@(\S+)/g)];
  if (!tokens.length) return { mentions: [], targets: members.map((member) => member.id), unknown: [] };
  const named = new Set<string>();
  const unknown: string[] = [];
  let everyone = false;
  for (const match of tokens) {
    const start = (match.index ?? 0) + (match[1]?.length ?? 0) + 1;
    const rest = input.slice(start).toLowerCase();
    if (EVERYONE.has((match[2] ?? '').toLowerCase())) {
      everyone = true;
      continue;
    }
    const candidates = [...members].sort((a, b) => b.name.length - a.name.length);
    const hit = candidates.find((member) => rest.startsWith(member.id.toLowerCase()) || rest.startsWith(member.name.toLowerCase()));
    if (hit) named.add(hit.id);
    else unknown.push(`@${match[2] ?? ''}`);
  }
  if (everyone) return { mentions: [], targets: members.map((member) => member.id), unknown };
  if (!named.size) return { mentions: null, targets: members.map((member) => member.id), unknown };
  const ordered = members.filter((member) => named.has(member.id)).map((member) => member.id);
  return { mentions: ordered, targets: ordered, unknown };
}

// ── Rounds ───────────────────────────────────────────────────────────────────

export type DtSeatState = 'waiting' | 'working' | 'done' | 'error';

/** One member's answer in a round (or its place, while it's on the way). */
export interface DtGroupSeat {
  key: string;
  partnerId: string;
  name: string;
  kind: DtGroupMessageKind;
  state: DtSeatState;
  /** Built from the member's steps and words. */
  reply: DtReply;
  message: DtGroupMessage | null;
}

/**
 * A round: your message and each member's answer; or a follow-up, one member's question to
 * another (with your approval) and its answer.
 */
export interface DtGroupRound {
  turnId: string;
  user: DtGroupMessage | null;
  /** A follow-up's question (its author asks the member it names). */
  question: DtGroupMessage | null;
  seats: DtGroupSeat[];
  /** You stopped it. */
  stopped: boolean;
  summarised: boolean;
  live: boolean;
}

/** A member's answer as the app shows replies: its steps rebuilt, its words as given. */
export function seatReply(message: DtGroupMessage): DtReply {
  let reply = emptyReply();
  for (const event of message.events) if (event.type !== 'done') reply = applyTurnEvent(reply, event);
  return { ...reply, turnId: message.eventId, answer: message.error ? '' : message.content || reply.answer, error: message.error ? message.content || 'This member couldn’t answer.' : null, status: message.error ? 'failed' : 'completed' };
}

export interface DtGroupWork {
  /** The round's turn, or for a follow-up "" until its steps say. */
  turnId: string;
  partnerId: string;
  name: string;
  invocationId: string;
  reply: DtReply;
}

/** What's on the way, from the socket: members at work, and your message's round. */
export interface DtGroupLive {
  /** Your message for the round in progress (until the discussion is read again). */
  user: DtGroupMessage | null;
  /** Messages that arrived on the socket (stored ones, by event id). */
  messages: DtGroupMessage[];
  /** Members at work, by `invocationId or turnId` and member. */
  working: Record<string, DtGroupWork>;
  /** Proposals as last heard of. */
  invocations: Record<string, DtInvocation>;
  /** Operations running in this discussion. */
  running: number;
  error: string | null;
}

export const NO_GROUP_LIVE: DtGroupLive = { user: null, messages: [], working: {}, invocations: {}, running: 0, error: null };

const PASS: Record<string, number> = { message: 0, debate_rebuttal: 1, round_summary: 2, invocation_reply: 0 };

/**
 * The discussion as rounds in time order, as the web lays them out: your message, then a seat per
 * member in member order (openings, then rebuttals, then a summary); a follow-up as a round of its
 * own. `live` adds what's on the way: members at work, and members your message went to still to start.
 */
export function groupRounds(history: DtGroupMessage[], memberOrder: string[], live: DtGroupLive = NO_GROUP_LIVE, names: Record<string, string> = {}): DtGroupRound[] {
  const byId = new Map<string, DtGroupMessage>();
  for (const message of [...history, ...live.messages]) byId.set(message.eventId, message);
  if (live.user) byId.set(live.user.eventId, live.user);
  const messages = [...byId.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const latest = (invocation: DtInvocation | null) => (invocation ? (live.invocations[invocation.id] ?? invocation) : null);
  const nameOf = (id: string, given = '') => given || names[id] || id;
  const order = (id: string) => {
    const at = memberOrder.indexOf(id);
    return at < 0 ? memberOrder.length : at;
  };

  const rounds: DtGroupRound[] = [];
  const byTurn = new Map<string, DtGroupRound>();
  const roundFor = (turnId: string) => {
    let round = byTurn.get(turnId);
    if (!round) {
      round = { turnId, user: null, question: null, seats: [], stopped: false, summarised: false, live: false };
      byTurn.set(turnId, round);
      rounds.push(round);
    }
    return round;
  };
  for (const message of messages) {
    const round = roundFor(message.turnId);
    if (message.role === 'user') round.user = message;
    else if (message.kind === 'round_stopped') round.stopped = true;
    else if (message.kind === 'invocation_question') round.question = { ...message, invocation: latest(message.invocation) };
    else {
      round.seats = round.seats.filter((seat) => seat.key !== message.eventId);
      round.seats.push({
        key: message.eventId,
        partnerId: message.authorId,
        name: nameOf(message.authorId, message.authorName),
        kind: message.kind,
        state: message.error ? 'error' : 'done',
        reply: seatReply(message),
        message: { ...message, invocation: latest(message.invocation) },
      });
      if (message.kind === 'round_summary') round.summarised = true;
    }
  }

  // Members at work: in their round, or in the follow-up whose question names their invocation.
  for (const work of Object.values(live.working)) {
    const round = work.invocationId ? rounds.find((item) => item.question?.invocationId === work.invocationId) : byTurn.get(work.turnId);
    if (!round) continue;
    round.live = true;
    // A member's place is dropped the moment its answer arrives, so one at work is always shown
    // (a rebuttal after its opening, a summary, a second try).
    round.seats.push({ key: `live:${work.invocationId || work.turnId}:${work.partnerId}`, partnerId: work.partnerId, name: nameOf(work.partnerId, work.name), kind: work.invocationId ? 'invocation_reply' : 'message', state: 'working', reply: work.reply, message: null });
  }
  // Members your message went to that haven't started.
  if (live.user && live.running > 0) {
    const round = byTurn.get(live.user.turnId);
    if (round) {
      round.live = true;
      for (const partnerId of live.user.mentions) {
        if (!round.seats.some((seat) => seat.partnerId === partnerId)) round.seats.push({ key: `wait:${live.user.turnId}:${partnerId}`, partnerId, name: nameOf(partnerId), kind: 'message', state: 'waiting', reply: { ...emptyReply(), status: 'running' }, message: null });
      }
    }
  }
  for (const round of rounds) round.seats.sort((a, b) => (PASS[a.kind] ?? 0) - (PASS[b.kind] ?? 0) || order(a.partnerId) - order(b.partnerId));
  return rounds;
}

/** Whether a round can be summed up: yours, finished, not stopped, not summed up yet, two answers or more. */
export function canSummarise(round: DtGroupRound): boolean {
  return Boolean(round.user) && !round.live && !round.stopped && !round.summarised && round.seats.filter((seat) => seat.state === 'done').length >= 2;
}

// ── The group socket ─────────────────────────────────────────────────────────

/** `/ws/partner-groups/{id}` behind a DeepTutor web address. Signed in with the cookie header, never the address. */
export function groupSocketUrl(baseUrl: string, id: string): string {
  return `${baseUrl.replace(/\/+$/, '').replace(/^http/i, 'ws')}/ws/partner-groups/${encodeURIComponent(id)}`;
}

export type DtGroupFrame =
  | { type: 'user_message'; message: DtGroupMessage }
  | { type: 'partner_started'; partnerId: string; turnId: string; invocationId: string; retry: boolean }
  | { type: 'partner_trace'; partnerId: string; partnerName: string; turnId: string; invocationId: string; event: DtStreamEvent; retry: boolean }
  | { type: 'partner_message'; message: DtGroupMessage; retry: boolean }
  | { type: 'invocation_updated'; invocation: DtInvocation }
  | { type: 'done' }
  | { type: 'cancelled'; content: string }
  | { type: 'cancel_requested' }
  | { type: 'error'; content: string };

export function parseGroupFrame(raw: unknown): DtGroupFrame | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isTree(value)) return null;
  switch (value.type) {
    case 'user_message':
    case 'partner_message': {
      const message = groupMessageOf(value.message);
      if (!message) return null;
      return value.type === 'user_message' ? { type: 'user_message', message } : { type: 'partner_message', message, retry: value.retry === true };
    }
    case 'partner_started':
      return { type: 'partner_started', partnerId: text(value.partner_id), turnId: text(value.turn_id), invocationId: text(value.invocation_id), retry: value.retry === true };
    case 'partner_trace': {
      const event = streamEventOf(value.event);
      return event ? { type: 'partner_trace', partnerId: text(value.partner_id), partnerName: text(value.partner_name), turnId: text(value.turn_id), invocationId: text(value.invocation_id), event, retry: value.retry === true } : null;
    }
    case 'invocation_updated': {
      const invocation = invocationOf(value.invocation);
      return invocation ? { type: 'invocation_updated', invocation } : null;
    }
    case 'done':
    case 'cancel_requested':
      return { type: value.type };
    case 'cancelled':
    case 'error':
      return { type: value.type, content: text(value.content) };
    default:
      return null;
  }
}

/**
 * The socket's news applied to what's on the way. A member's steps build its reply; its message
 * replaces it. `done`, `cancelled` and `error` each end one operation (then read the discussion again).
 */
export function applyGroupFrame(live: DtGroupLive, frame: DtGroupFrame): DtGroupLive {
  const keyOf = (scope: string, partnerId: string) => `${scope}|${partnerId}`;
  const busy = Math.max(live.running, 1);
  switch (frame.type) {
    case 'user_message':
      return { ...live, user: frame.message, running: busy, error: null };
    case 'partner_started': {
      // A round's members start without its turn (it's your message's); a follow-up's carry its invocation.
      const turnId = frame.turnId || (frame.invocationId ? '' : (live.user?.turnId ?? ''));
      const key = keyOf(frame.invocationId || turnId, frame.partnerId);
      return { ...live, running: busy, working: { ...live.working, [key]: { turnId, partnerId: frame.partnerId, name: live.working[key]?.name ?? '', invocationId: frame.invocationId, reply: { ...emptyReply(), status: 'running' } } } };
    }
    case 'partner_trace': {
      if (frame.event.type === 'done') return live;
      const turnId = frame.turnId || (frame.invocationId ? '' : (live.user?.turnId ?? ''));
      const key = keyOf(frame.invocationId || turnId, frame.partnerId);
      const work = live.working[key] ?? { turnId, partnerId: frame.partnerId, name: frame.partnerName, invocationId: frame.invocationId, reply: { ...emptyReply(), status: 'running' as const } };
      return { ...live, working: { ...live.working, [key]: { ...work, turnId: work.turnId || turnId, name: frame.partnerName || work.name, reply: { ...applyTurnEvent(work.reply, frame.event), status: 'running' } } } };
    }
    case 'partner_message': {
      const message = frame.message;
      const working = { ...live.working };
      if (message.kind !== 'invocation_question') {
        delete working[keyOf(message.invocationId || message.turnId, message.authorId)];
        delete working[keyOf(message.turnId, message.authorId)];
      }
      const invocations = message.invocation ? { ...live.invocations, [message.invocation.id]: message.invocation } : live.invocations;
      return { ...live, messages: [...live.messages.filter((item) => item.eventId !== message.eventId), message], working, invocations };
    }
    case 'invocation_updated':
      return { ...live, invocations: { ...live.invocations, [frame.invocation.id]: frame.invocation } };
    case 'done':
    case 'cancelled':
    case 'error': {
      const running = Math.max(0, live.running - 1);
      return { ...live, running, working: running ? live.working : {}, error: frame.type === 'error' ? frame.content : live.error };
    }
    case 'cancel_requested':
      return live;
  }
}

/** Client frames: a message (mentions: null lets DeepTutor read the text), and the actions. */
export const groupFrames = {
  message: (sessionKey: string, content: string, mentions: string[] | null) => JSON.stringify({ content, session_key: sessionKey, mentions }),
  attach: (sessionKey: string) => JSON.stringify({ action: 'attach', session_key: sessionKey }),
  approve: (sessionKey: string, invocationId: string) => JSON.stringify({ action: 'approve_invocation', invocation_id: invocationId, session_key: sessionKey }),
  reject: (sessionKey: string, invocationId: string) => JSON.stringify({ action: 'reject_invocation', invocation_id: invocationId, session_key: sessionKey }),
  ask: (sessionKey: string, requesterId: string, targetId: string, question: string) => JSON.stringify({ action: 'create_invocation', session_key: sessionKey, requester_partner_id: requesterId, target_partner_id: targetId, question }),
  retry: (sessionKey: string, turnId: string, partnerId: string) => JSON.stringify({ action: 'retry_partner', session_key: sessionKey, turn_id: turnId, partner_id: partnerId }),
  summarise: (sessionKey: string, turnId: string, partnerId: string) => JSON.stringify({ action: 'summarize_round', session_key: sessionKey, turn_id: turnId, partner_id: partnerId }),
  cancel: (sessionKey: string, invocationId?: string) => JSON.stringify({ action: 'cancel', session_key: sessionKey, ...(invocationId ? { invocation_id: invocationId } : {}) }),
};
