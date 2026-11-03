import type { ModelItem } from './models';

/*
 * A chat's own system prompt and model parameters: the Controls panel's "System Prompt" and
 * "Advanced Params" (Open WebUI 0.11.3). They live in the chat's `params` and travel with each
 * request; a parameter left out uses the user's default, then the model's.
 */

/** How a parameter is edited once it is set (Custom). */
export type ParamKind = 'number' | 'integer' | 'text' | 'switch' | 'choice';

export interface ParamChoice {
  value: unknown;
  label: string;
  /** This choice carries text you type (a thinking level) or two tags (reasoning tags). */
  edit?: 'text' | 'pair';
}

export interface ParamSpec {
  key: string;
  label: string;
  /** What it does, in our words. */
  help: string;
  kind: ParamKind;
  /** The value it starts at when switched from Default to Custom (Open WebUI's starting values). */
  initial: unknown;
  min?: number;
  max?: number;
  step?: number;
  choices?: ParamChoice[];
  /** As on the web, only admins see it. */
  adminOnly?: boolean;
  /** Only Ollama models use it. */
  ollama?: boolean;
}

/** The parameters, in the web's order. */
export const PARAM_SPECS: readonly ParamSpec[] = [
  {
    key: 'stream_response',
    label: 'Stream Chat Response',
    help: 'Show the reply as it is written, or all at once when it is done.',
    kind: 'choice',
    initial: true,
    choices: [
      { value: true, label: 'On' },
      { value: false, label: 'Off' },
    ],
  },
  { key: 'stream_delta_chunk_size', label: 'Stream Chunk Size', help: 'How many pieces of text arrive together while streaming.', kind: 'integer', initial: 1, min: 1, max: 128, step: 1, adminOnly: true },
  { key: 'compact_token_threshold', label: 'Compaction Threshold', help: 'Tokens of context after which older messages are summarised (up to the server-wide limit).', kind: 'integer', initial: 80000, min: 1, step: 1000, adminOnly: true },
  {
    key: 'function_calling',
    label: 'Function Calling',
    help: "Native uses the model's own tool calling; Legacy describes the tools in the prompt.",
    kind: 'choice',
    initial: 'native',
    choices: [
      { value: 'native', label: 'Native' },
      { value: 'legacy', label: 'Legacy' },
    ],
  },
  {
    key: 'reasoning_tags',
    label: 'Reasoning Tags',
    help: "Whether the reply's thinking between tags is shown apart, and which tags mark it.",
    kind: 'choice',
    initial: true,
    choices: [
      { value: true, label: 'Enabled' },
      { value: false, label: 'Disabled' },
      { value: ['', ''], label: 'Custom', edit: 'pair' },
    ],
  },
  { key: 'seed', label: 'Seed', help: 'The same seed and prompt give the same reply, on models that support it.', kind: 'integer', initial: 0, min: 0, step: 1 },
  { key: 'stop', label: 'Stop Sequence', help: 'The reply stops at any of these; separate several with commas.', kind: 'text', initial: '' },
  { key: 'temperature', label: 'Temperature', help: 'Higher is more varied and creative, lower more focused.', kind: 'number', initial: 0.8, min: 0, max: 2, step: 0.05 },
  { key: 'reasoning_effort', label: 'Reasoning Effort', help: 'How hard a reasoning model thinks, e.g. low, medium or high.', kind: 'text', initial: 'medium' },
  { key: 'logit_bias', label: 'Logit Bias', help: 'Makes tokens likelier or rarer, as token:bias pairs separated by commas.', kind: 'text', initial: '' },
  { key: 'max_tokens', label: 'Max Tokens', help: 'The most tokens the reply may use.', kind: 'integer', initial: 128, min: -2, max: 131072, step: 1 },
  { key: 'top_k', label: 'Top K', help: 'Picks only from this many likeliest tokens; lower is more conservative.', kind: 'integer', initial: 40, min: 0, max: 1000, step: 1 },
  { key: 'top_p', label: 'Top P', help: 'Picks from the likeliest tokens up to this share of probability.', kind: 'number', initial: 0.9, min: 0, max: 1, step: 0.05 },
  { key: 'min_p', label: 'Min P', help: "Leaves out tokens much less likely than the likeliest one.", kind: 'number', initial: 0, min: 0, max: 1, step: 0.05 },
  { key: 'frequency_penalty', label: 'Frequency Penalty', help: 'Discourages repeating the same words, more for each repeat.', kind: 'number', initial: 1.1, min: -2, max: 2, step: 0.05 },
  { key: 'presence_penalty', label: 'Presence Penalty', help: 'Encourages new topics by discouraging words already used.', kind: 'number', initial: 0, min: -2, max: 2, step: 0.05 },
  { key: 'mirostat', label: 'Mirostat', help: 'Keeps perplexity steady: 0 off, 1 Mirostat, 2 Mirostat 2.0.', kind: 'integer', initial: 0, min: 0, max: 2, step: 1 },
  { key: 'mirostat_eta', label: 'Mirostat Eta', help: "How quickly Mirostat reacts to the reply so far.", kind: 'number', initial: 0.1, min: 0, max: 1, step: 0.05 },
  { key: 'mirostat_tau', label: 'Mirostat Tau', help: 'Balance between coherence and variety under Mirostat.', kind: 'number', initial: 5, min: 0, max: 10, step: 0.5 },
  { key: 'repeat_last_n', label: 'Repeat Last N', help: 'How far back to look for repetition (-1 for the whole context).', kind: 'integer', initial: 64, min: -1, max: 128, step: 1 },
  { key: 'tfs_z', label: 'Tail Free Sampling', help: 'Trims unlikely tokens; 1 turns it off.', kind: 'number', initial: 1, min: 0, max: 2, step: 0.05 },
  { key: 'repeat_penalty', label: 'Repeat Penalty', help: 'How strongly repetition is discouraged.', kind: 'number', initial: 1.1, min: -2, max: 2, step: 0.05 },
  { key: 'use_mmap', label: 'Memory-map the Model', help: 'Loads the model by mapping it into memory (use_mmap).', kind: 'switch', initial: true, adminOnly: true, ollama: true },
  { key: 'use_mlock', label: 'Lock the Model in Memory', help: 'Keeps the model in RAM so it is never swapped out (use_mlock).', kind: 'switch', initial: true, adminOnly: true, ollama: true },
  {
    key: 'think',
    label: 'Think',
    help: 'Lets the model reason before it answers; some models take a level.',
    kind: 'choice',
    initial: true,
    ollama: true,
    choices: [
      { value: true, label: 'On' },
      { value: 'medium', label: 'Level', edit: 'text' },
      { value: false, label: 'Off' },
    ],
  },
  { key: 'format', label: 'Format', help: 'The reply\'s format: "json", or a JSON schema.', kind: 'text', initial: 'json', ollama: true },
  { key: 'num_keep', label: 'Tokens to Keep', help: 'Tokens kept from the start when the context is refreshed (num_keep).', kind: 'integer', initial: 24, min: -1, max: 10240000, step: 1, ollama: true },
  { key: 'num_ctx', label: 'Context Length', help: 'How many tokens of context the model reads (num_ctx).', kind: 'integer', initial: 2048, min: -1, max: 10240000, step: 1, ollama: true },
  { key: 'num_batch', label: 'Batch Size', help: 'Tokens processed at once (num_batch).', kind: 'integer', initial: 512, min: 256, max: 8192, step: 256, ollama: true },
  { key: 'num_thread', label: 'CPU Threads', help: 'Threads used for the reply (num_thread).', kind: 'integer', initial: 2, min: 1, max: 256, step: 1, adminOnly: true, ollama: true },
  { key: 'num_gpu', label: 'GPU Layers', help: 'Layers sent to the GPU (num_gpu).', kind: 'integer', initial: 0, min: 0, max: 256, step: 1, adminOnly: true, ollama: true },
  { key: 'keep_alive', label: 'Keep Alive', help: 'How long the model stays loaded after the reply, e.g. 5m or 1h.', kind: 'text', initial: '5m', ollama: true },
];

