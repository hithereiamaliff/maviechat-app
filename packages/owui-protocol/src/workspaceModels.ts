import type { OwuiClient } from './http';

/*
 * Workspace models (Open WebUI 0.11.3): model presets on top of a base model: a name, picture,
 * description, system prompt, parameters and what they bring (knowledge, tools, skills…),
 * shared with others or kept private. The list and an item come with `write_access`; only
 * writers may change one. Saving replaces `meta` and `params` whole, so an edit starts from the
 * full model. Leaving `access_grants` out of an update keeps the sharing as it is (sending what
 * was read could quietly drop grants this account isn't allowed to set), and an update without
 * `is_active` switches a disabled model back on, so it's always sent.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
/** Seconds or milliseconds, as milliseconds. */
const ms = (value: unknown): number => (typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : 0);
const base = '/api/v1/models';

export interface AccessGrant {
  principal_type: 'user' | 'group' | 'anyone';
  principal_id: string;
  permission: 'read' | 'write';
}

export interface WorkspaceModel {
  id: string;
  name: string;
  baseModelId: string | null;
  /** As Open WebUI keeps it (description, tags, picture, capabilities, knowledge…), kept whole. */
  meta: Tree;
  params: Tree;
  accessGrants: AccessGrant[];
  isActive: boolean;
  /** Kept out of everyone's model picker (it still works). */
  hidden: boolean;
  description: string;
  tags: string[];
  ownerId: string;
  ownerName: string;
  writeAccess: boolean;
  updatedAt: number;
}

export function grantsOf(value: unknown): AccessGrant[] {
  return list(value).flatMap((raw): AccessGrant[] => {
    const grant = record(raw);
    const type = grant.principal_type;
    const permission = grant.permission;
    if ((type !== 'user' && type !== 'group' && type !== 'anyone') || (permission !== 'read' && permission !== 'write')) return [];
    return [{ principal_type: type, principal_id: text(grant.principal_id), permission }];
  });
}

export const tagNames = (value: unknown): string[] => list(value).map((tag) => (typeof tag === 'string' ? tag : text(record(tag).name))).filter(Boolean);

function modelOf(raw: unknown): WorkspaceModel | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const meta = record(row.meta);
  const user = record(row.user);
  return {
    id,
    name: text(row.name) || id,
    baseModelId: text(row.base_model_id) || null,
    meta,
    params: record(row.params),
    accessGrants: grantsOf(row.access_grants),
    isActive: row.is_active !== false,
    hidden: meta.hidden === true,
    description: text(meta.description),
    tags: tagNames(meta.tags),
    ownerId: text(row.user_id),
    ownerName: text(user.name) || text(user.email),
    writeAccess: row.write_access === true,
    updatedAt: ms(row.updated_at),
  };
}

export type WorkspaceView = '' | 'created' | 'shared';

export interface WorkspaceListQuery {
  query?: string;
  /** '' all, `created` yours, `shared` others'. */
  view?: WorkspaceView;
  tag?: string;
  orderBy?: 'name' | 'updated_at' | 'created_at';
  direction?: 'asc' | 'desc';
  /** From 1, 30 a page. */
  page?: number;
}

/** Query parameters for a workspace list; `order_by` always goes, as some lists drop their order once filtered. */
export function listParams(query: WorkspaceListQuery): Record<string, string | number> {
  const params: Record<string, string | number> = { order_by: query.orderBy ?? 'updated_at', direction: query.direction ?? 'desc', page: query.page ?? 1 };
  if (query.query?.trim()) params.query = query.query.trim();
  if (query.view) params.view_option = query.view;
  if (query.tag) params.tag = query.tag;
  return params;
}

/** One page of the models you can read (30 a page). */
export async function listWorkspaceModels(client: OwuiClient, query: WorkspaceListQuery = {}): Promise<{ items: WorkspaceModel[]; total: number }> {
  const body = record(await client.get<unknown>(`${base}/list`, { query: listParams(query) }));
  return { items: list(body.items).flatMap((row) => modelOf(row) ?? []), total: typeof body.total === 'number' ? body.total : 0 };
}

export async function workspaceModelTags(client: OwuiClient): Promise<string[]> {
  return list(await client.get<unknown>(`${base}/tags`)).map(text).filter(Boolean);
}

/** The whole model (its parameters only for writers). */
export async function getWorkspaceModel(client: OwuiClient, id: string): Promise<WorkspaceModel> {
  const model = modelOf(await client.get<unknown>(`${base}/model`, { query: { id } }));
  if (!model) throw new Error('Open WebUI did not describe the model');
  return model;
}

/** What's saved: the fields Open WebUI's model form takes. */
export interface ModelForm {
  id: string;
  baseModelId: string;
  name: string;
  meta: Tree;
  params: Tree;
  isActive: boolean;
  /** Only when sharing changed; left out, the sharing stays as it is. */
  accessGrants?: AccessGrant[];
}

const isEmpty = (value: unknown): boolean => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0) || (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);

/** Drops empty values, as Open WebUI's own editor does before saving (it keeps `false` and `0`). */
export function pruneEmpty(tree: Tree): Tree {
  return Object.fromEntries(Object.entries(tree).filter(([, value]) => !isEmpty(value)));
}

export function modelFormOf(model: WorkspaceModel): ModelForm {
  return { id: model.id, baseModelId: model.baseModelId ?? '', name: model.name, meta: { ...model.meta }, params: { ...model.params }, isActive: model.isActive };
}

/** What a save sends for the model (the editor's JSON preview shows it). */
export function modelFormBody(form: ModelForm): Tree {
  const body: Tree = { id: form.id, base_model_id: form.baseModelId || null, name: form.name.trim(), meta: pruneEmpty(form.meta), params: pruneEmpty(form.params), is_active: form.isActive };
  if (form.accessGrants !== undefined) body.access_grants = form.accessGrants;
  return body;
}

