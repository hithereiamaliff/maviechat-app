import type { DtClient } from './http';
import { applyTurnEvent, emptyReply, type DtReply } from './turnReply';
import { parseServerEvent, type DtLlmSelection, type DtStreamEvent } from './turns';

/*
 * DeepTutor's Partners (1.7.1, `/api/partners`): companions with a soul (a persona in Markdown),
 * a face, a model and tools, that you talk to here or from chat apps. Each conversation is a
 * session keyed by the client (`web-…` from the web, `telegram_…` from Telegram); replies stream
 * over `/ws/partners/{id}` in the same events as DeepTutor's main chat.
 */

type Tree = Record<string, unknown>;
const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const partnerPath = (id: string) => `/api/partners/${encodeURIComponent(id)}`;

/**
 * DeepTutor's times come three ways: the server's clock with no zone and microseconds (partner
 * messages and conversations), UTC times with an offset (groups), and Unix seconds (the sidebar).
 * A time with no zone is read as UTC, the clock DeepTutor's container keeps. Milliseconds, or null.
 */
export function partnerTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
  if (typeof value !== 'string' || !value.trim()) return null;
  let iso = value.trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(iso)) iso += 'Z';
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

function selectionOf(value: unknown): DtLlmSelection | null {
  if (!isTree(value) || !text(value.profile_id) || !text(value.model_id)) return null;
  return { profile_id: text(value.profile_id), model_id: text(value.model_id) };
}

// ── Partners ─────────────────────────────────────────────────────────────────

export interface DtPartner {
  id: string;
  name: string;
  description: string;
  emoji: string;
  /** `#rrggbb`, or "". */
  color: string;
  /** A `data:image/…` picture, which wins over the emoji. */
  avatar: string;
  /** "" follows the account's reply language. */
  language: string;
  running: boolean;
  /** Yours (or you're an admin): you can set it up, start, stop and delete it. Otherwise it's shared with you. */
  canManage: boolean;
  /** The chat apps it's connected to (names). */
  channels: string[];
  llmSelection: DtLlmSelection | null;
  /** Tried once when the main model fails outright. */
  backupLlmSelection: DtLlmSelection | null;
  /** Bound to one of your workspaces (shared resources), or "" for a private library. */
  workspaceId: string;
  /** Tools it may use: null = all you may use; [] = none (MCP tools default to none). */
  enabledTools: string[] | null;
  builtinTools: string[] | null;
  mcpTools: string[] | null;
  /** Set when its chat-app listeners failed to restart. */
  lastReloadError: string;
}

const names = (value: unknown): string[] | null => (Array.isArray(value) ? value.map(text).filter(Boolean) : null);

/** Names DeepTutor keeps in `channels` that aren't chat apps (older settings). */
const NOT_CHANNELS = new Set(['send_progress', 'send_tool_hints']);

export function partnerOf(raw: unknown): DtPartner {
  const row = isTree(raw) ? raw : {};
  const channels = Array.isArray(row.channels) ? row.channels.map(text) : isTree(row.channels) ? Object.keys(row.channels) : [];
  return {
    id: text(row.partner_id) || text(row.id),
    name: text(row.name) || text(row.partner_id) || 'Partner',
    description: text(row.description),
    emoji: text(row.emoji),
    color: /^#[0-9a-f]{6}$/i.test(text(row.color)) ? text(row.color) : '',
    avatar: text(row.avatar).startsWith('data:image/') ? text(row.avatar) : '',
    language: text(row.language),
    running: row.running === true,
    canManage: row.can_manage === true,
    channels: channels.filter((name) => name && !NOT_CHANNELS.has(name)),
    llmSelection: selectionOf(row.llm_selection),
    backupLlmSelection: selectionOf(row.backup_llm_selection),
    workspaceId: text(row.workspace_id),
    enabledTools: names(row.enabled_tools),
    builtinTools: names(row.builtin_tools),
    mcpTools: 'mcp_tools' in row ? names(row.mcp_tools) : [],
    lastReloadError: text(row.last_reload_error),
  };
}

/** Your partners in full and the ones shared with you (their name and face only). */
export async function listPartners(client: DtClient): Promise<DtPartner[]> {
  return list(await client.get<unknown>('/api/partners')).map(partnerOf).filter((partner) => partner.id);
}

