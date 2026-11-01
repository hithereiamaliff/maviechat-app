import type { ChatListItem } from '@maviechat/owui-protocol';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

/** Updates one chat in every cached list (sidebar pages, pinned, folders, search) until the next refetch. */
export function patchChatRow(queryClient: QueryClient, chatId: string, patch: Partial<ChatListItem>): void {
  const fix = (rows: ChatListItem[] | undefined) => rows?.map((row) => (row.id === chatId ? { ...row, ...patch } : row));
  queryClient.setQueryData<InfiniteData<ChatListItem[]>>(['chats', 'list'], (data) => (data ? { ...data, pages: data.pages.map((page) => fix(page) ?? page) } : data));
  queryClient.setQueriesData<ChatListItem[]>({ queryKey: ['chats', 'pinned'] }, fix);
  queryClient.setQueriesData<ChatListItem[]>({ queryKey: ['chats', 'search'] }, fix);
  queryClient.setQueriesData<ChatListItem[]>({ queryKey: ['folder-chats'] }, fix);
}
