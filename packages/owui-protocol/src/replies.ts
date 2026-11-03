import type { ChatRecord } from './chats';
import type { ChatHistory, HistoryMessage } from './history';
import { branchPath } from './history';
import type { OwuiClient } from './http';
import type { ModelItem } from './models';
import type { OutputItem } from './output';
import { outputText } from './stream';

/*
 * What you can do to a reply besides regenerating it (Open WebUI 0.11.3): edit it in place or
 * as a new version, rate it, and run the model's action buttons on it.
 */

const textOf = (parts: unknown): string =>
  Array.isArray(parts)
    ? parts.map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).join('')
    : typeof parts === 'string'
      ? parts
      : '';

/**
 * The reply's text, ready to edit. A reply with structured output (text between tool steps)
 * edits each text block on its own, as the web's block editor does; older replies edit `content`.
 */
export function editableTexts(message: Pick<HistoryMessage, 'content' | 'output'>): { texts: string[]; structured: boolean } {
  const output = Array.isArray(message.output) ? message.output : [];
  if (output.length === 0) return { texts: [message.content ?? ''], structured: false };
  return { texts: output.filter((item) => item.type === 'message').map((item) => textOf(item.content)), structured: true };
}

/** The reply with its text edited, as the web saves it: `originalContent` kept for text, the steps of structured output kept in place. */
export function withEditedTexts(message: HistoryMessage, texts: string[]): HistoryMessage {
  const output = Array.isArray(message.output) ? message.output : [];
  if (output.length === 0) return { ...message, originalContent: message.content, content: texts[0] ?? '' };
  let next = 0;
  const edited: OutputItem[] = output.map((item) => {
    if (item.type !== 'message') return item;
    const text = texts[next++] ?? textOf(item.content);
    return { ...item, content: [{ type: 'output_text', text }] };
  });
  return { ...message, output: edited, content: '' };
}

/**
 * "Save As Copy": the edited reply as a new version beside the original (the original stays,
 * and the arrows switch between them). Ratings stay with the original.
 */
export function replyCopy(
  history: ChatHistory,
  messageId: string,
  texts: string[],
  { newId, now = new Date() }: { newId: string; now?: Date },
): { copy: HistoryMessage; parent: HistoryMessage | null } {
  const original = history.messages[messageId];
  if (!original) throw new Error('The reply is missing');
  const edited = withEditedTexts(original, texts);
  const { annotation: _annotation, feedbackId: _feedbackId, originalContent: _originalContent, ...rest } = edited;
  const copy: HistoryMessage = { ...rest, id: newId, childrenIds: [], files: undefined, timestamp: Math.floor(now.getTime() / 1000) };
  const parentMessage = original.parentId ? history.messages[original.parentId] : undefined;
  const parent = parentMessage ? { ...parentMessage, childrenIds: [...parentMessage.childrenIds, newId] } : null;
  return { copy, parent };
}

/** A rating on a reply (`message.annotation`): up or down, then a score out of 10, a reason and a comment. */
export interface ReplyAnnotation {
  rating?: 1 | -1;
  reason?: string;
  comment?: string;
  tags?: string[];
  details?: { rating?: number | null };
  [key: string]: unknown;
}

/** The web's reason keys (stored as written); the app shows its own words for them. */
export const LIKE_REASONS = [
  'accurate_information',
  'followed_instructions_perfectly',
  'showcased_creativity',
  'positive_attitude',
  'attention_to_detail',
  'thorough_explanation',
  'other',
] as const;
export const DISLIKE_REASONS = [
  'dont_like_the_style',
  'too_verbose',
  'not_helpful',
  'not_factually_correct',
  'didnt_fully_follow_instructions',
  'refused_when_it_shouldnt_have',
  'being_lazy',
  'other',
] as const;

/** A score out of 10 that fits the thumb: 6–10 after 👍, 1–5 after 👎, as on the web. */
export function scoreAllowed(rating: 1 | -1 | undefined, score: number): boolean {
  return rating === -1 ? score <= 5 : rating === 1 ? score >= 6 : false;
}