/** One partner; 404 when it's gone or not yours to use. */
export async function getPartner(client: DtClient, id: string): Promise<DtPartner> {
  return partnerOf(await client.get<unknown>(partnerPath(id)));
}

/** Starts it (and its chat-app listeners), and keeps it running when DeepTutor restarts. */
export async function startPartner(client: DtClient, id: string): Promise<void> {
  await client.post<unknown>(`${partnerPath(id)}/start`);
}

/** Stops it (and its chat-app listeners). DeepTutor answers 404 when it wasn't running. */
export async function stopPartner(client: DtClient, id: string): Promise<void> {
  await client.post<unknown>(`${partnerPath(id)}/stop`);
}

/** Deletes it with all its conversations, library and links. */
export async function deletePartner(client: DtClient, id: string): Promise<void> {
  await client.delete<unknown>(partnerPath(id));
}

// ── Souls and a new partner ──────────────────────────────────────────────────

export interface DtSoul {
  id: string;
  name: string;
  /** Markdown: who the partner is and how it talks. */
  content: string;
}

/** The shared soul library (DeepTutor seeds five). */
export async function listSouls(client: DtClient): Promise<DtSoul[]> {
  return list(await client.get<unknown>('/api/partners/souls'))
    .filter(isTree)
    .map((row) => ({ id: text(row.id), name: text(row.name) || text(row.id), content: text(row.content) }))
    .filter((soul) => soul.id);
}

/** The colours DeepTutor offers for a face. */
export const PARTNER_COLORS = ['#b0501e', '#8c6a2f', '#4f7a5b', '#3d6b8a', '#6d5a8c', '#8a4f5f', '#a8763e', '#5b8a8a'] as const;

/** Reply languages DeepTutor offers a partner ("" = the account's own). */
export const PARTNER_LANGUAGES: { code: string; label: string }[] = [
  { code: '', label: 'Automatic' },
  { code: 'en', label: 'English' },
  { code: 'ms', label: 'Malay' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'zh-tw', label: 'Chinese (Traditional)' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'id', label: 'Indonesian' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'pl', label: 'Polish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ar', label: 'Arabic' },
];

export interface DtNewPartner {
  name: string;
  description?: string;
  emoji?: string;
  color?: string;
  /** A `data:image/…` picture (up to 200,000 characters), which wins over the emoji. */
  avatar?: string;
  language?: string;
  /** From the library, or written here. */
  soul: { source: 'library'; id: string } | { source: 'custom'; content: string };
  /** Null: DeepTutor's default model. */
  llmSelection?: DtLlmSelection | null;
  /** Skills copied into its library (the web copies all of yours). */
  skills?: string[];
}

/**
 * Creates a partner the way the web's wizard does by default, and starts it: every tool you're
 * allowed and the built-in ones, no MCP tools, a private library. 409 when a partner already has
 * this name (its id is made from the name).
 */
export async function createPartner(client: DtClient, input: DtNewPartner): Promise<{ partner: DtPartner; startError: string }> {
  const body: Tree = {
    name: input.name.trim(),
    workspace_id: '',
    soul: input.soul.source === 'library' ? { source: 'library', id: input.soul.id } : { source: 'custom', content: input.soul.content },
    llm_selection: input.llmSelection ?? null,
    enabled_tools: null,
    builtin_tools: null,
    mcp_tools: [],
    assets: { knowledge_bases: [], skills: input.skills ?? [], notebooks: [] },
    start: true,
  };
  if (input.description?.trim()) body.description = input.description.trim();
  if (input.emoji) body.emoji = input.emoji;
  if (input.color) body.color = input.color;
  if (input.avatar) body.avatar = input.avatar;
  if (input.language) body.language = input.language;
  const raw = await client.post<unknown>('/api/partners', body, { timeoutMs: 120_000 });
  return { partner: partnerOf(raw), startError: isTree(raw) ? text(raw.start_error) : '' };
}

/** Names of the skills you can give a partner (`GET /api/skills/list`). */
export async function listSkillNames(client: DtClient): Promise<string[]> {
  const raw = await client.get<unknown>('/api/skills/list');
  const rows = isTree(raw) ? list(raw.skills) : list(raw);
  return rows.map((row) => (isTree(row) ? text(row.name) : text(row))).filter(Boolean);
}