/** The parameters this user sees in Controls (admins see all, as on the web). */
export const paramsFor = (admin: boolean) => PARAM_SPECS.filter((spec) => admin || !spec.adminOnly);

/** Set to something (Custom); null and missing mean Default, as the web stores them. */
export const isCustom = (params: Record<string, unknown>, key: string) => params[key] !== null && params[key] !== undefined;

/** Which of a choice parameter's options the value is. */
export function choiceIndex(spec: ParamSpec, value: unknown): number {
  return (spec.choices ?? []).findIndex((choice) =>
    choice.edit === 'text' ? typeof value === 'string' : choice.edit === 'pair' ? Array.isArray(value) : choice.value === value,
  );
}

/** A number typed in, kept within the parameter's range; null if it isn't one. */
export function parseParamNumber(spec: ParamSpec, text: string): number | null {
  const value = spec.kind === 'integer' ? Number.parseInt(text, 10) : Number.parseFloat(text);
  if (!Number.isFinite(value) || (spec.kind === 'integer' && !/^-?\d+$/.test(text.trim()))) return null;
  return Math.min(spec.max ?? Number.POSITIVE_INFINITY, Math.max(spec.min ?? Number.NEGATIVE_INFINITY, value));
}

/** One step up or down, kept within the range (and free of floating-point dust). */
export function stepParam(spec: ParamSpec, value: number, direction: 1 | -1): number {
  const step = spec.step ?? 1;
  const next = Math.round((value + direction * step) / step) * step;
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Math.min(spec.max ?? Number.POSITIVE_INFINITY, Math.max(spec.min ?? Number.NEGATIVE_INFINITY, Number(next.toFixed(decimals))));
}

