import type { HistoryMessage } from './history';
import type { OutputContentPart, OutputItem } from './output';

/** Where in `output[]` a stream event lands. */
interface StreamAddress {
  item_id?: string;
  output_index?: number;
  content_index?: number;
  summary_index?: number;
}

/** What a stream event brings: a whole item or part, a piece of text or arguments, or the final response. */
interface StreamPayload {
  item?: OutputItem;
  part?: OutputContentPart;
  delta?: unknown;
  text?: unknown;
  arguments?: unknown;
  response?: { output?: OutputItem[] };
}

/** An OpenResponses-style event carried by the `response:completion` socket event. */
export type ResponseStreamEvent = { type?: string } & StreamAddress & StreamPayload;

/**
 * Applies one stream event to a response's `output[]` and returns a new array; the
 * input is never modified. Rules (from docs/protocol.md §6):
 * - `response.completed` swaps in the final output;
 * - `output_item.added` replaces an item with the same id, else inserts at `output_index`;
 *   `output_item.done` replaces at `output_index`;
 * - deltas extend `content[n].text`, `summary[n].text` or a tool call's `arguments`;
 * - `.done` events set the final value.
 */
export function applyResponseStreamEvent(output: OutputItem[], event: ResponseStreamEvent): OutputItem[] {
  const name = event.type ?? '';
  if (!name.startsWith('response.')) return output;
  if (name === 'response.completed') return Array.isArray(event.response?.output) ? event.response.output : output;

  const items = output.slice();
  const target = locate(items, event);

  if (name === 'response.output_item.added' || name === 'response.output_item.done') {
    if (!event.item) return output;
    const incoming = { ...event.item };
    const same = items.findIndex(
      (entry) => (incoming.id !== undefined && entry?.id === incoming.id) || (incoming.call_id !== undefined && entry?.call_id === incoming.call_id),
    );
    if (same >= 0) items[same] = incoming;
    else if (target >= items.length) items.push(incoming);
    else items.splice(target, name === 'response.output_item.added' ? 0 : 1, incoming);
    return items;
  }

  const edits =
    name === 'response.content_part.added' ||
    name === 'response.reasoning_summary_part.added' ||
    name.endsWith('.delta') ||
    name.endsWith('.done');
  if (!edits) return output;

  const placeholderType = name.includes('reasoning') ? 'reasoning' : name.includes('function_call') ? 'function_call' : 'message';
  const item = editableSlot(items, target, (position) =>
    position === target
      ? { ...(event.item_id ? { id: event.item_id } : {}), type: placeholderType, status: 'in_progress', role: 'assistant', content: [] }
      : { type: 'message', status: 'in_progress', role: 'assistant', content: [] },
  );
  const segment = name.split('.')[1] ?? '';

  if (name === 'response.content_part.added') {
    if (item.type !== 'reasoning' && event.part) {
      item.content = (item.content ?? []).slice();
      writePart(item.content, event.content_index ?? item.content.length, event.part, 'output_text');
    }
  } else if (name === 'response.reasoning_summary_part.added') {
    if (event.part) {
      item.summary = (item.summary ?? []).slice();
      writePart(item.summary, event.summary_index ?? item.summary.length, event.part, 'summary_text');
    }
  } else if (name.endsWith('.delta')) {
    if (segment === 'function_call_arguments') {
      item.arguments = extend(item.arguments ?? '', event.delta);
    } else if (segment === 'reasoning_summary_text') {
      item.summary = (item.summary ?? []).slice();
      const part = textSlot(item.summary, event.summary_index ?? 0, 'summary_text');
      part.text = extend(part.text ?? '', event.delta);
    } else {
      const field = segment === 'output_text' || segment === 'reasoning_text' ? 'text' : segment;
      item.content = (item.content ?? []).slice();
      const part = textSlot(item.content, event.content_index ?? 0, 'output_text');
      part[field] = extend(part[field], event.delta);
    }
  } else if (segment === 'content_part' && event.part) {
    item.content = (item.content ?? []).slice();
    writePart(item.content, event.content_index ?? Math.max(item.content.length - 1, 0), event.part, 'output_text');
  } else if (segment === 'function_call_arguments' && event.arguments !== undefined) {
    item.arguments = event.arguments;
  } else if ((segment === 'output_text' || segment === 'text' || segment === 'reasoning_text') && event.text !== undefined) {
    item.content = (item.content ?? []).slice();
    textSlot(item.content, event.content_index ?? 0, 'output_text').text = event.text;
  }
  return items;
}

/** The visible answer text of `output[]` (its `message` items). */
export function outputText(output: OutputItem[] | undefined): string {
  if (!Array.isArray(output)) return '';
  let text = '';
  for (const item of output) {
    if (item?.type !== 'message') continue;
    for (const part of item.content ?? []) if (typeof part?.text === 'string') text += part.text;
  }
  return text;
}

/**
 * Applies a socket event addressed to one message (`events` envelope with
 * `message_id`) and returns the updated message. Chat-level events (title,
 * tags, list, active) are the caller's; unknown types leave the message as is.
 */