// ── Groups (listed here; their pages are DeepTutor's own for now) ────────────

export interface DtPartnerGroup {
  id: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  members: Pick<DtPartner, 'id' | 'name' | 'emoji' | 'color' | 'avatar' | 'running'>[];
  /** `panel_parallel`, `sequential` or `debate`. */
  mode: string;
  /** Milliseconds. */
  updatedAt: number | null;
}

export const DISCUSSION_MODE_LABELS: Record<string, string> = { panel_parallel: 'Parallel answers', sequential: 'One after another', debate: 'Cross-examination' };

export async function listPartnerGroups(client: DtClient): Promise<DtPartnerGroup[]> {
  return list(await client.get<unknown>('/api/partner-groups'))
    .filter(isTree)
    .map((row) => ({
      id: text(row.group_id),
      name: text(row.name) || 'Group',
      description: text(row.description),
      emoji: text(row.emoji) || '👥',
      color: /^#[0-9a-f]{6}$/i.test(text(row.color)) ? text(row.color) : '',
      members: list(row.members).map(partnerOf),
      mode: text(row.discussion_mode) || 'panel_parallel',
      updatedAt: partnerTime(row.updated_at),
    }))
    .filter((group) => group.id);
}

// ── Conversations ────────────────────────────────────────────────────────────

/** A conversation with a partner or group, as the sidebar lists them (newest first). */
export interface DtPartnerRecent {
  kind: 'partner' | 'group';
  ownerId: string;
  ownerName: string;
  sessionKey: string;
  title: string;
  updatedAt: number | null;
}

/** Your latest conversations with partners and groups (archived ones left out). */
export async function recentPartnerConversations(client: DtClient): Promise<DtPartnerRecent[]> {
  const raw = await client.get<unknown>('/api/partners/navigation');
  return list(isTree(raw) ? raw.sessions : [])
    .filter(isTree)
    .map((row) => ({
      kind: row.kind === 'group' ? ('group' as const) : ('partner' as const),
      ownerId: text(row.owner_id),
      ownerName: text(row.owner_name),
      sessionKey: text(row.session_key),
      title: text(row.title),
      updatedAt: partnerTime(row.updated_at),
    }))
    .filter((row) => row.ownerId && row.sessionKey);
}

export interface DtPartnerSession {
  /** As DeepTutor lists it: send it back as it is. */
  key: string;
  title: string;
  messageCount: number;
  updatedAt: number | null;
  lastMessage: string;
  archived: boolean;
  /** Where it was held: "web", or a chat app's name (`telegram_123` → "telegram"). */
  channel: string;
}

/** Where a conversation was held, from its key: `web-…`/`web_…` here, `telegram_…` in Telegram. */
export function sessionChannel(key: string): string {
  const head = key.split(/[-_:]/)[0]?.toLowerCase() ?? '';
  return head === 'web' || head === 'partner' ? 'web' : head;
}

/** Your conversations with a partner, newest first: archived ones and chat apps' too. */
export async function listPartnerSessions(client: DtClient, id: string): Promise<DtPartnerSession[]> {
  return list(await client.get<unknown>(`${partnerPath(id)}/sessions`))
    .filter(isTree)
    .map((row) => ({
      key: text(row.session_key),
      title: text(row.title),
      messageCount: typeof row.message_count === 'number' ? row.message_count : 0,
      updatedAt: partnerTime(row.updated_at),
      lastMessage: text(row.last_message),
      archived: row.archived === true,
      channel: sessionChannel(text(row.session_key)),
    }))
    .filter((session) => session.key);
}

/** The conversation to carry on: the newest web one not archived, if any. */
export function currentWebSession(sessions: DtPartnerSession[]): DtPartnerSession | null {
  return sessions.find((session) => session.channel === 'web' && !session.archived && session.messageCount > 0) ?? null;
}

/** A new conversation's key, as the web makes them (`web-` and 8 letters or digits). */
export function newPartnerSessionKey(random: () => number = Math.random): string {
  let tail = '';
  while (tail.length < 8) tail += Math.floor(random() * 36).toString(36);
  return `web-${tail}`;
}

