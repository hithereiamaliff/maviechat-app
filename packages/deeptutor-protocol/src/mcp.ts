import { DtHttpError, type DtClient } from './http';

/*
 * MCP Services (DeepTutor 1.7.1): remote MCP servers of your own (up to 8, by URL or from
 * DeepTutor's built-in store) whose tools a chat can use, and the ones the deployment provides.
 * Saving, installing, testing, and even reading the list make DeepTutor connect to the servers.
 * Credentials (header values, the store's fields) are kept apart on the server: the settings
 * hold `${secret:…}` references, which go back unchanged; a value is never shown again.
 * Saving replaces a server's whole settings, so fields the app doesn't edit are sent back as
 * they came. OAuth servers are connected on DeepTutor's own page (its callback needs the
 * DeepTutor sign-in).
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const base = '/api/space/mcp';

export type DtMcpStatus = 'connecting' | 'connected' | 'error' | 'needs_auth' | 'disabled';

export interface DtMcpTool {
  name: string;
  description: string;
}

export interface DtMcpServer {
  name: string;
  /** The settings as DeepTutor keeps them, sent back whole when saving. */
  config: Tree;
  url: string;
  /** `sse` or `streamableHttp` (or '' for "work it out from the URL"). */
  transport: string;
  enabled: boolean;
  oauth: boolean;
  /** Signed in with the server's provider (OAuth servers), or null. */
  authorized: boolean | null;
  status: DtMcpStatus;
  error: string;
  tools: DtMcpTool[];
  /** Credentials it has stored, by field (`header.Authorization`…); never their values. */
  credentials: string[];
  /** Installed from the store as this entry, or ''. */
  catalogEntry: string;
}

export interface DtMcpState {
  servers: DtMcpServer[];
  /** Kept but never connected (an address or kind DeepTutor no longer allows), with why. */
  rejected: { name: string; reason: string }[];
  /** The deployment's own servers (whether you may use them is your admin's grant). */
  deployment: { name: string; status: DtMcpStatus; tools: number }[];
  maxServers: number;
}

const toolsOf = (value: unknown): DtMcpTool[] =>
  list(value).flatMap((raw) => {
    const row = record(raw);
    return text(row.name) ? [{ name: text(row.name), description: text(row.description) }] : [];
  });

const statusOf = (value: unknown): DtMcpStatus => (value === 'connected' || value === 'error' || value === 'needs_auth' || value === 'disabled' ? value : 'connecting');

function stateOf(raw: unknown): DtMcpState {
  const body = record(raw);
  const rows = new Map(
    list(body.status).map((item) => {
      const row = record(item);
      return [text(row.name), row] as const;
    }),
  );
  const secrets = record(body.configured_secrets);
  const oauth = record(body.oauth);
  const servers = Object.entries(record(body.servers)).map(([name, value]): DtMcpServer => {
    const config = record(value);
    const row = rows.get(name);
    const enabled = config.enabled !== false;
    return {
      name,
      config,
      url: text(config.url),
      transport: text(config.type) || text(row?.transport),
      enabled,
      oauth: config.auth === 'oauth',
      authorized: name in oauth ? record(oauth[name]).authorized === true : null,
      // Off is off; else the connection's state, or still connecting when it has none yet.
      status: !enabled ? 'disabled' : row ? statusOf(row.status) : 'connecting',
      error: text(row?.error),
      tools: toolsOf(row?.tools),
      credentials: list(secrets[name]).map(text).filter(Boolean),
      catalogEntry: text(config.catalog_entry),
    };
  });
  const deployment = record(body.deployment);
  const deploymentRows = new Map(
    list(deployment.status).map((item) => {
      const row = record(item);
      return [text(row.name), row] as const;
    }),
  );
  return {
    servers: servers.sort((a, b) => a.name.localeCompare(b.name)),
    rejected: list(body.rejected).flatMap((raw) => {
      const row = record(raw);
      return text(row.name) ? [{ name: text(row.name), reason: text(row.reason) }] : [];
    }),
    deployment: list(deployment.servers)
      .map(text)
      .filter(Boolean)
      .map((name) => ({ name, status: statusOf(deploymentRows.get(name)?.status), tools: list(deploymentRows.get(name)?.tools).length })),
    maxServers: typeof record(body.limits).max_servers === 'number' ? (record(body.limits).max_servers as number) : 8,
  };
}