export function applyMessageEvent(message: HistoryMessage, type: string, data: unknown): HistoryMessage {
  const payload = (data ?? {}) as Record<string, unknown>;
  switch (type) {
    case 'status':
      return { ...message, statusHistory: [...(message.statusHistory ?? []), data] };

    case 'response:completion': {
      const event = payload as ResponseStreamEvent;
      const output = applyResponseStreamEvent(message.output ?? [], event);
      let content = message.content ?? '';
      if (event.type === 'response.output_text.delta') {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (!(content === '' && delta === '\n')) content += delta;
      } else if (event.type === 'response.completed' || event.type?.endsWith('.done')) {
        content = outputText(output) || content;
      }
      return { ...message, output, content };
    }

    case 'chat:completion': {
      let next: HistoryMessage = { ...message };
      if (Array.isArray(payload.output)) {
        next.output = payload.output as OutputItem[];
        next.content = outputText(next.output);
      } else {
        const choices = payload.choices as { message?: { content?: string }; delta?: { content?: string } }[] | undefined;
        if (Array.isArray(choices)) {
          const full = choices[0]?.message?.content;
          const delta = choices[0]?.delta?.content ?? '';
          if (full) next.content = `${next.content ?? ''}${full}`;
          else if (!((next.content ?? '') === '' && delta === '\n')) next.content = `${next.content ?? ''}${delta}`;
        }
        if (typeof payload.content === 'string') next.content = payload.content;
      }
      if (payload.error) next.error = { content: errorContent(payload.error) };
      if (Array.isArray(payload.sources) && !next.sources) next.sources = payload.sources;
      if (typeof payload.selected_model_id === 'string') next = { ...next, selectedModelId: payload.selected_model_id, arena: true };
      if (payload.usage && typeof payload.usage === 'object') next.usage = payload.usage as Record<string, unknown>;
      if (payload.done === true) next.done = true;
      return next;
    }

    case 'chat:tasks:cancel':
      return { ...message, done: true };

    case 'chat:message:delta':
    case 'message':
      return { ...message, content: `${message.content ?? ''}${typeof payload.content === 'string' ? payload.content : ''}` };

    case 'chat:message':
    case 'replace':
      return { ...message, content: typeof payload.content === 'string' ? payload.content : message.content };

    case 'chat:message:files':
    case 'files':
      return { ...message, files: Array.isArray(payload.files) ? payload.files : message.files };

    case 'chat:message:embeds':
    case 'embeds':
      return { ...message, embeds: payload.embeds };

    case 'chat:message:error':
      return { ...message, error: payload.error };

    case 'chat:message:follow_ups':
      return { ...message, followUps: Array.isArray(payload.follow_ups) ? (payload.follow_ups as string[]) : message.followUps };

    case 'chat:message:favorite':
      return { ...message, favorite: payload.favorite };

    case 'source':
    case 'citation': {
      if (payload.type === 'code_execution') {
        const runs = [...((message.code_executions as Record<string, unknown>[] | undefined) ?? [])];
        const at = runs.findIndex((run) => run.id === payload.id);
        if (at >= 0) runs[at] = payload;
        else runs.push(payload);
        return { ...message, code_executions: runs };
      }
      return { ...message, sources: [...(message.sources ?? []), data] };
    }

    default:
      return message;
  }
}

/** Index of the item an event addresses: by id or tool-call id, else `output_index`, else the last item. */
function locate(items: OutputItem[], event: StreamAddress): number {
  if (event.item_id !== undefined) {
    const found = items.findIndex((item) => item?.id === event.item_id || item?.call_id === event.item_id);
    if (found >= 0) return found;
  }
  return event.output_index ?? Math.max(items.length - 1, 0);
}

/** Grows `list` until `index` exists (new slots come from `filler`), then swaps that slot for a copy that is safe to edit. */
function editableSlot<T extends object>(list: T[], index: number, filler: (position: number) => T): T {
  for (let position = list.length; position <= index; position += 1) list.push(filler(position));
  const editable = Object.assign({}, list[index]);
  list.splice(index, 1, editable);
  return editable;
}

function textSlot(parts: OutputContentPart[], index: number, kind: string): OutputContentPart {
  return editableSlot(parts, index, () => ({ type: kind, text: '' }));
}

function writePart(parts: OutputContentPart[], index: number, part: OutputContentPart, kind: string): void {
  textSlot(parts, index, kind);
  parts.splice(index, 1, { ...part });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Appends streamed text; streamed objects are merged; anything else replaces. */
function extend(previous: unknown, addition: unknown): unknown {
  if (isRecord(previous) && isRecord(addition)) return Object.assign({}, previous, addition);
  if (typeof previous === 'string' || typeof addition === 'string') return String(previous ?? '') + String(addition ?? '');
  return addition ?? previous ?? '';
}

function errorContent(error: unknown): string {
  if (typeof error === 'string') return error;
  if (isRecord(error)) {
    for (const key of ['message', 'detail', 'content']) {
      const candidate = error[key];
      if (typeof candidate === 'string' && candidate) return candidate;
    }
  }
  return 'Uh-oh! There was an issue with the response.';
}
