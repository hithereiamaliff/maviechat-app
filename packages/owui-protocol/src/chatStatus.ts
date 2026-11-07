import { branchPath, type ChatHistory, type HistoryMessage } from './history';

/*
 * `/status`: how much of the model's context a chat uses, as the web works it out. The server
 * reports it (`context_usage`, with the compaction threshold) only while context compaction is
 * on; otherwise it's estimated from the last reply's token count and the text after it.
 */

export interface ContextUsage {
  tokens: number;
  /** The compaction threshold, when the server gave one. */
  threshold: number | null;
  /** True when worked out on the phone rather than reported by the server. */
  estimated: boolean;
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** Tokens a reply's usage reports: what went in and what came out, in the names providers use. */
export function usageTokenCount(usage: unknown): number {
  if (!usage || typeof usage !== 'object') return 0;
  const u = usage as Record<string, unknown>;
  let input = count(u.prompt_tokens) || count(u.prompt_eval_count);
  if (!input && (u.prompt_n != null || u.cache_n != null)) input = count(u.prompt_n) + count(u.cache_n);
  if (!input) input = count(u.input_tokens);
  const output = count(u.completion_tokens) || count(u.output_tokens) || count(u.eval_count) || count(u.predicted_n);
  return input + output;
}

/** About four characters a token, as the web reckons; anything not text counted as its JSON. */
function roughTokens(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value) ?? '';
    } catch {
      text = String(value);
    }
  }
  return Math.max(1, Math.floor(text.length / 4));
}

const messagesTokens = (messages: HistoryMessage[]): number =>
  messages.reduce((total, message) => {
    const extra = message as Record<string, unknown>;
    return total + 4 + roughTokens(message.content) + roughTokens(message.output) + roughTokens(extra.tool_calls) + roughTokens(message.files);
  }, 0);

/** The chat's context use: the server's figure when it sent one, else the web's estimate for the shown branch. */
export function contextUsage(history: ChatHistory | null | undefined, systemPrompt: string, reported?: unknown): ContextUsage | null {
  if (reported && typeof reported === 'object') {
    const r = reported as Record<string, unknown>;
    const tokens = count(r.estimated_tokens) || count(r.tokens);
    if (tokens) return { tokens, threshold: count(r.threshold) || null, estimated: false };
  }
  if (!history?.currentId) return null;
  const messages = branchPath(history, history.currentId);
  if (!messages.length) return null;
  // A compacted chat counts from its summary on.
  let start = 0;
  let summary = '';
  messages.forEach((message, index) => {
    const extra = message as Record<string, unknown>;
    const value = extra.contextSummary ?? extra.context_summary;
    if (typeof value === 'string' && value.trim()) {
      summary = value;
      start = index;
    }
  });
  const active = messages.slice(start);
  for (let index = active.length - 1; index >= 0; index -= 1) {
    const message = active[index] as Record<string, unknown>;
    const used = usageTokenCount(message.usage ?? (message.info as Record<string, unknown> | undefined)?.usage);
    if (used) return { tokens: used + messagesTokens(active.slice(index + 1)), threshold: null, estimated: true };
  }
  return { tokens: roughTokens(systemPrompt) + roughTokens(summary) + messagesTokens(active), threshold: null, estimated: true };
}

/** A token count as people read it: 840, 1.2k, 41k, 1.5m. */
export function formatTokenCount(tokens: number): string {
  const short = (value: number) => (value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, ''));
  if (tokens >= 1_000_000) return `${short(tokens / 1_000_000)}m`;
  if (tokens >= 1_000) return `${short(tokens / 1_000)}k`;
  return String(tokens);
}

/** "≈ 1.2k tokens", or "34% · 41k of 120k" with the compaction threshold. */
export function contextUsageLabel(usage: ContextUsage | null): string {
  if (!usage) return 'unknown';
  const tokens = formatTokenCount(usage.tokens);
  if (usage.threshold) return `${Math.round((usage.tokens / usage.threshold) * 100)}% · ${tokens} of ${formatTokenCount(usage.threshold)} tokens`;
  return `${usage.estimated ? '≈ ' : ''}${tokens} tokens`;
}
