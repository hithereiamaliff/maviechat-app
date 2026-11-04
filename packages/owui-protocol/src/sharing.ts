import type { ChatRecord } from './chats';
import { branchPath } from './history';
import type { OwuiClient } from './http';
import { outputText } from './stream';

/*
 * Tags, share links, clone and fork, and downloads for a chat (Open WebUI 0.11.3). A share link
 * is a snapshot of the chat at the moment you share (or update) it; who may open it is set with
 * access grants: nobody but you and the people and groups you add (private), every signed-in
 * user (public), or anyone with the link, signed in or not (open).
 */

const chatPath = (id: string) => `/api/v1/chats/${encodeURIComponent(id)}`;
const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

// ── Tags ─────────────────────────────────────────────────────────────────────

export interface ChatTag {
  /** The name in lower case with underscores for spaces, as the server keys it. */
  id: string;
  name: string;
}

const tagsOf = (raw: unknown): ChatTag[] =>
  rows(raw)
    .map((tag) => ({ id: text(tag.id), name: text(tag.name) || text(tag.id) }))
    .filter((tag) => tag.id);

/** The id the server gives a tag's name (spaces become underscores, lower case). */
export function tagId(name: string): string {
  return name.replace(/ /g, '_').toLowerCase();
}

/** A tag as typed: trimmed, inner spaces kept single. Empty, or "none" (which the server refuses), gives "". */
export function cleanTagName(input: string): string {
  const name = input.trim().replace(/\s+/g, ' ');
  return tagId(name) === 'none' ? '' : name;
}

export async function getChatTags(client: OwuiClient, chatId: string): Promise<ChatTag[]> {
  return tagsOf(await client.get<unknown>(`${chatPath(chatId)}/tags`));
}

/** Adds a tag; answers with the chat's tags. A tag it already has is left as it is. */
export async function addChatTag(client: OwuiClient, chatId: string, name: string): Promise<ChatTag[]> {
  return tagsOf(await client.post<unknown>(`${chatPath(chatId)}/tags`, { name }));
}

/** Removes a tag; answers with the chat's tags. A tag no chat has any more is dropped from your list. */
export async function removeChatTag(client: OwuiClient, chatId: string, name: string): Promise<ChatTag[]> {
  return tagsOf(await client.request<unknown>('DELETE', `${chatPath(chatId)}/tags`, { body: { name } }));
}

/** Every tag on your chats. */
export async function listTags(client: OwuiClient): Promise<ChatTag[]> {
  return tagsOf(await client.get<unknown>('/api/v1/chats/all/tags')).sort((a, b) => a.name.localeCompare(b.name));
}

/** The search words that find a tag's chats (the server's search reads `tag:`). */
export function tagSearch(tag: Pick<ChatTag, 'id'>): string {
  return `tag:${tag.id}`;
}

/** The tag being typed at the end of a search (`tag:…`), or null. */
export function typedTag(search: string): string | null {
  const last = search.split(/\s+/).pop() ?? '';
  return last.toLowerCase().startsWith('tag:') ? last.slice(4).toLowerCase() : null;
}

/** The search with its last word set to the tag (other words kept). */
export function withTagSearch(search: string, tag: Pick<ChatTag, 'id'>): string {
  const words = search.split(/\s+/).filter(Boolean);
  if (words.length && (words[words.length - 1] as string).toLowerCase().startsWith('tag:')) words.pop();
  return [...words, tagSearch(tag)].join(' ');
}

// ── Share links ──────────────────────────────────────────────────────────────

export interface ShareGrant {
  principal_type: 'user' | 'group' | 'anyone';
  /** A user's or group's id; `*` for everyone. */
  principal_id: string;
  permission: string;
}

export type ShareVisibility = 'private' | 'public' | 'open';

/**
 * Shares the chat, or updates its link: either way the link then shows the chat as it is now
 * (messages sent later aren't shared until the next update). Answers with the chat and its `share_id`.
 */
export function shareChat(client: OwuiClient, chatId: string): Promise<ChatRecord> {
  return client.post<ChatRecord>(`${chatPath(chatId)}/share`);
}

