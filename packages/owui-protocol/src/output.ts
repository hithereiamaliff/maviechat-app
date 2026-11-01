import type { HistoryMessage } from './history';

/** A part of an output item: `output_text`, `reasoning_text`, `summary_text`, `text`, … */
export interface OutputContentPart {
  type?: string;
  text?: unknown;
  [key: string]: unknown;
}

/**
 * An item of an assistant message's `output[]` (OpenResponses-style). Types seen on
 * Open WebUI 0.11.3: message, reasoning, function_call, function_call_output,
 * web_search_call, file_search_call, computer_call, open_webui:code_interpreter.
 */
export interface OutputItem {
  type?: string;
  id?: string;
  call_id?: string;
  name?: string;
  status?: string;
  arguments?: unknown;
  content?: OutputContentPart[];
  summary?: OutputContentPart[] | null;
  output?: OutputContentPart[] | unknown;
  code?: string;
  lang?: string;
  duration?: number | string | null;
  queries?: unknown[];
  [key: string]: unknown;
}

export type DisplayBlock =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'reasoning'; id: string; text: string; durationSec: number | null; done: boolean }
  | { kind: 'tool'; id: string; name: string; argumentsText: string; resultText: string | null; done: boolean }
  | { kind: 'code'; id: string; lang: string; code: string; resultText: string | null; done: boolean }
  | { kind: 'search'; id: string; label: string; queries: string[]; done: boolean }
  | { kind: 'other'; id: string; label: string; done: boolean };

export type StepBlock = Exclude<DisplayBlock, { kind: 'text' }>;

/** What a response shows, in order: text, single steps, or runs of two or more consecutive steps. */
export type DisplayItem = Extract<DisplayBlock, { kind: 'text' }> | StepBlock | { kind: 'group'; id: string; steps: StepBlock[] };

/** Builds display blocks from `output[]` when the message has it, otherwise from `content` (older chats). */
export function messageBlocks(message: Pick<HistoryMessage, 'id' | 'content' | 'output' | 'done'>): DisplayBlock[] {
  if (Array.isArray(message.output) && message.output.length > 0) {
    return outputToBlocks(message.output, message.done !== false);
  }
  return contentToBlocks(message.content ?? '', message.id);
}

export function outputToBlocks(output: OutputItem[], messageDone = true): DisplayBlock[] {
  const results = new Map<string, string>();
  for (const item of output) {
    if (item.type === 'function_call_output' && item.call_id) results.set(item.call_id, partsText(item.output));
  }

  const blocks: DisplayBlock[] = [];
  output.forEach((item, index) => {
    const id = item.id ?? `${item.type ?? 'item'}-${index}`;
    const done = item.status ? item.status === 'completed' || item.status === 'incomplete' : messageDone;
    switch (item.type) {
      case 'message': {
        const text = partsText(item.content);
        if (text) blocks.push({ kind: 'text', id, text });
        break;
      }
      case 'reasoning': {
        const text = partsText(item.content) || partsText(item.summary);
        blocks.push({ kind: 'reasoning', id, text, durationSec: seconds(item.duration), done });
        break;
      }
      case 'function_call': {
        const result = item.call_id ? results.get(item.call_id) : undefined;
        blocks.push({
          kind: 'tool',
          id,
          name: item.name ?? 'tool',
          argumentsText: prettyJson(item.arguments),
          resultText: result ?? null,
          done: result !== undefined || done,
        });
        break;
      }
      case 'function_call_output':
        break; // shown with its function_call
      case 'open_webui:code_interpreter':
        blocks.push({
          kind: 'code',
          id,
          lang: item.lang ?? 'python',
          code: item.code ?? '',
          resultText: partsText(item.output) || null,
          done,
        });
        break;
      case 'web_search_call':
      case 'file_search_call':
        blocks.push({
          kind: 'search',
          id,
          label: item.type === 'web_search_call' ? 'Web search' : 'File search',
          queries: (item.queries ?? []).map(String),
          done,
        });
        break;
      default:
        blocks.push({ kind: 'other', id, label: item.type ?? 'step', done });
    }
  });
  return blocks;
}

/** Older chats keep steps inline as `<details type="reasoning|tool_calls|code_interpreter" …>` blocks in `content`. */
export function contentToBlocks(content: string, idPrefix = 'content'): DisplayBlock[] {
  const blocks: DisplayBlock[] = [];
  const pattern = /<details\b([^>]*)>([\s\S]*?)<\/details>/g;
  let cursor = 0;
  let index = 0;
  const pushText = (text: string) => {
    if (text.trim()) blocks.push({ kind: 'text', id: `${idPrefix}-${index++}`, text: text.trim() });
  };

  for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
    pushText(content.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const attrs = parseAttributes(match[1] ?? '');
    const body = (match[2] ?? '').replace(/<summary>[\s\S]*?<\/summary>/, '');
    const nextId = () => attrs.id ?? `${idPrefix}-${index++}`;
    const done = attrs.done !== 'false';
    switch (attrs.type) {
      case 'reasoning':
        blocks.push({ kind: 'reasoning', id: nextId(), text: unquote(body), durationSec: seconds(attrs.duration), done });
        break;
      case 'tool_calls':
        blocks.push({
          kind: 'tool',
          id: nextId(),
          name: attrs.name ?? 'tool',
          argumentsText: prettyJson(attrs.arguments ?? ''),
          resultText: attrs.result !== undefined ? prettyJson(attrs.result) : null,
          done,
        });
        break;
      case 'code_interpreter':
        blocks.push({
          kind: 'code',
          id: nextId(),
          lang: attrs.lang ?? 'python',
          code: unquote(body),
          resultText: attrs.output ?? null,
          done,
        });
        break;
      default:
        pushText(match[0]);
    }
  }
  pushText(content.slice(cursor));
  return blocks;
}

/** Wraps runs of two or more consecutive steps into one group, as the web app does. */
export function groupSteps(blocks: DisplayBlock[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let run: StepBlock[] = [];
  const flush = () => {
    if (run.length === 1) items.push(run[0] as StepBlock);
    else if (run.length > 1) items.push({ kind: 'group', id: `group-${run[0]?.id}`, steps: run });
    run = [];
  };
  for (const block of blocks) {
    if (block.kind === 'text') {
      flush();
      items.push(block);
    } else {
      run.push(block);
    }
  }
  flush();
  return items;
}

/** All visible text of a response, for copying. */
export function plainText(blocks: DisplayBlock[]): string {
  return blocks
    .filter((block): block is Extract<DisplayBlock, { kind: 'text' }> => block.kind === 'text')
    .map((block) => block.text)
    .join('\n\n');
}

function partsText(parts: unknown): string {
  if (typeof parts === 'string') return parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) {
        const text = (part as OutputContentPart).text;
        return typeof text === 'string' ? text : '';
      }
      return '';
    })
    .join('');
}

function seconds(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function prettyJson(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? decodeEntities(value) : JSON.stringify(value);
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([a-zA-Z_:-]+)="([^"]*)"/g)) {
    attrs[match[1] as string] = decodeEntities(match[2] ?? '');
  }
  return attrs;
}

/** Older reasoning bodies are quoted line by line ("> …"). */
function unquote(body: string): string {
  return body
    .split('\n')
    .map((line) => line.replace(/^>\s?/, ''))
    .join('\n')
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
