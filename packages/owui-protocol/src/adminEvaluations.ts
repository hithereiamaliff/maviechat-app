import type { OwuiClient } from './http';

/*
 * Admin → Evaluations (Open WebUI 0.11.3): the ratings people give replies. The leaderboard's
 * Elo ratings are worked out by the server on each read (only thumbs given while comparing models
 * count); feedback is listed 30 a page, with who gave it. An export holds full copies of chats.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const ms = (value: unknown): number => (typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : 0);
const base = '/api/v1/evaluations';

export interface LeaderboardEntry {
  modelId: string;
  rating: number;
  won: number;
  lost: number;
  count: number;
  tags: { tag: string; count: number }[];
}

/** Models by rating (highest first). No tag search here: it makes the server load an embedding model. */
export async function getLeaderboard(client: OwuiClient): Promise<LeaderboardEntry[]> {
  return list(record(await client.get<unknown>(`${base}/leaderboard`)).entries).flatMap((raw) => {
    const row = record(raw);
    const modelId = text(row.model_id);
    if (!modelId) return [];
    const tags = list(row.top_tags).flatMap((item) => {
      const tag = record(item);
      return text(tag.tag) ? [{ tag: text(tag.tag), count: num(tag.count) }] : [];
    });
    return [{ modelId, rating: num(row.rating), won: num(row.won), lost: num(row.lost), count: num(row.count), tags }];
  });
}

/** A model's wins and losses by day (0 days: all time). Ids with a slash can't be asked for (the route doesn't match them). */
export async function getModelHistory(client: OwuiClient, modelId: string, days: number): Promise<{ date: string; won: number; lost: number }[]> {
  if (modelId.includes('/')) return [];
  return list(record(await client.get<unknown>(`${base}/leaderboard/${encodeURIComponent(modelId)}/history`, { query: { days } })).history).flatMap((raw) => {
    const row = record(raw);
    return text(row.date) ? [{ date: text(row.date), won: num(row.won), lost: num(row.lost) }] : [];
  });
}

/** Won, lost or even: a thumbs up, down, or neither. */
export type FeedbackResult = 'won' | 'lost' | 'draw';

export interface Feedback {
  id: string;
  userName: string;
  modelId: string;
  /** The models it was compared with, if any. */
  siblings: string[];
  result: FeedbackResult;
  /** 1 to 10, when given. */
  score: number | null;
  reason: string;
  comment: string;
  tags: string[];
  chatId: string;
  messageId: string;
  updatedAt: number;
}

function feedbackOf(raw: unknown): Feedback | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const data = record(row.data);
  const meta = record(row.meta);
  const user = record(row.user);
  const rating = num(data.rating);
  const score = record(data.details).rating;
  return {
    id,
    userName: text(user.name) || text(user.email) || text(row.user_id),
    modelId: text(data.model_id) || text(meta.model_id),
    siblings: list(data.sibling_model_ids).map(text).filter(Boolean),
    result: rating > 0 ? 'won' : rating < 0 ? 'lost' : 'draw',
    score: typeof score === 'number' ? score : null,
    reason: text(data.reason),
    comment: text(data.comment),
    tags: list(data.tags).map(text).filter(Boolean),
    chatId: text(meta.chat_id),
    messageId: text(meta.message_id),
    updatedAt: ms(row.updated_at),
  };
}

/** Models that have feedback. */
export async function feedbackModels(client: OwuiClient): Promise<string[]> {
  return list(await client.get<unknown>(`${base}/feedbacks/models`)).map(text).filter(Boolean);
}

/** One page (30) of everyone's feedback, newest first (or by model, rating, who gave it). */
export async function listFeedback(client: OwuiClient, query: { page?: number; modelId?: string; orderBy?: 'updated_at' | 'model_id' | 'rating' | 'username'; direction?: 'asc' | 'desc' } = {}): Promise<{ items: Feedback[]; total: number }> {
  const params: Record<string, string | number> = { page: query.page ?? 1, order_by: query.orderBy ?? 'updated_at', direction: query.direction ?? 'desc' };
  if (query.modelId) params.model_id = query.modelId;
  const body = record(await client.get<unknown>(`${base}/feedbacks/list`, { query: params }));
  return { items: list(body.items).flatMap((row) => feedbackOf(row) ?? []), total: num(body.total) };
}

/** One feedback, with the prompt and the reply it rated (from the copy of the chat kept with it), when there. */
export async function getFeedback(client: OwuiClient, id: string): Promise<Feedback & { prompt: string; reply: string }> {
  const raw = await client.get<unknown>(`${base}/feedback/${encodeURIComponent(id)}`);
  const feedback = feedbackOf(raw);
  if (!feedback) throw new Error('Open WebUI did not describe the feedback');
  const messages = record(record(record(record(raw).snapshot).chat).history).messages;
  const all = record(messages);
  const reply = record(all[feedback.messageId]);
  const parent = record(all[text(reply.parentId)]);
  return { ...feedback, prompt: text(parent.content), reply: text(reply.content) };
}

/** Deletes one feedback for good (it leaves the leaderboard). */
export async function deleteFeedback(client: OwuiClient, id: string): Promise<void> {
  await client.delete<unknown>(`${base}/feedback/${encodeURIComponent(id)}`);
}

/** Every feedback with a full copy of its chat: large, and private to those chats' people. */
export async function exportFeedback(client: OwuiClient): Promise<unknown[]> {
  return list(await client.get<unknown>(`${base}/feedbacks/all/export`, { timeoutMs: 120_000 }));
}

/** Whether models are compared side by side in arena chats. */
export async function getArenaEnabled(client: OwuiClient): Promise<boolean> {
  return record(await client.get<unknown>(`${base}/config`)).ENABLE_EVALUATION_ARENA_MODELS !== false;
}

/** Arena on or off; the arena's models stay as they are (left out, the server keeps them). */
export async function setArenaEnabled(client: OwuiClient, on: boolean): Promise<void> {
  await client.post<unknown>(`${base}/config`, { ENABLE_EVALUATION_ARENA_MODELS: on });
}

/** Feedback as CSV rows (made on the phone), without the chats. */
export function feedbackCsv(items: Feedback[]): string {
  const cell = (value: string | number | null) => {
    const textValue = value === null ? '' : String(value);
    return /[",\n]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue;
  };
  const header = ['id', 'user', 'model', 'compared with', 'result', 'score', 'reason', 'comment', 'tags', 'updated'];
  return [header.join(','), ...items.map((item) => [item.id, item.userName, item.modelId, item.siblings.join(' '), item.result, item.score, item.reason, item.comment, item.tags.join(' '), item.updatedAt ? new Date(item.updatedAt).toISOString() : ''].map(cell).join(','))].join('\n');
}
