import type { ChatHistory } from './history';
import type { OwuiClient } from './http';

/** A row of the sidebar lists (`ChatTitleIdResponse`). Times are Unix seconds. */
export interface ChatListItem {
  id: string;
  title: string;
  updated_at: number;
  created_at: number;
  last_read_at?: number | null;
  snippet?: string | null;
  /** A reply is being generated right now. */
  active?: boolean;
  [key: string]: unknown;
}

/** The chat's JSON document (`chat` column). */
export interface ChatDocument {
  id?: string;
  title?: string;
  models?: string[];
  history?: ChatHistory;
  messages?: unknown[];
  tags?: unknown[];
  files?: unknown[];
  params?: Record<string, unknown>;
  timestamp?: number;
  [key: string]: unknown;
}

/** `GET /api/v1/chats/{id}`. While a reply streams, the server overlays its partial output with `done: false`. */
export interface ChatRecord {
  id: string;
  user_id?: string;
  title: string;
  chat: ChatDocument;
  updated_at: number;
  created_at: number;
  pinned?: boolean | null;
  archived?: boolean;
  folder_id?: string | null;
  share_id?: string | null;
  current_message_id?: string | null;
  [key: string]: unknown;
}

/** Chats per page of the list endpoints. */
export const CHAT_PAGE_SIZE = 60;

const chatPath = (id: string) => `/api/v1/chats/${encodeURIComponent(id)}`;

/** Unpinned chats outside folders, newest first (what the sidebar's dated list shows). */
export function listChats(client: OwuiClient, page = 1): Promise<ChatListItem[]> {
  return client.get<ChatListItem[]>('/api/v1/chats/', { query: { page } });
}

export function listPinnedChats(client: OwuiClient): Promise<ChatListItem[]> {
  return client.get<ChatListItem[]>('/api/v1/chats/pinned');
}

export function searchChats(client: OwuiClient, text: string, page = 1): Promise<ChatListItem[]> {
  return client.get<ChatListItem[]>('/api/v1/chats/search', { query: { text, page } });
}

export function listFolderChats(client: OwuiClient, folderId: string, page = 1): Promise<ChatListItem[]> {
  return client.get<ChatListItem[]>(`/api/v1/chats/folder/${encodeURIComponent(folderId)}/list`, { query: { page } });
}

export function getChat(client: OwuiClient, id: string): Promise<ChatRecord> {
  return client.get<ChatRecord>(chatPath(id));
}

/** The server patches top-level keys only, so a rename never touches the history. */
export function renameChat(client: OwuiClient, id: string, title: string): Promise<ChatRecord> {
  return client.post<ChatRecord>(chatPath(id), { chat: { title } });
}

/**
 * Records which branch is shown. Sends no messages: the server merges histories
 * (union of messages, `currentId` kept only if that message exists), so nothing is lost.
 */
export function selectBranch(client: OwuiClient, id: string, currentId: string): Promise<ChatRecord> {
  return client.post<ChatRecord>(chatPath(id), { chat: { history: { messages: {}, currentId } } });
}

/** Toggles pinned; answers with the updated chat. */
export function togglePinned(client: OwuiClient, id: string): Promise<ChatRecord> {
  return client.post<ChatRecord>(`${chatPath(id)}/pin`);
}

/** Toggles archived; answers with the updated chat. */
export function toggleArchived(client: OwuiClient, id: string): Promise<ChatRecord> {
  return client.post<ChatRecord>(`${chatPath(id)}/archive`);
}

export function deleteChat(client: OwuiClient, id: string): Promise<boolean> {
  return client.delete<boolean>(chatPath(id));
}

/** `null` moves the chat out of its folder. */
export function moveChatToFolder(client: OwuiClient, id: string, folderId: string | null): Promise<ChatRecord> {
  return client.post<ChatRecord>(`${chatPath(id)}/folder`, { folder_id: folderId });
}
