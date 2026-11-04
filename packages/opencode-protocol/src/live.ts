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
}

type AnyPart = Part | OtherPart;

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function emptyLive(sessionID: string): SessionLive {
  return { sessionID, messages: [], status: { type: 'idle' }, todos: [], permissions: [], questions: [], error: null };
}

/** A session's saved history (OpenCode's ids sort by time), with what's pending laid over it. */
export function liveFromHistory(
  sessionID: string,
  history: MessageWithParts[],
  pending: { status?: SessionStatus; todos?: Todo[]; permissions?: PermissionRequest[]; questions?: QuestionRequest[] } = {},
): SessionLive {
  return {
    sessionID,
    messages: history.map((entry) => ({ info: entry.info, parts: [...entry.parts].sort(byId) })).sort((a, b) => byId(a.info, b.info)),
    status: pending.status ?? { type: 'idle' },
    todos: pending.todos ?? [],
    permissions: (pending.permissions ?? []).filter((item) => item.sessionID === sessionID),
    questions: (pending.questions ?? []).filter((item) => item.sessionID === sessionID),
    error: null,
  };
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

/** Applies one event from the stream. Events for other sessions change nothing. */
export function applyEvent(live: SessionLive, event: OcEvent): SessionLive {
  const props = event.properties;
  const sessionID = text(props.sessionID) || text((props.info as { sessionID?: unknown } | undefined)?.sessionID) || text((props.part as { sessionID?: unknown } | undefined)?.sessionID);
  if (sessionID !== live.sessionID) return live;

  switch (event.type) {
    case 'message.updated': {
      const info = props.info as Message | undefined;
      return info?.id ? { ...live, messages: upsertMessage(live.messages, info) } : live;
    }
    case 'message.removed':
      return { ...live, messages: live.messages.filter((entry) => entry.info.id !== text(props.messageID)) };
    case 'message.part.updated': {
      const part = props.part as AnyPart | undefined;
      return part?.id && part.messageID ? { ...live, messages: withPart(live.messages, part) } : live;
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
    case 'permission.replied':
      return { ...live, permissions: live.permissions.filter((item) => item.id !== text(props.requestID)) };
    case 'question.asked': {
      const request = props as unknown as QuestionRequest;
      return request.id ? { ...live, questions: [...live.questions.filter((item) => item.id !== request.id), request] } : live;
    }
    case 'question.replied':
    case 'question.rejected':
      return { ...live, questions: live.questions.filter((item) => item.id !== text(props.requestID)) };
    default:
      return live;
  }
}

/** Whether the session is working on a reply. */
export const isWorking = (live: SessionLive): boolean => live.status.type !== 'idle';
