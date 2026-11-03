import type { ChatHistory, HistoryMessage } from './history';
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

/** Archived chats, 60 a page, newest first; `query` filters by title. */
export function listArchivedChats(client: OwuiClient, page = 1, query?: string): Promise<ChatListItem[]> {
  return client.get<ChatListItem[]>('/api/v1/chats/archived', { query: { page, ...(query ? { query } : {}) } });
}

export function unarchiveAllChats(client: OwuiClient): Promise<boolean> {
  return client.post<boolean>('/api/v1/chats/unarchive/all');
}

/** Brings the unread dot back (reading is reported over the socket: `SocketSession.markRead`). */
export function markChatUnread(client: OwuiClient, id: string): Promise<unknown> {
  return client.post<unknown>(`${chatPath(id)}/unread`);
}

export function deleteChat(client: OwuiClient, id: string): Promise<boolean> {
  return client.delete<boolean>(chatPath(id));
}

/**
 * Removes a message and its replies; the server re-attaches deeper messages to the parent.
 * Needs the `chat.delete_message` permission (admins always may).
 */
export function deleteMessage(client: OwuiClient, chatId: string, messageId: string): Promise<ChatRecord> {
  return client.delete<ChatRecord>(`${chatPath(chatId)}/messages/${encodeURIComponent(messageId)}`);
}

/**
 * Saves one edited message in place. The server merges histories by message id, so only
 * this (complete) message is sent; `currentId` keeps the shown branch.
 */
export function saveMessage(client: OwuiClient, chatId: string, message: HistoryMessage, currentId: string | null): Promise<ChatRecord> {
  return saveMessages(client, chatId, [message], currentId);
}

/** Saves several complete messages at once (a new reply version and its parent's children, say). */
export function saveMessages(client: OwuiClient, chatId: string, messages: HistoryMessage[], currentId: string | null): Promise<ChatRecord> {
  return client.post<ChatRecord>(chatPath(chatId), { chat: { history: { messages: Object.fromEntries(messages.map((message) => [message.id, message])), currentId } } });
}

/** Creates a saved chat from a whole history (used to keep a temporary chat). The server picks the id. */
export function createChat(client: OwuiClient, chat: ChatDocument): Promise<ChatRecord> {
  return client.post<ChatRecord>('/api/v1/chats/new', { chat });
}

/** `null` moves the chat out of its folder. */
export function moveChatToFolder(client: OwuiClient, id: string, folderId: string | null): Promise<ChatRecord> {
  return client.post<ChatRecord>(`${chatPath(id)}/folder`, { folder_id: folderId });
}