/** Ends the conversation (kept, marked archived): the web's "new conversation". 409 while it's replying. */
export async function archivePartnerSession(client: DtClient, id: string, key: string): Promise<void> {
  await client.post<unknown>(`${partnerPath(id)}/sessions/archive`, { session_key: key });
}

/** Brings an archived conversation back. */
export async function resumePartnerSession(client: DtClient, id: string, key: string): Promise<void> {
  await client.post<unknown>(`${partnerPath(id)}/sessions/resume`, { session_key: key });
}

export async function deletePartnerSession(client: DtClient, id: string, key: string): Promise<void> {
  await client.post<unknown>(`${partnerPath(id)}/sessions/delete`, { session_key: key });
}

// ── History ──────────────────────────────────────────────────────────────────

export interface DtPartnerRecord {
  /** Its place in the whole conversation (stays put as the conversation grows). */
  index: number;
  role: 'user' | 'assistant';
  content: string;
  at: number | null;
  /** "web", or the chat app it came through. */
  channel: string;
  /** Names of files you sent (they can't be downloaded again). */
  attachments: string[];
  /** A reply's steps as they happened (reasoning, tools, sources). */
  events: DtStreamEvent[];
}

/** A raw event as a stream event, or null for anything else. */
export function streamEventOf(raw: unknown): DtStreamEvent | null {
  const event = parseServerEvent(raw);
  return event && 'stage' in event ? event : null;
}

/** Messages of a conversation, oldest first, a page at a time: `before` is the last page's `nextBefore`. */
export async function partnerHistoryPage(client: DtClient, id: string, key: string, before?: number | null, limit = 60): Promise<{ records: DtPartnerRecord[]; nextBefore: number | null; start: number; total: number }> {
  const raw = await client.get<unknown>(`${partnerPath(id)}/history/page`, { query: { session_key: key, before: before ?? undefined, limit } });
  const page = isTree(raw) ? raw : {};
  const start = typeof page.start === 'number' ? page.start : 0;
  const records = list(page.messages)
    .map((row, at) => ({ row: isTree(row) ? row : {}, at }))
    .filter(({ row }) => row.role === 'user' || row.role === 'assistant')
    .map(({ row, at: offset }) => ({
      index: start + offset,
      role: row.role as 'user' | 'assistant',
      content: text(row.content),
      at: partnerTime(row.timestamp),
      channel: text(row.channel) || 'web',
      attachments: list(row.attachments).flatMap((item) => (isTree(item) && text(item.filename) ? [text(item.filename)] : [])),
      events: list(row.events).map(streamEventOf).filter((event): event is DtStreamEvent => event !== null),
    }));
  return {
    records,
    nextBefore: typeof page.next_before === 'number' ? page.next_before : null,
    start,
    total: typeof page.total === 'number' ? page.total : records.length,
  };
}

/** A saved reply as the app shows replies: its steps rebuilt from its events, its words as saved. */
export function recordReply(record: DtPartnerRecord): DtReply {
  let reply = emptyReply();
  for (const event of record.events) if (event.type !== 'done') reply = applyTurnEvent(reply, event);
  return { ...reply, answer: record.content || reply.answer, status: 'completed' };
}

// ── Setting a partner up (yours) ─────────────────────────────────────────────

export interface DtPartnerChange {
  name?: string;
  description?: string;
  emoji?: string;
  color?: string;
  /** A `data:image/…` picture (DeepTutor keeps up to 200,000 characters), or "" for none. */
  avatar?: string;
  language?: string;
  /** null: DeepTutor's default model. */
  llmSelection?: DtLlmSelection | null;
  /** null: no backup. */
  backupLlmSelection?: DtLlmSelection | null;
  /** null: every tool you may use; a list: only those. */
  enabledTools?: string[] | null;
  builtinTools?: string[] | null;
  /** null: every MCP tool; [] none. */
  mcpTools?: string[] | null;
  /** "": its private library. */
  workspaceId?: string;
}

/**
 * Changes some of a partner's settings: only what `change` names is sent. Models and tools apply
 * from its next message; chat apps aren't touched (DeepTutor replaces those whole).
 */
