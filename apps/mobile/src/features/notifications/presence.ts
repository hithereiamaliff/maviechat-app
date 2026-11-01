/**
 * What the app is showing, for deciding whether a push notification needs a banner.
 * While Open WebUI's live connection is up, the app announces finished replies itself.
 */
let viewingChatId: string | null = null;
let liveConnected = false;

export function setPresence(next: { viewingChatId?: string | null; liveConnected?: boolean }): void {
  if (next.viewingChatId !== undefined) viewingChatId = next.viewingChatId;
  if (next.liveConnected !== undefined) liveConnected = next.liveConnected;
}

/** Show a banner unless you're looking at that chat, or the app will announce it in its own notice. */
export function shouldPresent(chatId: unknown): boolean {
  if (typeof chatId === 'string' && chatId === viewingChatId) return false;
  return !liveConnected;
}
