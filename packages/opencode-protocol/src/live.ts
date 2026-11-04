import type { Message, MessageWithParts, OcEvent, OtherPart, Part, PermissionRequest, QuestionRequest, SessionStatus, Todo } from './types';

/**
 * One session as it is now: its messages with their parts, whether it's working, its todo list,
 * and what it's waiting on you for. Built from the saved history, then kept current by the
 * event stream. Each change returns a new object (and new copies of only what changed), so a
 * screen can redraw just that.
 */
export interface SessionLive {
  sessionID: string;
  messages: MessageWithParts[];
  status: SessionStatus;
  todos: Todo[];
  permissions: PermissionRequest[];
  questions: QuestionRequest[];
  /** The last error OpenCode reported for this session, in words. */
  error: string | null;
  /** Sessions this one started (subagents, and theirs): what they ask you shows here too. */
  children: string[];
}

type AnyPart = Part | OtherPart;

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function emptyLive(sessionID: string): SessionLive {
  return { sessionID, messages: [], status: { type: 'idle' }, todos: [], permissions: [], questions: [], error: null, children: [] };
}

/** The session a subagent call runs in, from the task tool's metadata. */
function childSession(part: AnyPart): string {
  if (part.type !== 'tool') return '';
  const metadata = (part as { state?: { metadata?: Record<string, unknown> } }).state?.metadata;
  return text(metadata?.sessionId) || text(metadata?.sessionID);
}

/** A session's saved history (OpenCode's ids sort by time), with what's pending laid over it. */
export function liveFromHistory(
  sessionID: string,
  history: MessageWithParts[],
  pending: { status?: SessionStatus; todos?: Todo[]; permissions?: PermissionRequest[]; questions?: QuestionRequest[] } = {},
): SessionLive {
  const messages = history.map((entry) => ({ info: entry.info, parts: [...entry.parts].sort(byId) })).sort((a, b) => byId(a.info, b.info));
  const children = [...new Set(messages.flatMap((entry) => entry.parts.map(childSession)).filter(Boolean))];
  const ours = (item: { sessionID: string }) => item.sessionID === sessionID || children.includes(item.sessionID);
  return {
    sessionID,
    messages,
    status: pending.status ?? { type: 'idle' },
    todos: pending.todos ?? [],
    permissions: (pending.permissions ?? []).filter(ours),
    questions: (pending.questions ?? []).filter(ours),
    error: null,
    children,
  };
}

/** A request taken off the list once answered or withdrawn (the same object when it wasn't there). */
function without<T extends { id: string }>(list: T[], id: string): T[] {
  return list.some((item) => item.id === id) ? list.filter((item) => item.id !== id) : list;
}

function upsertMessage(messages: MessageWithParts[], info: Message): MessageWithParts[] {
  const index = messages.findIndex((entry) => entry.info.id === info.id);
  if (index >= 0) return messages.map((entry, at) => (at === index ? { ...entry, info } : entry));
  return [...messages, { info, parts: [] }].sort((a, b) => byId(a.info, b.info));
}

/** A part can arrive before its message: a stand-in message holds it until the real one comes. */
function standIn(part: AnyPart): Message {
  return { id: part.messageID, sessionID: part.sessionID, role: 'assistant', time: { created: 0 } };
}

function withPart(messages: MessageWithParts[], part: AnyPart): MessageWithParts[] {
  const list = messages.some((entry) => entry.info.id === part.messageID) ? messages : upsertMessage(messages, standIn(part));
  return list.map((entry) => {
    if (entry.info.id !== part.messageID) return entry;
    const index = entry.parts.findIndex((item) => item.id === part.id);
    const parts = index >= 0 ? entry.parts.map((item, at) => (at === index ? part : item)) : [...entry.parts, part].sort(byId);
    return { ...entry, parts };
  });
}

