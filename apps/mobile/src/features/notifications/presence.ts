/**
 * Which chat is on screen, for deciding whether a push notification gets a banner while the
 * app is open. Every notification does, except one about the reply you're watching arrive.
 */
let viewingChatId: string | null = null;

export function setViewingChat(chatId: string | null): void {
  viewingChatId = chatId;
}

/** Show a banner unless the notification is about the chat on screen (an Open WebUI chat or a DeepTutor session). */
export function shouldPresent(data: { chatId?: unknown; sessionId?: unknown; kind?: unknown } | null | undefined): boolean {
  const id = typeof data?.chatId === 'string' ? data.chatId : typeof data?.sessionId === 'string' ? data.sessionId : null;
  return !(id && id === viewingChatId);
}
