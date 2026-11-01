/** A message for Expo's push service. */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: { kind: 'chat.finished' | 'chat.failed' | 'test'; chatId?: string };
  sound: 'default';
  priority: 'high';
  threadId?: string;
}

/**
 * What Open WebUI's server-wide event webhooks post (Admin Panel → Settings → Events): the
 * event as recorded, e.g. `{event: "chat.finished", actor: {id, …}, data: {user_id, chat_id,
 * title, message, url, …}}`. `message` is the reply (or the error), cut to 1000 characters.
 */
export interface OwuiEvent {
  event?: unknown;
  actor?: { id?: unknown } | null;
  data?: { user_id?: unknown; chat_id?: unknown; title?: unknown; message?: unknown; url?: unknown } | null;
}

/** A finished or failed reply, and whose phones should hear about it. */
export interface ChatOutcome {
  userId: string;
  kind: 'chat.finished' | 'chat.failed';
  chatId: string | null;
  title: string | null;
  text: string;
}

const PREVIEW_LENGTH = 140;

/** Open WebUI folds "/c/" out of chat links (`https://host/<chat id>`, or `/<chat id>` without a public URL). */
export function chatIdFromUrl(url: string): string | null {
  const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').split(/[?#]/)[0] ?? '';
  const last = path.split('/').filter(Boolean).pop();
  return last && /^[\w-]{8,}$/.test(last) ? last : null;
}

/** The start of a reply as plain text: no code blocks, reasoning, images or Markdown marks. */
export function preview(markdown: string, limit = PREVIEW_LENGTH): string {
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/<details[\s\S]*?(<\/details>|$)/gi, ' ')
    .replace(/<think(ing)?>[\s\S]*?(<\/think(ing)?>|$)/gi, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~`|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The chat outcome an event describes, or null for events MavieChat doesn't announce. */
export function chatOutcome(event: OwuiEvent): ChatOutcome | null {
  if (event.event !== 'chat.finished' && event.event !== 'chat.failed') return null;
  const data = event.data ?? {};
  const userId = text(data.user_id) || text(event.actor?.id);
  if (!userId) return null;
  const title = text(data.title).replace(/\s+/g, ' ').trim();
  return {
    userId,
    kind: event.event,
    chatId: text(data.chat_id) || chatIdFromUrl(text(data.url)),
    // A first reply finishes before its title is written.
    title: title && title !== 'New Chat' ? title.slice(0, 80) : null,
    text: preview(text(data.message)),
  };
}

export function notificationFor(outcome: ChatOutcome, pushToken: string): PushMessage {
  const finished = outcome.kind === 'chat.finished';
  const heading = finished ? 'Reply ready' : 'Reply failed';
  return {
    to: pushToken,
    title: outcome.title ? `${heading}: ${outcome.title}` : heading,
    body: outcome.text || (finished ? 'Open the chat to read it.' : 'Open the chat to try again.'),
    data: { kind: outcome.kind, ...(outcome.chatId ? { chatId: outcome.chatId } : {}) },
    sound: 'default',
    priority: 'high',
    ...(outcome.chatId ? { threadId: outcome.chatId } : {}),
  };
}

export function testNotification(pushToken: string): PushMessage {
  return { to: pushToken, title: 'MavieChat notifications work', body: 'Replies that finish while MavieChat is closed will show up like this.', data: { kind: 'test' }, sound: 'default', priority: 'high' };
}
