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
 * What Open WebUI posts to a plain webhook URL: the event's data as-is. For a finished
 * chat that is `{action: "chat", title, message, url}` (`chat_failed` when it failed,
 * `test` from its "send test" button); `message` is the reply text.
 */
export interface WebhookBody {
  action?: unknown;
  title?: unknown;
  message?: unknown;
  url?: unknown;
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

function chatTitle(value: unknown): string | null {
  const title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  // A first reply finishes before its title is written.
  return title && title !== 'New Chat' ? title.slice(0, 80) : null;
}

/** The notification for a webhook call, or null for events MavieChat doesn't announce. */
export function pushFor(body: WebhookBody, pushToken: string): PushMessage | null {
  const action = typeof body.action === 'string' ? body.action : '';
  const title = chatTitle(body.title);
  const chatId = typeof body.url === 'string' ? chatIdFromUrl(body.url) : null;
  const text = typeof body.message === 'string' ? preview(body.message) : '';
  const base = { to: pushToken, sound: 'default' as const, priority: 'high' as const, ...(chatId ? { threadId: chatId } : {}) };
  switch (action) {
    case 'chat':
      return { ...base, title: title ? `Reply ready: ${title}` : 'Reply ready', body: text || 'Open the chat to read it.', data: { kind: 'chat.finished', ...(chatId ? { chatId } : {}) } };
    case 'chat_failed':
      return { ...base, title: title ? `Reply failed: ${title}` : 'Reply failed', body: text || 'Open the chat to try again.', data: { kind: 'chat.failed', ...(chatId ? { chatId } : {}) } };
    case 'test':
      return { to: pushToken, sound: 'default', priority: 'high', title: 'MavieChat notifications work', body: 'Open WebUI can reach your phone.', data: { kind: 'test' } };
    default:
      return null;
  }
}
