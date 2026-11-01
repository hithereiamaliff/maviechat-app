import type { DtMessage } from './sessions';
import { parseServerEvent, type DtStreamEvent } from './turns';

export type DtReplyStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

/** A tool the reply used, anchored where it was called in the answer text. */
export interface DtToolStep {
  /** The trace call id; the result arrives under the same id. */
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** How much answer text had been written when the tool was called. */
  offset: number;
  done: boolean;
  /** The tool's output, in Markdown. */
  result: string;
}

/** Reasoning from one model call (DeepTutor's agent loop makes one per round). */
export interface DtThought {
  id: string;
  text: string;
}

export interface DtSource {
  url: string;
  title: string;
  type: string;
}

/** A reply as DeepTutor's events build it, live or from a saved message. */
export interface DtReply {
  sessionId: string | null;
  turnId: string | null;
  status: DtReplyStatus;
  /** Every published answer chunk in order, the remarks written before tool calls included. */
  answer: string;
  thoughts: DtThought[];
  tools: DtToolStep[];
  sources: DtSource[];
  /** What it is doing right now ("Exploring", a stage), while it runs. */
  activity: string | null;
  error: string | null;
  /** The last event applied; events at or below it are repeats. */
  seq: number;
  /** From `done`: the saved user message and reply. */
  userMessageId: number | null;
  assistantMessageId: number | null;
  /** While `status` is "waiting": what the server asks. */
  question: { prompt: string; details: Record<string, unknown> } | null;
  /** The capability's own result (`result` metadata), for modes with more than text. */
  result: Record<string, unknown> | null;
}

