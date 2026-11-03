import { newestLeaf, type ChatHistory, type HistoryMessage } from './history';
import type { OwuiClient } from './http';
import { outputText } from './stream';

/**
 * One model's column in a turn sent to several models ("Compare"): its versions, oldest first
 * (regenerating adds one), and the version shown.
 */
export interface ReplyGroup {
  modelIdx: number;
  modelId: string;
  ids: string[];
  /** The version on the shown branch, else the newest. */
  shownId: string;
}

/**
 * The columns of the turn a reply belongs to, when its message went to several models; null
 * for a one-model turn. As on the web, replies are grouped by `modelIdx`, and replies saved
 * before it existed by model id.
 */
export function replyGroups(history: ChatHistory, replyId: string): ReplyGroup[] | null {
  const reply = history.messages[replyId];
  const parent = reply?.parentId ? history.messages[reply.parentId] : undefined;
  const models = parent?.models ?? [];
  if (!parent || models.length < 2) return null;
  const children = parent.childrenIds.map((id) => history.messages[id]).filter((message): message is HistoryMessage => Boolean(message));
  const groups: ReplyGroup[] = [];
  models.forEach((modelId, modelIdx) => {
    let members = children.filter((message) => message.modelIdx === modelIdx);
    if (members.length === 0) members = children.filter((message) => typeof message.modelIdx !== 'number' && message.model === modelId);
    const ids = members.map((message) => message.id);
    const newest = ids[ids.length - 1];
    if (newest) groups.push({ modelIdx, modelId, ids, shownId: ids.includes(replyId) ? replyId : newest });
  });
  return groups.some((group) => group.shownId === replyId) ? groups : null;
}

/** The leaf to show after moving a column one version back or forward, or null at either end. */
export function switchGroupVersion(history: ChatHistory, group: ReplyGroup, step: -1 | 1): string | null {
  const target = group.ids[group.ids.indexOf(group.shownId) + step];
  return target ? newestLeaf(history, target) : null;
}

/** "‹ 2/3 ›" within a column. */
export function groupPosition(group: ReplyGroup): { index: number; count: number } {
  return { index: Math.max(0, group.ids.indexOf(group.shownId)), count: group.ids.length };
}

/** Every column's shown version has finished. */
export function groupsDone(history: ChatHistory, groups: ReplyGroup[]): boolean {
  return groups.every((group) => history.messages[group.shownId]?.done !== false);
}

/** A combined answer kept on the shown reply (`merged`), as the web writes it. */
export interface MergedResponse {
  status: boolean;
  content: string;
  timestamp?: number;
}

export function mergedResponse(message: HistoryMessage | undefined): MergedResponse | null {
  const merged = message?.merged as Partial<MergedResponse> | undefined;
  return merged?.status ? { status: true, content: typeof merged.content === 'string' ? merged.content : '', timestamp: merged.timestamp } : null;
}

export interface MergeInput {
  /** The model that writes the combined answer: the shown reply's, as on the web. */
  model: string;
  /** The message the models answered. */
  prompt: string;
  /** Each column's shown answer. */
  responses: string[];
  /**
   * The chat. The web leaves it out, but the server passes it on to the model's connection, and
   * providers that route by session (sent as a header made from the chat id) refuse requests without it.
   */
  chatId?: string;
}

/** What "Merge Responses" sends for a turn, from the reply shown (`replyId`). */
export function mergeInput(history: ChatHistory, groups: ReplyGroup[], replyId: string, chatId?: string): MergeInput {
  const reply = history.messages[replyId];
  const parent = reply?.parentId ? history.messages[reply.parentId] : undefined;
  return {
    model: reply?.model ?? '',
    prompt: parent?.content ?? '',
    responses: groups.map((group) => {
      const message = history.messages[group.shownId];
      return outputText(message?.output) || message?.content || '';
    }),
    ...(chatId ? { chatId } : {}),
  };
}

/**
 * Reads an OpenAI-style completion as it arrives: server-sent `data:` lines carrying
 * `choices[0].delta.content`, or one JSON body with `choices[0].message.content`.
 */
export class CompletionTextReader {
  text = '';
  private buffer = '';
  private sawEvents = false;
  private raw = '';

  push(chunk: string): void {
    if (!this.sawEvents) this.raw += chunk;
    this.buffer += chunk;
    for (let at = this.buffer.indexOf('\n'); at >= 0; at = this.buffer.indexOf('\n')) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      this.line(line);
    }
  }

  /** Call once the answer has ended; throws the server's error when it sent one instead. */
  end(): string {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (rest) this.line(rest);
    if (!this.sawEvents) {
      const body = parse(this.raw.trim());
      failOn(body);
      const content = (body as { choices?: { message?: { content?: unknown } }[] } | undefined)?.choices?.[0]?.message?.content;
      if (typeof content === 'string') this.text = content;
    }
    return this.text;
  }

  private line(line: string): void {
    if (!line.startsWith('data:')) return;
    this.sawEvents = true;
    this.raw = '';
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const event = parse(data);
    failOn(event);
    const choice = (event as { choices?: { delta?: { content?: unknown }; message?: { content?: unknown } }[] } | undefined)?.choices?.[0];
    const piece = choice?.delta?.content ?? choice?.message?.content;
    // As on the web, a lone line break before any text is dropped.
    if (typeof piece === 'string' && !(this.text === '' && piece === '\n')) this.text += piece;
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function failOn(value: unknown): void {
  const error = (value as { error?: unknown } | undefined)?.error;
  if (!error) return;
  const message = typeof error === 'string' ? error : (error as { message?: unknown; detail?: unknown }).message ?? (error as { detail?: unknown }).detail;
  throw new Error(typeof message === 'string' && message ? message : 'The model could not merge the answers');
}

/**
 * "Merge Responses": the server has `input.model` combine the answers into one
 * (`POST /api/v1/tasks/moa/completions`). `onText` gets the text so far as it streams in, when
 * the fetch in use can stream; the whole text is returned either way.
 */
export async function mergeResponses(client: OwuiClient, input: MergeInput, onText?: (text: string) => void): Promise<string> {
  const { chatId, ...request } = input;
  const response = await client.stream('/api/v1/tasks/moa/completions', { ...request, stream: true, ...(chatId ? { chat_id: chatId } : {}) }, { timeoutMs: 120_000 });
  const reader = new CompletionTextReader();
  const body = response.body as ReadableStream<Uint8Array> | null;
  if (body && typeof body.getReader === 'function' && typeof TextDecoder !== 'undefined') {
    const stream = body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await stream.read();
      if (done) break;
      const before = reader.text;
      reader.push(decoder.decode(value, { stream: true }));
      if (reader.text !== before) onText?.(reader.text);
    }
    reader.push(decoder.decode());
  } else {
    reader.push(await response.text());
  }
  const text = reader.end();
  onText?.(text);
  return text;
}