export async function updatePartner(client: DtClient, id: string, change: DtPartnerChange): Promise<DtPartner> {
  const body: Tree = {};
  const keys: [keyof DtPartnerChange, string][] = [
    ['name', 'name'],
    ['description', 'description'],
    ['emoji', 'emoji'],
    ['color', 'color'],
    ['avatar', 'avatar'],
    ['language', 'language'],
    ['llmSelection', 'llm_selection'],
    ['backupLlmSelection', 'backup_llm_selection'],
    ['enabledTools', 'enabled_tools'],
    ['builtinTools', 'builtin_tools'],
    ['mcpTools', 'mcp_tools'],
    ['workspaceId', 'workspace_id'],
  ];
  for (const [ours, theirs] of keys) if (ours in change) body[theirs] = change[ours] ?? null;
  const raw = await client.send<unknown>('PATCH', partnerPath(id), { body });
  return partnerOf(raw.data);
}

/** Its soul as Markdown. */
export async function getPartnerSoul(client: DtClient, id: string): Promise<string> {
  const raw = await client.get<unknown>(`${partnerPath(id)}/soul`);
  return isTree(raw) ? text(raw.content) : '';
}

/** Saves its soul; it applies from the next message. */
export async function savePartnerSoul(client: DtClient, id: string, content: string): Promise<void> {
  await client.send<unknown>('PUT', `${partnerPath(id)}/soul`, { body: { content } });
}

export interface DtPartnerTool {
  name: string;
  description: string;
  /** MCP tools: the service it comes from. */
  server?: string;
}

/** The tools you may give a partner: DeepTutor's switchable ones, its built-in ones, and MCP services'. */
export async function getPartnerToolOptions(client: DtClient): Promise<{ tools: DtPartnerTool[]; builtin: DtPartnerTool[]; mcp: DtPartnerTool[] }> {
  const raw = await client.get<unknown>('/api/partners/tool-options');
  const row = isTree(raw) ? raw : {};
  const tools = (value: unknown) =>
    list(value)
      .filter(isTree)
      .map((tool) => {
        const english = isTree(tool.description_i18n) ? text(tool.description_i18n.en) : '';
        return { name: text(tool.name), description: english || text(tool.description), ...(text(tool.server) ? { server: text(tool.server) } : {}) };
      })
      .filter((tool) => tool.name);
  return { tools: tools(row.tools), builtin: tools(row.builtin_tools), mcp: tools(row.mcp_tools) };
}

export interface DtPartnerWorkspace {
  id: string;
  name: string;
}

/** The workspaces of its owner it can be bound to (ready, not archived, not DeepTutor's own). */
export async function listPartnerWorkspaces(client: DtClient, id: string): Promise<DtPartnerWorkspace[]> {
  const raw = await client.get<unknown>(`${partnerPath(id)}/workspaces`);
  return list(isTree(raw) ? raw.workspaces : [])
    .filter(isTree)
    .filter((row) => row.kind !== 'system' && row.archived !== true && (row.status === undefined || row.status === 'ready'))
    .map((row) => ({ id: text(row.workspace_id), name: text(row.display_name) || text(row.workspace_id) }))
    .filter((workspace) => workspace.id);
}

export interface DtPartnerAssets {
  knowledgeBases: { name: string; documents: number }[];
  skills: string[];
  notebooks: { id: string; name: string; records: number }[];
}

function assetsOf(raw: unknown): DtPartnerAssets {
  const row = isTree(raw) ? raw : {};
  return {
    knowledgeBases: list(row.knowledge_bases)
      .filter(isTree)
      .map((kb) => ({ name: text(kb.name), documents: typeof kb.documents === 'number' ? kb.documents : 0 }))
      .filter((kb) => kb.name),
    skills: list(row.skills)
      .map((skill) => (isTree(skill) ? text(skill.name) : text(skill)))
      .filter(Boolean),
    notebooks: list(row.notebooks)
      .filter(isTree)
      .map((notebook) => ({ id: text(notebook.id), name: text(notebook.name) || text(notebook.id), records: typeof notebook.record_count === 'number' ? notebook.record_count : 0 }))
      .filter((notebook) => notebook.id),
  };
}

/** What's in its private library: copies of knowledge bases, skills and notebooks. */
export async function getPartnerAssets(client: DtClient, id: string): Promise<DtPartnerAssets> {
  return assetsOf(await client.get<unknown>(`${partnerPath(id)}/assets`));
}