/** The evaluation record Open WebUI keeps for a rated reply (`POST /api/v1/evaluations/feedback`). */
export function ratingFeedback({
  history,
  message,
  annotation,
  chatId,
  chat,
  models,
}: {
  history: ChatHistory;
  message: HistoryMessage;
  annotation: ReplyAnnotation;
  chatId: string;
  /** The saved chat as it is now (the record keeps a snapshot). */
  chat: ChatRecord;
  models: Pick<ModelItem, 'id' | 'info'>[];
}): Record<string, unknown> {
  const modelOf = (item: HistoryMessage | undefined) => (typeof item?.selectedModelId === 'string' ? item.selectedModelId : (item?.model ?? ''));
  const siblings = message.parentId ? (history.messages[message.parentId]?.childrenIds ?? []).filter((id) => id !== message.id) : [];
  const siblingModels = siblings.map((id) => modelOf(history.messages[id]));
  const modelId = modelOf(message);
  const baseModels = Object.fromEntries(
    [modelId, ...siblingModels].flatMap((id) => {
      const model = models.find((item) => item.id === id);
      return model ? [[model.id, (model.info as { base_model_id?: string | null } | undefined)?.base_model_id ?? null]] : [];
    }),
  );
  return {
    type: 'rating',
    data: { ...annotation, model_id: modelId, ...(siblingModels.length > 0 ? { sibling_model_ids: siblingModels } : {}) },
    meta: {
      arena: message.arena === true,
      model_id: message.model,
      message_id: message.id,
      message_index: branchPath(history, message.id).length,
      chat_id: chatId,
      base_models: baseModels,
    },
    snapshot: { chat },
  };
}

export function createFeedback(client: OwuiClient, feedback: Record<string, unknown>): Promise<{ id: string; [key: string]: unknown }> {
  return client.post('/api/v1/evaluations/feedback', feedback);
}

export function updateFeedback(client: OwuiClient, id: string, feedback: Record<string, unknown>): Promise<{ id: string; [key: string]: unknown }> {
  return client.post(`/api/v1/evaluations/feedback/${encodeURIComponent(id)}`, feedback);
}

/** An action button a model carries (an Open WebUI "action" function). */
export interface ModelAction {
  id: string;
  name?: string;
  description?: string;
  /** A picture (often a data: URL). */
  icon?: string;
  [key: string]: unknown;
}

export function modelActions(model: Pick<ModelItem, 'id'> | undefined): ModelAction[] {
  const actions = (model as { actions?: unknown } | undefined)?.actions;
  return Array.isArray(actions) ? actions.filter((action): action is ModelAction => typeof (action as ModelAction)?.id === 'string') : [];
}

/** The body of `POST /api/chat/actions/{id}`: the conversation up to the reply, as the web sends it. */
export function chatActionBody({
  history,
  messageId,
  model,
  chatId,
  sessionId,
  event,
}: {
  history: ChatHistory;
  messageId: string;
  model: ModelItem;
  chatId: string;
  sessionId: string | null;
  event?: { id: string; data?: unknown };
}): Record<string, unknown> {
  return {
    model: model.id,
    messages: branchPath(history, messageId).map((message) => ({
      id: message.id,
      role: message.role,
      content: outputText(message.output) || message.content,
      ...(message.info ? { info: message.info } : {}),
      timestamp: message.timestamp,
      ...(message.sources ? { sources: message.sources } : {}),
    })),
    ...(event ? { event } : {}),
    model_item: model,
    chat_id: chatId,
    ...(sessionId ? { session_id: sessionId } : {}),
    id: messageId,
  };
}

/** Runs an action; it may answer with messages it changed (merge them with `mergeActionMessages`). */
export async function runChatAction(client: OwuiClient, actionId: string, body: Record<string, unknown>): Promise<{ messages?: HistoryMessage[] } | null> {
  const result = await client.post<unknown>(`/api/chat/actions/${encodeURIComponent(actionId)}`, body);
  return result && typeof result === 'object' ? (result as { messages?: HistoryMessage[] }) : null;
}

/** Messages an action changed, merged into the history (a changed reply keeps its earlier text as `originalContent`). */
export function mergeActionMessages(history: ChatHistory, messages: Partial<HistoryMessage>[] | undefined): ChatHistory {
  if (!Array.isArray(messages) || messages.length === 0) return history;
  const next = { ...history.messages };
  for (const message of messages) {
    const current = message.id ? next[message.id] : undefined;
    if (!current || !message.id) continue;
    next[message.id] = {
      ...current,
      ...(typeof message.content === 'string' && message.content !== current.content ? { originalContent: current.content } : {}),
      ...message,
    } as HistoryMessage;
  }
  return { ...history, messages: next };
}
