import type { DtBookDetail } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';

/** Opens a page's chat: the one it has (each page keeps one), or a new one. */
export function openPageChat(detail: DtBookDetail, pageId: string): void {
  const sessionId = detail.book.pageChats[pageId];
  if (sessionId) router.push({ pathname: '/learn/[id]', params: { id: sessionId } });
  else router.push({ pathname: '/learn/books/chat', params: { book: detail.book.id, page: pageId } });
}

/** Our starters for a new chat about a page: tapping one sends it. */
export const PAGE_CHAT_STARTERS = ['Explain this page more simply.', 'Give me an everyday example of the main idea.', 'Ask me a question to check I understood this page.'];