/** Your servers and their state (reading it connects them). */
export async function getMcpState(client: DtClient): Promise<DtMcpState> {
  return stateOf(await client.get<unknown>(`${base}/servers`, { timeoutMs: 45_000 }));
}

/** Saves a server whole; `secrets` holds new credential values by field. */
export async function saveMcpServer(client: DtClient, name: string, config: Tree, secrets: Record<string, string> = {}): Promise<DtMcpState> {
  return stateOf((await client.send<unknown>('PUT', `${base}/servers/${encodeURIComponent(name)}`, { body: { config, secrets }, timeoutMs: 45_000 })).data);
}

export async function setMcpServerEnabled(client: DtClient, server: DtMcpServer, enabled: boolean): Promise<DtMcpState> {
  return saveMcpServer(client, server.name, { ...server.config, enabled });
}

/** Deletes a server with its credentials and sign-in. */
export async function deleteMcpServer(client: DtClient, name: string): Promise<DtMcpState> {
  return stateOf(await client.delete<unknown>(`${base}/servers/${encodeURIComponent(name)}`));
}

/** Connects once to see its tools; nothing is saved. */
export async function testMcpServer(client: DtClient, name: string, config: Tree): Promise<{ ok: boolean; tools: DtMcpTool[]; error: string }> {
  const body = record(await client.post<unknown>(`${base}/servers/${encodeURIComponent(name || '_draft')}/test`, { config, secrets: {} }, { timeoutMs: 45_000 }));
  return { ok: body.ok === true, tools: toolsOf(body.tools), error: text(body.error) };
}

/** Workspaces whose settings give their chats this server. */
export async function mcpUsage(client: DtClient, name: string): Promise<string[]> {
  const body = record(await client.get<unknown>('/api/settings/workspace/resource-usage', { query: { kind: 'mcp', resource_id: `account:${name}` } }));
  return list(body.workspaces).map((row) => text(record(row).display_name)).filter(Boolean);
}

/** Names DeepTutor accepts: letters, digits, `-` and `_`, starting with a letter or digit, 64 at most, not `mcp_…` or `cli_…`. */
export function mcpNameProblem(name: string, taken: string[] = []): string | null {
  if (!name) return 'Give it a name.';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) return 'Letters, digits, dashes and underscores, starting with a letter or digit.';
  if (/^(mcp|cli)_/i.test(name)) return 'It can’t start with mcp_ or cli_.';
  if (taken.includes(name)) return 'You have a server by that name.';
  return null;
}

/** A stored credential, shown as such and sent back unchanged. */
export const isSecretRef = (value: string): boolean => value.startsWith('${secret:');

/** What a server form holds. */
export interface DtMcpDraft {
  url: string;
  /** '' to let DeepTutor work it out from the URL. */
  transport: '' | 'sse' | 'streamableHttp';
  headers: { key: string; value: string }[];
  timeout: number;
  /** One per line; none means all. */
  enabledTools: string[];
}

export function mcpDraftOf(server: DtMcpServer | null): DtMcpDraft {
  const config = server?.config ?? {};
  const type = text(config.type);
  return {
    url: text(config.url),
    transport: type === 'sse' || type === 'streamableHttp' ? type : '',
    headers: Object.entries(record(config.headers)).map(([key, value]) => ({ key, value: text(value) })),
    timeout: typeof config.tool_timeout === 'number' ? config.tool_timeout : 30,
    enabledTools: list(config.enabled_tools)
      .map(text)
      .filter((name) => name && name !== '*'),
  };
}

/** The settings to save: the form's fields over what the server had (kept as they came). */
export function mcpConfigOf(draft: DtMcpDraft, previous: Tree = {}): Tree {
  const headers: Record<string, string> = {};
  for (const { key, value } of draft.headers) if (key.trim()) headers[key.trim()] = value;
  return {
    ...previous,
    type: draft.transport || null,
    url: draft.url.trim(),
    headers,
    tool_timeout: Math.min(600, Math.max(1, Math.round(draft.timeout) || 30)),
    enabled_tools: draft.enabledTools.length ? draft.enabledTools : ['*'],
    enabled: previous.enabled !== false,
  };
}

