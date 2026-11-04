import type { OwuiClient } from './http';
import type { ValvesSpec } from './valves';
import { grantsOf, type AccessGrant, type WorkspaceView } from './workspaceModels';

/*
 * Workspace tools (Open WebUI 0.11.3): Python a model can call, with settings ("valves") shared
 * by everyone who uses the tool. Saving a tool runs its code on the server (and may install
 * Python packages there), so the app reads tools, their valves and sharing, and leaves writing
 * code to the web. The list comes whole; it's searched and sorted here, as the web does.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const ms = (value: unknown): number => (typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : 0);
const base = '/api/v1/tools';
const idPath = (id: string) => `${base}/id/${encodeURIComponent(id)}`;

export interface WorkspaceTool {
  id: string;
  name: string;
  description: string;
  /** The header of its code: title, author, version, requirements, links… */
  manifest: Tree;
  version: string;
  author: string;
  /** Where to support its author, when it says. */
  fundingUrl: string;
  /** Python packages it installs on the server when saved. */
  requirements: string;
  hasUserValves: boolean;
  /** Its Python, for those who may change it (others don't get it). */
  content: string | null;
  ownerId: string;
  ownerName: string;
  accessGrants: AccessGrant[];
  writeAccess: boolean;
  updatedAt: number;
}

function toolOf(raw: unknown): WorkspaceTool | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const meta = record(row.meta);
  const manifest = record(meta.manifest);
  const user = record(row.user);
  return {
    id,
    name: text(row.name) || id,
    description: text(meta.description),
    manifest,
    version: text(manifest.version),
    author: text(manifest.author),
    fundingUrl: text(manifest.funding_url),
    requirements: text(manifest.requirements),
    hasUserValves: meta.has_user_valves === true,
    content: typeof row.content === 'string' ? row.content : null,
    ownerId: text(row.user_id),
    ownerName: text(user.name) || text(user.email),
    accessGrants: grantsOf(row.access_grants),
    writeAccess: row.write_access === true,
    updatedAt: ms(row.updated_at),
  };
}

function toolFrom(raw: unknown): WorkspaceTool {
  const tool = toolOf(raw);
  if (!tool) throw new Error('Open WebUI did not describe the tool');
  return tool;
}

/** Every tool you can read (none when the server has tools switched off). */
export async function listWorkspaceTools(client: OwuiClient): Promise<WorkspaceTool[]> {
  return list(await client.get<unknown>(`${base}/list`)).flatMap((row) => toolOf(row) ?? []);
}

/** Searched (name, id, whose), filtered by whose, and ordered, as the web does with the whole list. */
export function filterTools(tools: WorkspaceTool[], { query = '', view = '', me = '', byName = false }: { query?: string; view?: WorkspaceView; me?: string; byName?: boolean }): WorkspaceTool[] {
  const wanted = query.trim().toLowerCase();
  return tools
    .filter((tool) => (view === 'created' ? tool.ownerId === me : view === 'shared' ? tool.ownerId !== me : true))
    .filter((tool) => !wanted || [tool.name, tool.id, tool.ownerName].some((value) => value.toLowerCase().includes(wanted)))
    .sort((a, b) => (byName ? a.name.localeCompare(b.name) : b.updatedAt - a.updatedAt));
}

/** One tool; its code only when you may change it. */
export async function getWorkspaceTool(client: OwuiClient, id: string): Promise<WorkspaceTool> {
  return toolFrom(await client.get<unknown>(idPath(id)));
}

/** Deletes it: models that used it keep a stale reference, as on the web. */
export async function deleteWorkspaceTool(client: OwuiClient, id: string): Promise<void> {
  await client.delete<unknown>(`${idPath(id)}/delete`);
}

/** Every tool you can read, with its code (needs `workspace.tools_export`). */
export async function exportWorkspaceTools(client: OwuiClient): Promise<unknown[]> {
  return list(await client.get<unknown>(`${base}/export`));
}

/**
 * A new tool from its code. **The server runs the code to save it** (and installs its
 * requirements): the app doesn't offer this; probes use it on the scratch instance only.
 */
export async function createWorkspaceTool(client: OwuiClient, input: { id: string; name: string; description: string; content: string; accessGrants?: AccessGrant[] }): Promise<WorkspaceTool> {
  return toolFrom(await client.post<unknown>(`${base}/create`, { id: input.id, name: input.name, meta: { description: input.description }, content: input.content, access_grants: input.accessGrants ?? [] }));
}

/** The settings form (a JSON schema) for the values everyone shares, or null when it has none. Reading it loads the tool on the server. */
export function getToolValvesSpec(client: OwuiClient, id: string): Promise<ValvesSpec | null> {
  return client.get<ValvesSpec | null>(`${idPath(id)}/valves/spec`);
}

/** The values set for everyone (one left out uses the tool's default). */
export async function getToolValves(client: OwuiClient, id: string): Promise<Record<string, unknown>> {
  return record(await client.get<unknown>(`${idPath(id)}/valves`));
}

/** Saves the values everyone shares: nulls go back to the defaults; the tool checks the rest. */
export async function updateToolValves(client: OwuiClient, id: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
  return record(await client.post<unknown>(`${idPath(id)}/valves/update`, values));
}