/**
 * Copies knowledge bases (names), skills (names) and notebooks (ids) into its library. Each one
 * that can't be copied is reported, not fatal. 400 while it's bound to a workspace.
 */
export async function addPartnerAssets(client: DtClient, id: string, assets: { knowledgeBases?: string[]; skills?: string[]; notebooks?: string[] }): Promise<{ assets: DtPartnerAssets; errors: string[] }> {
  const raw = await client.post<unknown>(`${partnerPath(id)}/assets`, { knowledge_bases: assets.knowledgeBases ?? [], skills: assets.skills ?? [], notebooks: assets.notebooks ?? [] }, { timeoutMs: 120_000 });
  const row = isTree(raw) ? raw : {};
  const errors = list(row.errors)
    .filter(isTree)
    .map((error) => `${text(error.name) || text(error.type)}: ${text(error.error) || 'not copied'}`);
  return { assets: assetsOf(row.assets), errors };
}

export type DtPartnerAssetType = 'knowledge_base' | 'skill' | 'notebook';

/** Removes one from its library (a notebook by its id). */
export async function removePartnerAsset(client: DtClient, id: string, type: DtPartnerAssetType, name: string): Promise<DtPartnerAssets> {
  const raw = await client.delete<unknown>(`${partnerPath(id)}/assets/${type}/${encodeURIComponent(name)}`);
  return assetsOf(isTree(raw) ? raw.assets : {});
}

// ── Linking a chat-app account ───────────────────────────────────────────────

export interface DtLinkCode {
  code: string;
  /** What to send the partner in a direct message: `/link CODE`. */
  command: string;
  /** Milliseconds; codes last 15 minutes and work once. */
  expiresAt: number | null;
}

/**
 * A code that ties a chat-app account to your DeepTutor account: send `/link CODE` to the partner
 * in a direct message there. Its replies there then use your history, library and memory.
 */
export async function createLinkCode(client: DtClient, id: string): Promise<DtLinkCode> {
  const raw = await client.post<unknown>(`${partnerPath(id)}/links/code`);
  const row = isTree(raw) ? raw : {};
  const code = text(row.code);
  return { code, command: text(row.command) || `/link ${code}`, expiresAt: partnerTime(row.expires_at) };
}

export interface DtPartnerLink {
  /** `channel:sender`, to unlink with. */
  key: string;
  channel: string;
  senderId: string;
  linkedAt: number | null;
}

/** Your chat-app accounts linked through this partner. */
export async function listPartnerLinks(client: DtClient, id: string): Promise<DtPartnerLink[]> {
  const raw = await client.get<unknown>(`${partnerPath(id)}/links`);
  return list(isTree(raw) ? raw.links : [])
    .filter(isTree)
    .map((row) => ({ key: text(row.key), channel: text(row.channel), senderId: text(row.sender_id), linkedAt: partnerTime(row.linked_at) }))
    .filter((link) => link.key);
}

export async function removePartnerLink(client: DtClient, id: string, key: string): Promise<void> {
  await client.delete<unknown>(`${partnerPath(id)}/links/${encodeURIComponent(key)}`);
}

// ── More on conversations ────────────────────────────────────────────────────

/** Copies a conversation into a new one (`newKey`) and archives the original. 409 while it replies. */
export async function branchPartnerSession(client: DtClient, id: string, sourceKey: string, newKey: string): Promise<void> {
  await client.post<unknown>(`${partnerPath(id)}/sessions/branch`, { source_key: sourceKey, new_key: newKey });
}

export interface DtPartnerCommand {
  /** With its slash: `/help`. */
  command: string;
  description: string;
  /** What follows it, like `<session ID>`. */
  argHint: string;
}

/** The slash commands partners understand. */
export async function listPartnerCommands(client: DtClient): Promise<DtPartnerCommand[]> {
  const raw = await client.get<unknown>('/api/partners/commands/palette');
  return list(isTree(raw) ? raw.commands : [])
    .filter(isTree)
    .map((row) => ({ command: text(row.command), description: text(row.description), argHint: text(row.arg_hint) }))
    .filter((row) => row.command.startsWith('/'));
}