function appendDelta(messages: MessageWithParts[], messageID: string, partID: string, field: string, delta: string): MessageWithParts[] {
  let changed = false;
  const next = messages.map((entry) => {
    if (entry.info.id !== messageID) return entry;
    const parts = entry.parts.map((part) => {
      if (part.id !== partID) return part;
      const current = (part as unknown as Record<string, unknown>)[field];
      if (typeof current !== 'string' && current !== undefined) return part;
      changed = true;
      return { ...part, [field]: (current ?? '') + delta } as AnyPart;
    });
    return changed ? { ...entry, parts } : entry;
  });
  return changed ? next : messages;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** OpenCode's error object in words. */
export function errorText(error: unknown): string {
  const value = (error ?? {}) as { name?: unknown; data?: { message?: unknown } };
  const message = text(value.data?.message);
  if (value.name === 'MessageAbortedError') return 'Stopped.';
  return message || text(value.name) || 'Something went wrong.';
}

/**
 * Applies one event from the stream. Events for other sessions change nothing, except that a
 * subagent this session started joins it, and what a subagent asks you shows here too.
 */
export function applyEvent(live: SessionLive, event: OcEvent): SessionLive {
  const props = event.properties;

  // An answered or withdrawn request leaves the list, whichever session asked it.
  if (event.type === 'permission.replied') {
    const permissions = without(live.permissions, text(props.requestID));
    return permissions === live.permissions ? live : { ...live, permissions };
  }
  if (event.type === 'question.replied' || event.type === 'question.rejected') {
    const questions = without(live.questions, text(props.requestID));
    return questions === live.questions ? live : { ...live, questions };
  }
  if (event.type === 'session.created' || event.type === 'session.updated') {
    const info = props.info as { id?: unknown; parentID?: unknown } | undefined;
    const id = text(info?.id);
    const parent = text(info?.parentID);
    const joins = id && parent && (parent === live.sessionID || live.children.includes(parent)) && !live.children.includes(id);
    return joins ? { ...live, children: [...live.children, id] } : live;
  }

  const sessionID = text(props.sessionID) || text((props.info as { sessionID?: unknown } | undefined)?.sessionID) || text((props.part as { sessionID?: unknown } | undefined)?.sessionID);
  if (sessionID !== live.sessionID) {
    // From a subagent: only what it asks you. Its messages stay in its own session.
    if (!live.children.includes(sessionID)) return live;
    if (event.type === 'permission.asked' && text(props.id)) {
      const request = props as unknown as PermissionRequest;
      return { ...live, permissions: [...live.permissions.filter((item) => item.id !== request.id), request] };
    }
    if (event.type === 'question.asked' && text(props.id)) {
      const request = props as unknown as QuestionRequest;
      return { ...live, questions: [...live.questions.filter((item) => item.id !== request.id), request] };
    }
    return live;
  }

  switch (event.type) {
    case 'message.updated': {
      const info = props.info as Message | undefined;
      return info?.id ? { ...live, messages: upsertMessage(live.messages, info) } : live;
    }
    case 'message.removed':
      return { ...live, messages: live.messages.filter((entry) => entry.info.id !== text(props.messageID)) };
    case 'message.part.updated': {
      const part = props.part as AnyPart | undefined;
      if (!part?.id || !part.messageID) return live;
      const child = childSession(part);
      return { ...live, messages: withPart(live.messages, part), ...(child && !live.children.includes(child) ? { children: [...live.children, child] } : {}) };
    }
    case 'message.part.removed':
      return {
        ...live,
        messages: live.messages.map((entry) => (entry.info.id === text(props.messageID) ? { ...entry, parts: entry.parts.filter((part) => part.id !== text(props.partID)) } : entry)),
      };
    case 'message.part.delta': {
      const messages = appendDelta(live.messages, text(props.messageID), text(props.partID), text(props.field) || 'text', text(props.delta));
      return messages === live.messages ? live : { ...live, messages };
    }
    case 'session.status': {
      const status = props.status as SessionStatus | undefined;
      return status?.type ? { ...live, status, error: status.type === 'busy' ? null : live.error } : live;
    }
    case 'session.idle':
      return { ...live, status: { type: 'idle' } };
    case 'session.error':
      return { ...live, error: errorText(props.error) };
    case 'todo.updated':
      return Array.isArray(props.todos) ? { ...live, todos: props.todos as Todo[] } : live;
    case 'permission.asked': {
      const request = props as unknown as PermissionRequest;
      return request.id ? { ...live, permissions: [...live.permissions.filter((item) => item.id !== request.id), request] } : live;
    }
    case 'question.asked': {
      const request = props as unknown as QuestionRequest;
      return request.id ? { ...live, questions: [...live.questions.filter((item) => item.id !== request.id), request] } : live;
    }
    default:
      return live;
  }
}

/** Whether the session is working on a reply. */
export const isWorking = (live: SessionLive): boolean => live.status.type !== 'idle';