export async function createWorkspaceModel(client: OwuiClient, form: ModelForm): Promise<WorkspaceModel> {
  const model = modelOf(await client.post<unknown>(`${base}/create`, modelFormBody({ ...form, accessGrants: form.accessGrants ?? [] })));
  if (!model) throw new Error('Open WebUI did not describe the new model');
  return model;
}

export async function updateWorkspaceModel(client: OwuiClient, form: ModelForm): Promise<WorkspaceModel> {
  const model = modelOf(await client.post<unknown>(`${base}/model/update`, modelFormBody(form)));
  if (!model) throw new Error('Open WebUI did not describe the model');
  return model;
}

/** Switches a model on or off for everyone (an off model leaves every picker and can't be used). */
export async function toggleWorkspaceModel(client: OwuiClient, id: string): Promise<WorkspaceModel> {
  const model = modelOf(await client.post<unknown>(`${base}/model/toggle`, undefined, { query: { id } }));
  if (!model) throw new Error('Open WebUI did not describe the model');
  return model;
}

/** Hides a model from everyone's picker, or shows it again (it keeps working). From the whole model, sharing untouched. */
export async function setWorkspaceModelHidden(client: OwuiClient, id: string, hidden: boolean): Promise<WorkspaceModel> {
  const model = await getWorkspaceModel(client, id);
  return updateWorkspaceModel(client, { ...modelFormOf(model), meta: { ...model.meta, hidden } });
}

/** Switches a model on or off for everyone, read first so it only flips when it isn't already so. */
export async function setWorkspaceModelActive(client: OwuiClient, id: string, on: boolean): Promise<void> {
  const model = await getWorkspaceModel(client, id);
  if (model.isActive !== on) await toggleWorkspaceModel(client, id);
}

/** Every model the list's search, view and tag find, page after page, as the web's "… All" actions gather them. */
export async function listAllWorkspaceModels(client: OwuiClient, query: Omit<WorkspaceListQuery, 'page'> = {}): Promise<WorkspaceModel[]> {
  const all: WorkspaceModel[] = [];
  for (let page = 1; page <= 200; page += 1) {
    const batch = await listWorkspaceModels(client, { ...query, page });
    all.push(...batch.items);
    if (!batch.items.length || all.length >= batch.total) break;
  }
  return all;
}

export async function deleteWorkspaceModel(client: OwuiClient, id: string): Promise<void> {
  await client.post<unknown>(`${base}/model/delete`, { id });
}

/** Every model you can change, whole, as Open WebUI exports them (with the export permission). */
export async function exportWorkspaceModels(client: OwuiClient): Promise<unknown[]> {
  return list(await client.get<unknown>(`${base}/export`));
}

/** A model id from a name, as the web makes one while you type: spaces to `-`, letters, digits and `-` kept, lower case. */
export const modelIdFromName = (name: string): string =>
  name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '')
    .toLowerCase();

/** A copy to save as a new model: `<id>-clone`, "<name> (Clone)", private. */
export function cloneForm(model: WorkspaceModel): ModelForm {
  return { ...modelFormOf(model), id: `${model.id}-clone`, name: `${model.name} (Clone)`, accessGrants: [] };
}

/** Variables a system prompt asks the chat for (`{{chat.variables.key}}`) and the ones each user sets (`{{user.variables.key}}`). */
export function promptVariables(system: string): { chat: string[]; user: string[] } {
  const chat = new Set<string>();
  const user = new Set<string>();
  for (const match of system.matchAll(/\{\{\s*(chat|user)\.variables\.([a-z0-9_]+)/gi)) (match[1]?.toLowerCase() === 'chat' ? chat : user).add(match[2] ?? '');
  return { chat: [...chat].filter(Boolean), user: [...user].filter(Boolean) };
}

/** One model from an import file, made or changed the way the web's Workspace → Import JSON does it. */
export interface ModelImport {
  id: string;
  name: string;
  /**
   * An older export's `{id, info}` for a model you have already: that model is changed to it (its
   * sharing kept). Anything else is made as a new model, private until you share it.
   */
  update: boolean;
  form: ModelForm;
}

/**
 * Models from an exported JSON file, one or a list: the web's and the app's exports (rows with an
 * id and a name), and older exports whose rows carry the model in `info` (which change a model of
 * the same id that you have, in `existing`, and make the rest). New ones are made private, as the
 * app's other imports are, where the web would keep the file's sharing. Entries without an id or
 * a name are left out.
 */
export function modelsFromImport(json: unknown, existing: ReadonlySet<string>): { models: ModelImport[]; skipped: number } {
  let skipped = 0;
  const models = (Array.isArray(json) ? json : [json]).flatMap((raw): ModelImport[] => {
    const item = record(raw);
    const wrapped = typeof item.info === 'object' && item.info !== null && !Array.isArray(item.info);
    const row = wrapped ? record(item.info) : item;
    const id = (text(row.id) || text(item.id)).trim();
    const name = (text(row.name) || text(item.name)).trim();
    if (!id || !name) {
      skipped += 1;
      return [];
    }
    const update = wrapped && existing.has(id);
    const form: ModelForm = { id, baseModelId: text(row.base_model_id), name, meta: record(row.meta), params: record(row.params), isActive: row.is_active !== false };
    return [{ id, name, update, form: update ? form : { ...form, accessGrants: [] } }];
  });
  return { models, skipped };
}

/** Makes or changes one imported model. */
export async function importWorkspaceModel(client: OwuiClient, item: ModelImport): Promise<WorkspaceModel> {
  return item.update ? updateWorkspaceModel(client, item.form) : createWorkspaceModel(client, item.form);
}
