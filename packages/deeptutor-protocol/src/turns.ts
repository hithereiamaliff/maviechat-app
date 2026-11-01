/**
 * DeepTutor's turn protocol 2.0, spoken over the `/ws` WebSocket: the commands the app sends
 * and the events it receives. Field names are the server's. A turn's events are numbered by
 * `seq` from 1, so a client that reconnects asks for the ones after the last it applied.
 */

export const TURN_PROTOCOL_VERSION = '2.0';

export type DtStreamEventType =
  | 'stage_start'
  | 'stage_end'
  | 'thinking'
  | 'observation'
  | 'content'
  | 'tool_call'
  | 'tool_result'
  | 'progress'
  | 'sources'
  | 'result'
  | 'error'
  | 'session'
  | 'session_meta'
  | 'wait_for_input'
  | 'done';

const STREAM_TYPES = new Set<string>([
  'stage_start',
  'stage_end',
  'thinking',
  'observation',
  'content',
  'tool_call',
  'tool_result',
  'progress',
  'sources',
  'result',
  'error',
  'session',
  'session_meta',
  'wait_for_input',
  'done',
]);

/** One event of a turn. What a field means depends on `type`; `metadata` carries the rest. */
export interface DtStreamEvent {
  type: DtStreamEventType;
  content: string;
  metadata: Record<string, unknown>;
  source: string;
  stage: string;
  session_id: string;
  turn_id: string;
  seq: number;
  /** Unix seconds. */
  timestamp: number;
}

/** The answer to a command that carries a `command_id` (cancel, replies to a question). */
export interface DtCommandAck {
  type: 'command_ack';
  command_id: string;
  command_type: string;
  accepted: boolean;
  error_code: string;
  message: string;
  turn_id: string;
}

/** A command the server refused, or a subscription that broke. */
export interface DtProtocolError {
  type: 'protocol_error';
  error_code: string;
  message: string;
  retryable: boolean;
  session_id: string;
  turn_id: string;
}

/** The answer to `check_active_turn`: `status` is "none" when the session is idle. */
export interface DtActiveTurnInfo {
  type: 'active_turn_info';
  turn_id: string;
  status: string;
  owner_id: string;
}

export type DtServerEvent = DtStreamEvent | DtCommandAck | DtProtocolError | DtActiveTurnInfo | { type: 'pong' };

/** Rejections that end a turn before it starts: no `done` follows them. */
export const TERMINAL_ERROR_CODES = new Set([
  'start_turn_rejected',
  'regenerate_rejected',
  'invalid_command',
  'invalid_json',
  'unsupported_protocol_version',
  'unknown_message_type',
]);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Reads one WebSocket frame. Anything that isn't a known event comes back as null. */
export function parseServerEvent(raw: unknown): DtServerEvent | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const event = record(value);
  const type = event.type;
  if (type === 'pong') return { type };
  if (type === 'command_ack') {
    return {
      type,
      command_id: text(event.command_id),
      command_type: text(event.command_type),
      accepted: event.accepted === true,
      error_code: text(event.error_code),
      message: text(event.message),
      turn_id: text(event.turn_id),
    };
  }
  if (type === 'protocol_error') {
    return {
      type,
      error_code: text(event.error_code),
      message: text(event.message),
      retryable: event.retryable === true,
      session_id: text(event.session_id),
      turn_id: text(event.turn_id),
    };
  }
  if (type === 'active_turn_info') {
    return { type, turn_id: text(event.turn_id), status: text(event.status) || 'none', owner_id: text(event.owner_id) };
  }
  if (typeof type !== 'string' || !STREAM_TYPES.has(type)) return null;
  const metadata = record(event.metadata);
  return {
    type: type as DtStreamEventType,
    content: text(event.content),
    metadata,
    source: text(event.source),
    stage: text(event.stage),
    // The `session` event names them in its metadata too.
    session_id: text(event.session_id) || text(metadata.session_id),
    turn_id: text(event.turn_id) || text(metadata.turn_id),
    seq: typeof event.seq === 'number' && Number.isFinite(event.seq) ? event.seq : 0,
    timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now() / 1000,
  };
}

/** A model to answer with: one of `GET /api/settings/llm-options`'s options. */
export interface DtLlmSelection {
  profile_id: string;
  model_id: string;
}

export interface DtOutgoingAttachment {
  type: string;
  url?: string | null;
  base64?: string | null;
  filename?: string | null;
  mime_type?: string | null;
  id?: string | null;
}