/** The chat's params with one changed: `undefined` returns it to Default (the key goes). */
export function withParam(params: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const next = { ...params };
  if (value === undefined || value === null) delete next[key];
  else next[key] = value;
  return next;
}

/** The chat's own system prompt; an empty one leaves the user's default in charge. */
export function withSystemPrompt(params: Record<string, unknown>, system: string): Record<string, unknown> {
  return withParam(params, 'system', system.trim() ? system : undefined);
}

/** Stop sequences as sent: a comma-separated string (as the web stores it) or a list; escapes such as `\n` are read. */
export function stopTokens(stop: unknown): string[] | undefined {
  if (stop === null || stop === undefined || stop === '') return undefined;
  const parts = Array.isArray(stop) ? stop.map(String) : String(stop).split(',').map((part) => part.trim());
  const tokens = parts.filter((part) => part.length > 0).map(readEscapes);
  return tokens.length > 0 ? tokens : undefined;
}

function readEscapes(token: string): string {
  try {
    const unescaped = JSON.parse(`"${token.replace(/"/g, '\\"')}"`) as string;
    return decodeURIComponent(unescaped);
  } catch {
    return token;
  }
}

/**
 * The request's `params`: the user's defaults, then the chat's own (the chat wins); a value set
 * back to Default on the web (null) means unset. Stop sequences go as a list.
 */
export function requestParams(userParams: Record<string, unknown> | null | undefined, chatParams: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(userParams ?? {}), ...(chatParams ?? {}) };
  for (const key of Object.keys(merged)) if (merged[key] === null || merged[key] === undefined) delete merged[key];
  const stop = stopTokens(merged.stop);
  if (stop) merged.stop = stop;
  else delete merged.stop;
  return merged;
}

/** Whether the reply streams: the model's setting first, then the user's, then the chat's (the web's order). */
export function streamResponse(model: ModelItem | undefined, userParams: Record<string, unknown> | null | undefined, chatParams: Record<string, unknown> | null | undefined): boolean {
  const modelParams = (model?.info as { params?: Record<string, unknown> } | undefined)?.params;
  const pick = (params: Record<string, unknown> | null | undefined) => (typeof params?.stream_response === 'boolean' ? params.stream_response : undefined);
  return pick(modelParams) ?? pick(userParams) ?? pick(chatParams) ?? true;
}