export function emptyReply(sessionId: string | null = null, turnId: string | null = null): DtReply {
  return {
    sessionId,
    turnId,
    status: 'running',
    answer: '',
    thoughts: [],
    tools: [],
    sources: [],
    activity: null,
    error: null,
    seq: 0,
    userMessageId: null,
    assistantMessageId: null,
    question: null,
    result: null,
  };
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * Whether a `content` chunk belongs to the answer. Calls inside a capability's own steps stream
 * text too; only the agent loop's rounds and a final response make up what the reader sees.
 */
export function isAnswerContent(event: DtStreamEvent): boolean {
  if (event.type !== 'content') return false;
  if (!text(event.metadata.call_id)) return true;
  const kind = text(event.metadata.call_kind);
  return kind === 'agent_loop_round' || kind === 'llm_final_response';
}

function stageLabel(stage: string): string {
  const words = stage.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function appendThought(thoughts: DtThought[], id: string, chunk: string): DtThought[] {
  const last = thoughts[thoughts.length - 1];
  if (last && last.id === id) return [...thoughts.slice(0, -1), { id, text: last.text + chunk }];
  return [...thoughts, { id, text: chunk }];
}

function mergeSources(current: DtSource[], incoming: unknown): DtSource[] {
  if (!Array.isArray(incoming)) return current;
  const seen = new Set(current.map((source) => source.url));
  const next = [...current];
  for (const item of incoming) {
    const source = record(item);
    const url = text(source.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    next.push({ url, title: text(source.title) || url, type: text(source.type) });
  }
  return next;
}

/** Applies one event. Repeats (a `seq` already applied) leave the reply as it is. */
export function applyTurnEvent(reply: DtReply, event: DtStreamEvent): DtReply {
  if (event.seq > 0 && event.seq <= reply.seq) return reply;
  const next: DtReply = { ...reply, seq: Math.max(reply.seq, event.seq) };
  const meta = event.metadata;
  if (next.status === 'waiting' && ['content', 'thinking', 'tool_call', 'progress'].includes(event.type)) {
    // The answer to its question set the turn going again.
    next.status = 'running';
    next.question = null;
  }

  switch (event.type) {
    case 'session':
      next.sessionId = text(meta.session_id) || event.session_id || next.sessionId;
      next.turnId = text(meta.turn_id) || event.turn_id || next.turnId;
      break;
    case 'content':
      if (isAnswerContent(event)) next.answer += event.content;
      break;
    case 'thinking':
    case 'observation':
      if (event.content) next.thoughts = appendThought(next.thoughts, text(meta.call_id) || event.stage || event.type, event.content);
      break;
    case 'tool_call': {
      const args = record(meta.args);
      next.tools = [
        ...next.tools,
        {
          id: text(meta.call_id) || `tool-${next.tools.length}`,
          name: text(meta.tool_name) || event.content || 'tool',
          args,
          offset: count(meta.assistant_content_offset) ?? next.answer.length,
          done: false,
          result: '',
        },
      ];
      next.activity = text(meta.tool_name) || event.content || next.activity;
      break;
    }
    case 'tool_result': {
      const id = text(meta.call_id);
      const index = next.tools.findIndex((tool) => tool.id === id && !tool.done);
      if (index >= 0) {
        next.tools = next.tools.map((tool, i) => (i === index ? { ...tool, done: true, result: event.content } : tool));
      } else {
        const name = text(meta.tool_name) || text(meta.tool) || 'tool';
        next.tools = [...next.tools, { id: id || `tool-${next.tools.length}`, name, args: {}, offset: next.answer.length, done: true, result: event.content }];
      }
      break;
    }
    case 'progress':
      if (text(meta.call_state) === 'running') next.activity = event.content || text(meta.label) || next.activity;
      break;
    case 'stage_start':
      next.activity = stageLabel(event.stage) || next.activity;
      break;
    case 'sources':
      next.sources = mergeSources(next.sources, meta.sources);
      break;
    case 'result': {
      next.result = meta;
      // Some capabilities send their answer only here.
      const response = text(meta.response);
      if (!next.answer.trim() && response) next.answer = response;
      break;
    }
    case 'error':
      next.error = event.content || text(meta.message) || 'DeepTutor reported an error.';
      if (meta.turn_terminal === true || text(meta.status) === 'failed') next.status = 'failed';
      break;
    case 'wait_for_input':
      next.status = 'waiting';
      next.question = { prompt: event.content, details: meta };
      break;
    case 'done': {
      const status = text(meta.status);
      next.status = status === 'failed' || status === 'cancelled' ? status : next.status === 'failed' ? 'failed' : 'completed';
      next.userMessageId = count(meta.user_message_id) ?? next.userMessageId;
      next.assistantMessageId = count(meta.assistant_message_id) ?? next.assistantMessageId;
      next.activity = null;
      next.question = null;
      break;
    }
    case 'stage_end':
    case 'session_meta':
      break;
  }
  return next;
}

export function replyFromEvents(events: DtStreamEvent[], start: DtReply = emptyReply()): DtReply {
  return events.reduce(applyTurnEvent, start);
}

/**
 * A saved reply: its text, with the tool calls its saved events record (where they happened
 * and what they returned). Reasoning isn't saved with the message.
 */
export function savedReply(message: DtMessage): DtReply {
  const events = (Array.isArray(message.events) ? message.events : []).flatMap((raw) => {
    const event = parseServerEvent(raw);
    return event && 'seq' in event ? [{ ...event, seq: 0 }] : [];
  });
  const reply = replyFromEvents(events, { ...emptyReply(), status: 'completed' });
  return { ...reply, answer: message.content ?? reply.answer, status: reply.status === 'running' ? 'completed' : reply.status, activity: null };
}

export type DtReplySegment = { kind: 'text'; text: string } | { kind: 'tools'; tools: DtToolStep[] };

/** The answer split where tools were called, for showing each call in its place. */
export function replySegments(reply: Pick<DtReply, 'answer' | 'tools'>): DtReplySegment[] {
  const segments: DtReplySegment[] = [];
  const tools = [...reply.tools].sort((a, b) => a.offset - b.offset);
  let position = 0;
  for (const tool of tools) {
    const offset = Math.min(Math.max(tool.offset, position), reply.answer.length);
    if (offset > position) segments.push({ kind: 'text', text: reply.answer.slice(position, offset) });
    position = offset;
    const last = segments[segments.length - 1];
    if (last?.kind === 'tools') last.tools.push(tool);
    else segments.push({ kind: 'tools', tools: [tool] });
  }
  if (position < reply.answer.length) segments.push({ kind: 'text', text: reply.answer.slice(position) });
  return segments.filter((segment) => segment.kind === 'tools' || segment.text.trim());
}

/** A short line for a tool step: what it looked for, when its arguments say. */
export function toolSummary(tool: DtToolStep): string {
  const query = text(tool.args.query) || text(tool.args.q) || text(tool.args.prompt) || text(tool.args.title) || text(tool.args.url);
  return query;
}