/** What to ask. Leave a field out to keep the session's own choice. */
export interface DtTurnRequest {
  content: string;
  /** Omitted for a new chat: the server creates one and names it in the turn's `session` event. */
  sessionId?: string | null;
  /** "chat" unless given. */
  capability?: string;
  tools?: string[];
  knowledgeBases?: string[];
  llmSelection?: DtLlmSelection | null;
  /** Only to branch from an earlier message; without it the turn continues the conversation shown. */
  parentMessageId?: number | null;
  attachments?: DtOutgoingAttachment[];
  notebookReferences?: { notebook_id: string; record_ids?: string[] }[];
  historyReferences?: string[];
  language?: string;
  /** Lets the server treat a command sent again after a reconnect as the same submission. */
  clientSubmissionId?: string;
}

export type DtCommand = Record<string, unknown> & { protocol_version: string; type: string };

export function startTurnCommand(request: DtTurnRequest): DtCommand {
  const command: DtCommand = {
    protocol_version: TURN_PROTOCOL_VERSION,
    type: 'start_turn',
    content: request.content,
    capability: request.capability ?? 'chat',
  };
  // The server reads an absent field as "keep the session's", and null as "clear it".
  if (request.sessionId) command.session_id = request.sessionId;
  if (request.tools) command.tools = request.tools;
  if (request.knowledgeBases) command.knowledge_bases = request.knowledgeBases;
  if (request.llmSelection) command.llm_selection = request.llmSelection;
  if (request.parentMessageId != null) command.parent_message_id = request.parentMessageId;
  if (request.attachments?.length) command.attachments = request.attachments;
  if (request.notebookReferences?.length) command.notebook_references = request.notebookReferences;
  if (request.historyReferences?.length) command.history_references = request.historyReferences;
  if (request.language) command.language = request.language;
  if (request.clientSubmissionId) command.client_submission_id = request.clientSubmissionId;
  return command;
}

/** Replays a turn's events after `afterSeq`, then follows it live. */
export function resumeTurnCommand(turnId: string, afterSeq: number): DtCommand {
  return { protocol_version: TURN_PROTOCOL_VERSION, type: 'resume_from', turn_id: turnId, seq: Math.max(0, Math.floor(afterSeq)) };
}

export function cancelTurnCommand(turnId: string, commandId: string): DtCommand {
  return { protocol_version: TURN_PROTOCOL_VERSION, type: 'cancel_turn', turn_id: turnId, command_id: commandId };
}

/** Answers again to the session's last message, as a new reply beside the old one. */
export function regenerateCommand(sessionId: string): DtCommand {
  return { protocol_version: TURN_PROTOCOL_VERSION, type: 'regenerate', session_id: sessionId };
}

export function checkActiveTurnCommand(sessionId: string): DtCommand {
  return { protocol_version: TURN_PROTOCOL_VERSION, type: 'check_active_turn', session_id: sessionId };
}

/** The reply to a turn waiting for input (`wait_for_input`). */
export function submitUserReplyCommand(turnId: string, commandId: string, reply: { text?: string; answers?: { questionId: string; text: string }[] }): DtCommand {
  return {
    protocol_version: TURN_PROTOCOL_VERSION,
    type: 'submit_user_reply',
    turn_id: turnId,
    command_id: commandId,
    ...(reply.text !== undefined ? { text: reply.text } : {}),
    ...(reply.answers ? { answers: reply.answers } : {}),
  };
}

export function pingCommand(): DtCommand {
  return { protocol_version: TURN_PROTOCOL_VERSION, type: 'ping' };
}

/**
 * The `Cookie` header that signs a socket in. iOS adds the cookies it already holds for the
 * site (the `dt_token` from signing in) and then appends ours after a comma, so a plain
 * `dt_token=…` arrives as `dt_token=A,dt_token=B`, one unreadable value. Starting ours with a
 * throwaway pair puts our `dt_token` in a pair of its own at the end, and DeepTutor (Starlette)
 * keeps the last value of a repeated cookie. The token never goes in the URL: DeepTutor's log
 * records socket query strings.
 */
export function socketCookieHeader(token: string): string {
  return `maviechat=1; dt_token=${token}`;
}

/** The `/ws` address behind a DeepTutor web address. */
export function turnSocketUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '').replace(/^http/i, 'ws')}/ws`;
}

/** A random id (UUID v4 form) for command ids and submissions. */
export function randomId(): string {
  const bytes = new Uint8Array(16);
  const crypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