/** Commands the app carries out itself (as the web does), rather than sending them. */
export const CLIENT_PARTNER_COMMANDS = new Set(['/new', '/clear', '/branch', '/resume', '/delete', '/sessions', '/stop']);

/**
 * Commands the app doesn't offer: `/link` (you're signed in already), and for a partner shared
 * with you `/model` and `/tool`, which change its settings (DeepTutor doesn't check who asks for `/tool`).
 */
export function offeredPartnerCommands(commands: DtPartnerCommand[], canManage: boolean): DtPartnerCommand[] {
  return commands.filter((row) => row.command !== '/link' && (canManage || (row.command !== '/model' && row.command !== '/tool')));
}

/** A typed command: `/resume web-1` → `{command: '/resume', argument: 'web-1'}`; null for ordinary text. */
export function parseSlashCommand(input: string): { command: string; argument: string } | null {
  const match = /^(\/[a-z][a-z_-]*)(?:\s+([\s\S]*))?$/i.exec(input.trim());
  return match ? { command: (match[1] as string).toLowerCase(), argument: (match[2] ?? '').trim() } : null;
}

// ── The partner socket ───────────────────────────────────────────────────────

/** `/ws/partners/{id}` behind a DeepTutor web address. Signed in with the cookie header, never the address. */
export function partnerSocketUrl(baseUrl: string, id: string): string {
  return `${baseUrl.replace(/\/+$/, '').replace(/^http/i, 'ws')}/ws/partners/${encodeURIComponent(id)}`;
}

/** DeepTutor's close codes for this socket. */
export const PARTNER_SOCKET_CLOSE = { signedOut: 4001, unavailable: 4404 } as const;

export type DtPartnerFrame =
  | { type: 'ready' }
  | { type: 'accepted'; sessionKey: string }
  | { type: 'stream_event'; event: DtStreamEvent }
  /** The reply's final words. */
  | { type: 'content'; content: string }
  | { type: 'done' }
  | { type: 'stopped' }
  | { type: 'error'; content: string }
  | { type: 'turn_busy'; content: string }
  | { type: 'stale_session'; content: string; activeSessionKey: string }
  | { type: 'resuming' }
  | { type: 'user_echo'; content: string }
  | { type: 'attach_busy' }
  | { type: 'attach_idle' }
  | { type: 'proactive'; content: string };

/**
 * One frame from the partner socket, or null. Frames from a chat app's conversation (`external`)
 * are left out: this app shows the conversation you're in.
 */
export function parsePartnerFrame(raw: unknown): DtPartnerFrame | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isTree(value) || value.external === true) return null;
  switch (value.type) {
    case 'ready':
    case 'done':
    case 'stopped':
    case 'resuming':
    case 'attach_busy':
    case 'attach_idle':
      return { type: value.type };
    case 'accepted':
      return { type: 'accepted', sessionKey: text(value.session_key) };
    case 'stream_event': {
      const event = streamEventOf(value.event);
      return event ? { type: 'stream_event', event } : null;
    }
    case 'content':
    case 'error':
    case 'turn_busy':
    case 'user_echo':
    case 'proactive':
      return { type: value.type, content: text(value.content) };
    case 'stale_session':
      return { type: 'stale_session', content: text(value.content), activeSessionKey: text(value.active_session_key) };
    default:
      return null;
  }
}

/** A file sent with a message: a picture, or a document DeepTutor reads (its contents in base64). */
export interface DtPartnerAttachment {
  type: 'image' | 'file';
  filename: string;
  mimeType: string;
  base64: string;
}

/** A message to the partner, in the conversation `sessionKey`, with any files. */
export function partnerMessage(sessionKey: string, content: string, attachments: DtPartnerAttachment[] = []): string {
  return JSON.stringify({
    content,
    session_key: sessionKey,
    ...(attachments.length ? { attachments: attachments.map((file) => ({ type: file.type, filename: file.filename, mime_type: file.mimeType, base64: file.base64 })) } : {}),
  });
}

/** Follows the conversation's reply in progress, if there is one (`include_activity: false`: not other apps'). */
export function partnerAttach(sessionKey: string): string {
  return JSON.stringify({ action: 'attach', session_key: sessionKey, include_activity: false });
}

export function partnerStop(sessionKey: string): string {
  return JSON.stringify({ action: 'stop', session_key: sessionKey });
}
