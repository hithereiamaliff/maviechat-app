import type { DtClient } from './http';

/*
 * CLI apps (DeepTutor 1.7.1): command-line programs an admin installs on the server, which a chat
 * can run as tools. You can use the ones an admin granted you, and switch each on or off for
 * yourself. Installing runs the program's installer on the server, so it's left to admins.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export interface DtCliApp {
  id: string;
  name: string;
  description: string;
  category: string;
  /** The tool a chat calls (`cli_<id>`). */
  toolName: string;
  version: string;
  /** The pinned version, or '' when it follows the latest. */
  pin: string;
  firstParty: boolean;
  granted: boolean;
  enabled: boolean;
  /** Still in DeepTutor's catalog (one dropped from it isn't offered to chats). */
  inCatalog: boolean;
  installedAt: string;
}

export interface DtCliApps {
  apps: DtCliApp[];
  /** An admin: every app is theirs to use. */
  unrestricted: boolean;
  /** This account may not run programs at all, so no app works for it. */
  execDenied: boolean;
}

function appOf(raw: unknown): DtCliApp | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  return {
    id,
    name: text(row.display_name) || id,
    description: text(row.description),
    category: text(row.category),
    toolName: text(row.tool_name) || `cli_${id}`,
    version: text(row.version),
    pin: text(row.pin),
    firstParty: row.trust !== 'third-party',
    granted: row.granted === true,
    enabled: row.enabled === true,
    inCatalog: row.in_catalog !== false,
    installedAt: text(row.installed_at),
  };
}

function appsOf(raw: unknown): DtCliApps {
  const body = record(raw);
  const access = record(body.access);
  return { apps: list(body.apps).flatMap((row) => appOf(row) ?? []), unrestricted: access.unrestricted === true, execDenied: access.exec_denied === true };
}

export async function getCliApps(client: DtClient): Promise<DtCliApps> {
  return appsOf(await client.get<unknown>('/api/space/cli-apps/apps'));
}

/** Switches an app you were granted on or off for yourself. */
export async function setCliAppEnabled(client: DtClient, id: string, enabled: boolean): Promise<DtCliApps> {
  return appsOf((await client.send<unknown>('PUT', `/api/space/cli-apps/apps/${encodeURIComponent(id)}/enabled`, { body: { enabled } })).data);
}

/** The apps a chat of yours can use: granted, switched on, and runnable. */
export function usableCliApps(state: DtCliApps): DtCliApp[] {
  if (state.execDenied) return [];
  return state.apps.filter((app) => app.granted && app.enabled && app.inCatalog);
}

// ── The store ────────────────────────────────────────────────────────────────

export interface DtCliEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  firstParty: boolean;
  /** Its installer can run (some need what DeepTutor won't run), with why not. */
  installable: boolean;
  unsupportedReason: string;
  /** What it needs, and notes for whoever installs it. */
  requires: string;
  notes: string;
  /** Installed from a fixed, reviewed version. */
  pinned: boolean;
  installed: boolean;
  homepage: string;
  source: string;
}

/** One page of the CLI app store DeepTutor ships with (never fetched from the internet). */
export async function getCliCatalog(client: DtClient, query: { q?: string; category?: string; cursor?: string; limit?: number; installableOnly?: boolean } = {}): Promise<{ entries: DtCliEntry[]; next: string; total: number; categories: Record<string, number> }> {
  const params: Record<string, string | number | boolean> = { limit: query.limit ?? 24, installable_only: query.installableOnly ?? true };
  if (query.q) params.q = query.q;
  if (query.category) params.category = query.category;
  if (query.cursor) params.cursor = query.cursor;
  const body = record(await client.get<unknown>('/api/space/cli-apps/catalog', { query: params }));
  const entries = list(body.entries).flatMap((raw): DtCliEntry[] => {
    const row = record(raw);
    const id = text(row.id);
    if (!id) return [];
    const requires = row.requires;
    return [
      {
        id,
        name: text(row.display_name) || id,
        description: text(row.description),
        category: text(row.category),
        firstParty: row.trust !== 'third-party',
        installable: row.installable === true,
        unsupportedReason: text(row.unsupported_reason),
        requires: Array.isArray(requires) ? requires.map(text).filter(Boolean).join(', ') : text(requires),
        notes: text(row.install_notes),
        pinned: row.pinned === true,
        installed: row.installed === true,
        homepage: text(row.homepage),
        source: text(row.source_url),
      },
    ];
  });
  const categories: Record<string, number> = {};
  for (const [key, value] of Object.entries(record(body.categories))) if (typeof value === 'number') categories[key] = value;
  return { entries, next: text(body.next_cursor), total: typeof body.total === 'number' ? body.total : entries.length, categories };
}