const REFUSALS: Record<string, string> = {
  'mcp.invalid_name': 'That name isn’t allowed: letters, digits, dashes and underscores.',
  'mcp.name_reserved': 'That name is taken by DeepTutor itself.',
  'mcp.stdio_not_allowed': 'Only servers on the internet (by URL) can be added here; programs on the server are your admin’s.',
  'mcp.no_transport': 'Give the server’s URL.',
  'mcp.private_origin_not_approved': 'That address is on a private network, which your admin hasn’t approved for this server.',
  'mcp.too_many_servers': 'You have as many servers as DeepTutor allows: delete one first.',
  'mcp.entry_admin_only': 'Only your admin can install this one (it runs on the server).',
  'mcp.missing_credential': 'Fill in what it needs first.',
  'mcp.not_oauth': 'This server doesn’t sign in with its provider.',
  'mcp.oauth_start_failed': 'The server’s sign-in couldn’t start.',
};

/** What a refusal means, in the app's words (a blocked address keeps DeepTutor's own detail: the fixes differ). */
export function mcpRefusal(error: unknown): string | null {
  if (!(error instanceof DtHttpError)) return null;
  if (error.code === 'mcp.blocked_url') return error.detail ? `That address can’t be used: ${error.detail}` : 'That address can’t be used.';
  return (error.code && REFUSALS[error.code]) || null;
}

// ── The store ────────────────────────────────────────────────────────────────

export interface DtMcpEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  /** `curated` or `registry`. */
  tier: string;
  verified: boolean;
  homepage: string;
  docs: string;
  requires: string;
  installed: boolean;
  fields: { key: string; label: string; secret: boolean; required: boolean; placeholder: string }[];
}

/** Text in the phone's language, else its base language, else English, else any. */
export function pickText(value: unknown, language = 'en'): string {
  if (typeof value === 'string') return value;
  const texts = record(value);
  const short = language.split('-')[0] ?? language;
  return text(texts[language]) || text(texts[short]) || text(texts.en) || text(Object.values(texts)[0]);
}

export const MCP_CATEGORIES = ['search', 'docs', 'code', 'data', 'browser', 'science', 'maps', 'business', 'ai', 'utility'] as const;

/** One page of the store (self-service entries only). */
export async function getMcpCatalog(client: DtClient, query: { q?: string; category?: string; cursor?: string; limit?: number; language?: string } = {}): Promise<{ entries: DtMcpEntry[]; next: string; total: number; categories: Record<string, number> }> {
  const params: Record<string, string | number> = { limit: query.limit ?? 30 };
  if (query.q) params.q = query.q;
  if (query.category) params.category = query.category;
  if (query.cursor) params.cursor = query.cursor;
  const body = record(await client.get<unknown>(`${base}/catalog`, { query: params }));
  const language = query.language ?? 'en';
  const entries = list(body.entries).flatMap((raw): DtMcpEntry[] => {
    const row = record(raw);
    const id = text(row.id);
    if (!id) return [];
    return [
      {
        id,
        name: text(row.display_name) || id,
        description: pickText(row.description_i18n ?? row.description, language),
        category: text(row.category),
        tier: text(row.tier),
        verified: row.trust !== 'unverified',
        homepage: text(row.homepage),
        docs: text(row.docs_url),
        requires: pickText(row.requires_i18n ?? row.requires, language),
        installed: row.installed === true,
        fields: list(row.fields).flatMap((item) => {
          const field = record(item);
          return text(field.key) ? [{ key: text(field.key), label: pickText(field.label_i18n ?? field.label, language) || text(field.key), secret: field.secret === true, required: field.required === true, placeholder: text(field.placeholder) }] : [];
        }),
      },
    ];
  });
  const categories: Record<string, number> = {};
  for (const [key, value] of Object.entries(record(body.categories))) if (typeof value === 'number') categories[key] = value;
  return { entries, next: text(body.next_cursor), total: typeof body.total === 'number' ? body.total : entries.length, categories };
}

/** Installs a store entry under its own name (another name would mislay its credentials in 1.7.1). */
export async function installMcpEntry(client: DtClient, id: string, values: Record<string, string>): Promise<DtMcpState> {
  return stateOf(await client.post<unknown>(`${base}/catalog/${encodeURIComponent(id)}/install`, { name: id, secrets: values }, { timeoutMs: 45_000 }));
}