/** Deletes the link (and who could open it). A new share makes a new link. */
export function unshareChat(client: OwuiClient, chatId: string): Promise<boolean> {
  return client.delete<boolean>(`${chatPath(chatId)}/share`);
}

/** The address people open: the server's own `/s/{share_id}` page. */
export function sharedChatUrl(baseUrl: string, shareId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/s/${encodeURIComponent(shareId)}`;
}

/** A chat of yours with a share link (Settings → Data Controls → Shared Chats). */
export interface SharedChat {
  chatId: string;
  title: string;
  shareId: string | null;
  /** Unix seconds. */
  updated_at: number;
  created_at: number;
}

export type SharedChatOrder = { by: 'updated_at' | 'title'; direction: 'asc' | 'desc' };

/** Shared chats per page of `GET /api/v1/chats/shared`. */
export const SHARED_PAGE_SIZE = 60;

/** Your shared chats, a page at a time, searched by title; newest change first unless `order` says otherwise. */
export async function listSharedChats(client: OwuiClient, page = 1, query?: string, order?: SharedChatOrder): Promise<SharedChat[]> {
  const raw = await client.get<unknown>('/api/v1/chats/shared', {
    query: { page, query: query?.trim() || undefined, order_by: order?.by, direction: order?.direction },
  });
  return rows(raw)
    .map((row) => ({
      chatId: text(row.chat_id) || text(row.id),
      title: text(row.title),
      shareId: text(row.share_id) || null,
      updated_at: typeof row.updated_at === 'number' ? row.updated_at : 0,
      created_at: typeof row.created_at === 'number' ? row.created_at : 0,
    }))
    .filter((chat) => chat.chatId);
}

/** Deletes every share link of yours (and who could open them). */
export function unshareAllChats(client: OwuiClient): Promise<boolean> {
  return client.delete<boolean>('/api/v1/chats/share/all');
}

const grantsOf = (raw: unknown): ShareGrant[] =>
  rows(raw).flatMap((grant): ShareGrant[] => {
    const type = grant.principal_type;
    const id = text(grant.principal_id);
    const permission = text(grant.permission);
    if ((type !== 'user' && type !== 'group' && type !== 'anyone') || !id || !permission) return [];
    return [{ principal_type: type, principal_id: id, permission }];
  });

/** Who may open the chat's link. */
export async function getShareAccess(client: OwuiClient, chatId: string): Promise<ShareGrant[]> {
  return grantsOf(await client.get<unknown>(`/api/v1/chats/shared/${encodeURIComponent(chatId)}/access`));
}

/** Sets who may open the link. The server drops grants your permissions don't allow (public or open links). */
export async function setShareAccess(client: OwuiClient, chatId: string, grants: ShareGrant[]): Promise<void> {
  await client.post(`/api/v1/chats/shared/${encodeURIComponent(chatId)}/access/update`, { access_grants: grants });
}

const isEveryone = (grant: ShareGrant) => (grant.principal_type === 'user' || grant.principal_type === 'anyone') && grant.principal_id === '*';

export function shareVisibility(grants: ShareGrant[]): ShareVisibility {
  if (grants.some((grant) => grant.principal_type === 'anyone' && grant.principal_id === '*' && grant.permission === 'read')) return 'open';
  if (grants.some((grant) => grant.principal_type === 'user' && grant.principal_id === '*' && grant.permission === 'read')) return 'public';
  return 'private';
}

/** The grants with everyone's access set to `visibility` (the people and groups added stay). */
export function withShareVisibility(grants: ShareGrant[], visibility: ShareVisibility): ShareGrant[] {
  const kept = grants.filter((grant) => !isEveryone(grant));
  if (visibility === 'public') kept.push({ principal_type: 'user', principal_id: '*', permission: 'read' });
  if (visibility === 'open') kept.push({ principal_type: 'anyone', principal_id: '*', permission: 'read' });
  return kept;
}

/** The people and groups added by name (beyond everyone). */
export function sharedWith(grants: ShareGrant[]): { users: string[]; groups: string[] } {
  const reading = grants.filter((grant) => grant.permission === 'read' && grant.principal_id !== '*');
  return {
    users: reading.filter((grant) => grant.principal_type === 'user').map((grant) => grant.principal_id),
    groups: reading.filter((grant) => grant.principal_type === 'group').map((grant) => grant.principal_id),
  };
}

/** The grants with one person or group added (`on`) or removed. */
export function withSharedWith(grants: ShareGrant[], type: 'user' | 'group', id: string, on: boolean): ShareGrant[] {
  const others = grants.filter((grant) => !(grant.principal_type === type && grant.principal_id === id));
  return on ? [...others, { principal_type: type, principal_id: id, permission: 'read' }] : others;
}

/** A shared chat as the link shows it (you, people allowed, or anyone for an open link). */
export function getSharedChat(client: OwuiClient, shareId: string): Promise<ChatRecord> {
  return client.get<ChatRecord>(`/api/v1/chats/share/${encodeURIComponent(shareId)}`);
}

/** A shared chat copied into your own chats ("Clone of …"). Needs the `chat.import` permission. */
export function cloneSharedChat(client: OwuiClient, shareId: string): Promise<ChatRecord> {
  return client.post<ChatRecord>(`${chatPath(shareId)}/clone/shared`);
}

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
}

const userOf = (raw: Record<string, unknown>): DirectoryUser => ({ id: text(raw.id), name: text(raw.name) || text(raw.email), email: text(raw.email) });

/** People on the server to share with, by name or email (the server's first page of matches). */
export async function searchUsers(client: OwuiClient, query: string): Promise<DirectoryUser[]> {
  const body = record(await client.get<unknown>('/api/v1/users/search', { query: { query, page: 1 } }));
  return rows(body.users)
    .map(userOf)
    .filter((user) => user.id);
}

/** One person's name, for the people a link is shared with. */
export async function getUserInfo(client: OwuiClient, id: string): Promise<DirectoryUser> {
  return userOf(record(await client.get<unknown>(`/api/v1/users/${encodeURIComponent(id)}/info`)));
}

export interface ShareGroup {
  id: string;
  name: string;
  members: number | null;
}

/** The groups you may share with. */
export async function listShareGroups(client: OwuiClient): Promise<ShareGroup[]> {
  return rows(await client.get<unknown>('/api/v1/groups/', { query: { share: true } }))
    .map((group) => ({ id: text(group.id), name: text(group.name), members: typeof group.member_count === 'number' ? group.member_count : null }))
    .filter((group) => group.id);
}

// ── Copies ───────────────────────────────────────────────────────────────────

/** A copy of the whole chat, every branch included ("Clone of …" unless titled). Needs the `chat.import` permission. */
export function cloneChat(client: OwuiClient, id: string, title?: string): Promise<ChatRecord> {
  return client.post<ChatRecord>(`${chatPath(id)}/clone`, title ? { title } : {});
}

/**
 * A new chat with the conversation up to a message (the shown one by default): "… (fork)". The
 * server refuses (409) while a reply is being written. Needs the `chat.import` permission.
 */
export function forkChat(client: OwuiClient, id: string, messageId?: string | null): Promise<ChatRecord> {
  return client.post<ChatRecord>(`${chatPath(id)}/fork`, { message_id: messageId ?? null });
}

// ── Downloads ────────────────────────────────────────────────────────────────

/** The shown branch as plain text, as the web's .txt download writes it: `### ROLE` then the text, per message. */
export function chatPlainText(chat: Pick<ChatRecord, 'chat'>): string {
  const history = chat.chat?.history;
  if (!history) return '';
  return branchPath(history)
    .map((message) => `### ${String(message.role).toUpperCase()}\n${outputText(message.output) || message.content || ''}\n\n`)
    .join('')
    .trim();
}

/** The chat as the web's .json export writes it: a list holding the whole chat record. */
export function chatJson(chat: ChatRecord): string {
  return JSON.stringify([chat]);
}

/** A file name from a chat's title that any file system takes. */
export function exportFileName(title: string, extension: 'txt' | 'json' | 'pdf'): string {
  const name = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return extension === 'json' ? `chat-export-${name || 'chat'}.json` : `chat-${name || 'chat'}.${extension}`;
}
