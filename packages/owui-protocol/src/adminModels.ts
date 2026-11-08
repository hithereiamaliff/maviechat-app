import { updateAccess } from './access';
import type { OwuiClient } from './http';
import { customParamsOf, PARAM_SPECS, type CustomParam } from './params';
import {
  BUILTIN_TOOLS,
  builtinToolsMeta,
  builtinToolsOf,
  capabilitiesOf,
  defaultFeaturesOf,
  DEFAULT_FEATURES,
  MODEL_CAPABILITIES,
  modelParamsToSave,
  suggestionsMeta,
  suggestionsOf,
  type SuggestedPrompt,
  type WorkspaceCapability,
} from './workspaceModelEditor';
import { grantsOf, setWorkspaceModelHidden, tagNames, type AccessGrant } from './workspaceModels';

/*
 * Admin → Models (Open WebUI 0.11.3): every model on the server, from the providers and the
 * workspace, with a saved row where an admin changed one (on/off, hidden, sharing). A provider
 * model without a row is on and has none until an admin switches it: then a row is made for it,
 * as the web does. The models settings (defaults, pinned, order, default capabilities and
 * parameters) are saved all five together, the ones not changed exactly as read.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export interface AdminModel {
  id: string;
  name: string;
  /** Where it comes from (`openai`, `ollama`, `arena`…), or a workspace model. */
  ownedBy: string;
  /** A workspace model built on another one. */
  preset: boolean;
  /** An admin has saved something about it (else it's on, unshared, unchanged). */
  hasRow: boolean;
  isActive: boolean;
  hidden: boolean;
  accessGrants: AccessGrant[];
  /** A connection offers it now (or it's a workspace model); else only its saved row is left. */
  available: boolean;
  tags: string[];
}

const items = (body: unknown): Tree[] => list(record(body).data).map(record);

/**
 * Every model, as the web's admin list builds it: the models in use, then the providers' own
 * list (asking each provider), each with its saved row laid over; then, as 0.12's list has them,
 * saved rows of models no connection offers now (unavailable), so they can be found and deleted.
 */
export async function listAdminModels(client: OwuiClient): Promise<AdminModel[]> {
  const [active, provider, rows] = await Promise.all([client.get<unknown>('/api/models'), client.get<unknown>('/api/models/base'), client.get<unknown>('/api/v1/models/base')]);
  const saved = new Map(list(rows).map((row) => [text(record(row).id), record(row)]));
  const seen = new Set<string>();
  const offered = [...items(active), ...items(provider)].flatMap((item): AdminModel[] => {
    const id = text(item.id);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const row = saved.get(id);
    const info = record(item.info);
    const preset = Boolean(text(info.base_model_id)) || item.preset === true;
    const meta = record(row?.meta ?? info.meta);
    return [
      {
        id,
        name: text(row?.name) || text(item.name) || id,
        ownedBy: text(item.owned_by),
        preset,
        hasRow: Boolean(row) || preset,
        isActive: row ? row.is_active !== false : info.is_active !== false,
        hidden: meta.hidden === true,
        accessGrants: grantsOf(row?.access_grants ?? info.access_grants),
        available: true,
        tags: tagNames(meta.tags),
      },
    ];
  });
  const away = [...saved.entries()].flatMap(([id, row]): AdminModel[] => {
    if (!id || seen.has(id)) return [];
    const meta = record(row.meta);
    return [{ id, name: text(row.name) || id, ownedBy: '', preset: Boolean(text(row.base_model_id)), hasRow: true, isActive: row.is_active !== false, hidden: meta.hidden === true, accessGrants: grantsOf(row.access_grants), available: false, tags: tagNames(meta.tags) }];
  });
  return [...offered, ...away];
}

/** Everyone signed in may use it (a grant to every user). */
export const isPublicModel = (model: { accessGrants: readonly AccessGrant[] }): boolean => model.accessGrants.some((grant) => grant.principal_type === 'user' && grant.principal_id === '*');

/** The web's views of the admin list (0.11's and 0.12's together). */
export type AdminModelView = 'all' | 'on' | 'off' | 'visible' | 'hidden' | 'public' | 'private' | 'default' | 'pinned' | 'available' | 'unavailable' | 'base' | 'workspace';

/** Whether a model is in a view; `default` and `pinned` are what new chats start with and what's pinned for everyone. */
export function inAdminView(model: AdminModel, view: AdminModelView, lists: { defaults: readonly string[]; pinned: readonly string[] }): boolean {
  switch (view) {
    case 'on':
      return model.isActive;
    case 'off':
      return !model.isActive;
    case 'visible':
      return !model.hidden;
    case 'hidden':
      return model.hidden;
    case 'public':
      return isPublicModel(model);
    case 'private':
      return !isPublicModel(model);
    case 'default':
      return lists.defaults.includes(model.id);
    case 'pinned':
      return lists.pinned.includes(model.id);
    case 'available':
      return model.available || model.preset;
    case 'unavailable':
      return !model.available && !model.preset;
    case 'base':
      return !model.preset;
    case 'workspace':
      return model.preset;
    default:
      return true;
  }
}

/** The tags the models carry, once each, by name (the web's tag filter). */
export const adminModelTags = (models: readonly AdminModel[]): string[] => [...new Set(models.flatMap((model) => model.tags))].sort((a, b) => a.localeCompare(b));

/**
 * Makes a model public (everyone signed in may use it) or not, keeping who else it's shared with:
 * its grants read fresh where it has a saved row; one without gets a row under its own name.
 */
export async function setAdminModelPublic(client: OwuiClient, model: AdminModel, on: boolean): Promise<AccessGrant[]> {
  const grants = model.hasRow ? grantsOf(record(await client.get<unknown>('/api/v1/models/model', { query: { id: model.id } })).access_grants) : [];
  const others = grants.filter((grant) => !(grant.principal_type === 'user' && grant.principal_id === '*'));
  return updateAccess(client, 'models', model.id, on ? [...others, { principal_type: 'user', principal_id: '*', permission: 'read' }] : others, model.name);
}

/**
 * What deleting a model's saved row does (0.12's Delete or Reset): a connection's model it offers
 * now goes back to no saved settings (Reset); a workspace model, or the row of a model no
 * connection offers, goes (Delete); a model with nothing saved has nothing to delete.
 */
export function deleteKindOf(model: AdminModel): 'reset' | 'delete' | null {
  if (!model.hasRow) return null;
  return !model.preset && model.available ? 'reset' : 'delete';
}

/** Deletes every saved model (admins): every workspace model, everyone's, and every saved setting of the connections' models. */
export async function deleteAllModels(client: OwuiClient): Promise<void> {
  const ok = await client.delete<unknown>('/api/v1/models/delete/all');
  if (ok !== true) throw new Error('the server didn’t delete them');
}

/** Switches a model on or off for everyone: reads it first, flips only if needed; a provider model without a row gets one. */
export async function setAdminModelActive(client: OwuiClient, model: AdminModel, on: boolean): Promise<void> {
  if (!model.hasRow) {
    await client.post<unknown>('/api/v1/models/create', { id: model.id, name: model.name, base_model_id: null, meta: {}, params: {}, access_grants: [], is_active: on });
    return;
  }
  const row = record(await client.get<unknown>('/api/v1/models/model', { query: { id: model.id } }));
  if ((row.is_active !== false) !== on) await client.post<unknown>('/api/v1/models/model/toggle', undefined, { query: { id: model.id } });
}

/** Hides a model from everyone's picker (or shows it): its saved row as read, with only `meta.hidden` changed. */
export async function setAdminModelHidden(client: OwuiClient, model: AdminModel, hidden: boolean): Promise<void> {
  if (!model.hasRow) {
    await client.post<unknown>('/api/v1/models/create', { id: model.id, name: model.name, base_model_id: null, meta: { hidden }, params: {}, access_grants: [], is_active: true });
    return;
  }
  await setWorkspaceModelHidden(client, model.id, hidden);
}

// --- The models settings: always all five, the ones not changed exactly as read. ---

export async function getModelsConfig(client: OwuiClient): Promise<Tree> {
  return record(await client.get<unknown>('/api/v1/configs/models'));
}

export async function saveModelsConfig(client: OwuiClient, config: Tree): Promise<Tree> {
  return record(
    await client.post<unknown>('/api/v1/configs/models', {
      DEFAULT_MODELS: config.DEFAULT_MODELS ?? null,
      DEFAULT_PINNED_MODELS: config.DEFAULT_PINNED_MODELS ?? null,
      MODEL_ORDER_LIST: config.MODEL_ORDER_LIST ?? null,
      DEFAULT_MODEL_METADATA: config.DEFAULT_MODEL_METADATA ?? null,
      DEFAULT_MODEL_PARAMS: config.DEFAULT_MODEL_PARAMS ?? null,
    }),
  );
}

/** A comma list (as stored) as ids. */
export const idsOf = (value: unknown): string[] =>
  text(value)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

/** The config with one model added to or taken off a comma list (`DEFAULT_MODELS`, `DEFAULT_PINNED_MODELS`), the rest as read. */
export function withListedModel(config: Tree, key: 'DEFAULT_MODELS' | 'DEFAULT_PINNED_MODELS', id: string, listed: boolean): Tree {
  const ids = idsOf(config[key]).filter((item) => item !== id);
  if (listed) ids.push(id);
  return { ...config, [key]: ids.length ? ids.join(',') : config[key] === null || config[key] === undefined ? null : '' };
}

// --- The order everyone's pickers show models in (`MODEL_ORDER_LIST`), the web's drag to reorder. ---

/**
 * The whole order: the saved ids as saved (once each; ones not listed now keep their places, for
 * when their connection is back), then listed models it doesn't name yet, by id, as the web's
 * page starts them.
 */
export function fullModelOrder(config: Tree, ids: readonly string[]): string[] {
  const saved = [...new Set(list(config.MODEL_ORDER_LIST).map(text).filter(Boolean))];
  const named = new Set(saved);
  return [...saved, ...[...new Set(ids)].filter((id) => !named.has(id)).sort((a, b) => a.localeCompare(b))];
}

/** Models in that order, as the web's admin list sorts them: by place, then by name. */
export function inModelOrder<T extends { id: string; name: string }>(models: readonly T[], order: readonly string[]): T[] {
  const place = new Map(order.map((id, index) => [id, index]));
  const at = (id: string) => place.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...models].sort((a, b) => at(a.id) - at(b.id) || a.name.localeCompare(b.name));
}

/**
 * The whole order with the listed models in a new sequence: each place a listed model held goes
 * to the next one of `listed`; ids not listed stay where they are.
 */
export function withListedOrder(order: readonly string[], listed: readonly string[]): string[] {
  const moving = new Set(listed);
  const queue = [...listed];
  const placed = order.map((id) => (moving.has(id) ? (queue.shift() ?? id) : id));
  return [...placed, ...queue];
}

/** The config with this order, the other four settings as read. */
export const withModelOrder = (config: Tree, order: readonly string[]): Tree => ({ ...config, MODEL_ORDER_LIST: [...order] });

/** A list with one item moved (Move Up, Move Down, Move to Top, Move to Bottom). */
export function movedInList<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item as T);
  return next;
}

// --- Defaults for every model: what it can do, what new chats start with and its built-in tools
// (`DEFAULT_MODEL_METADATA`), and parameters (`DEFAULT_MODEL_PARAMS`). The server lays each
// model's own settings over them (capabilities one by one, the rest where the model has none).

export interface ModelDefaults {
  capabilities: Record<WorkspaceCapability, boolean>;
  /** Features new chats start with on (web search, code interpreter, image generation). */
  featureIds: string[];
  builtinTools: Record<string, boolean>;
  /** Parameters by key; custom ones apart, in `custom`. */
  params: Tree;
  custom: CustomParam[];
}

/** The defaults as saved, shown the way the web's panel starts them (capabilities all on but usage where none are saved). */
export function modelDefaultsOf(config: Tree): ModelDefaults {
  const meta = record(config.DEFAULT_MODEL_METADATA);
  const saved = record(config.DEFAULT_MODEL_PARAMS);
  const { custom_params: _custom, ...params } = saved;
  const capabilities = capabilitiesOf(meta);
  return { capabilities, featureIds: defaultFeaturesOf(meta, capabilities), builtinTools: builtinToolsOf(meta), params, custom: customParamsOf(saved) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const empty = (value: unknown) => value === undefined || value === null || value === '';
const sameIds = (a: readonly string[], b: readonly string[]) => same([...a].sort(), [...b].sort());

/**
 * The config with the defaults you changed (from `before` to `after`, as the sheet had them) laid
 * over it as read now: capabilities, built-in tools and parameters one by one, the features new
 * chats start with and the custom parameters as a whole. Anything you didn't change stays as
 * read, and so do the metadata's other keys, the order and the lists.
 */
export function withModelDefaults(config: Tree, before: ModelDefaults, after: ModelDefaults): Tree {
  const now = modelDefaultsOf(config);
  const meta: Tree = { ...record(config.DEFAULT_MODEL_METADATA) };
  let metaChanged = false;
  const capabilities = { ...now.capabilities };
  for (const { key } of MODEL_CAPABILITIES) {
    if (before.capabilities[key] === after.capabilities[key]) continue;
    capabilities[key] = after.capabilities[key];
    metaChanged = true;
  }
  if (metaChanged) meta.capabilities = capabilities;
  if (!sameIds(before.featureIds, after.featureIds)) {
    const features = after.featureIds.filter((key) => capabilities[key as WorkspaceCapability]);
    if (features.length) meta.defaultFeatureIds = features;
    else delete meta.defaultFeatureIds;
    metaChanged = true;
  }
  const changedTools = BUILTIN_TOOLS.filter(({ key }) => (before.builtinTools[key] !== false) !== (after.builtinTools[key] !== false));
  if (changedTools.length) {
    const tools = builtinToolsMeta({ ...now.builtinTools, ...Object.fromEntries(changedTools.map(({ key }) => [key, after.builtinTools[key] !== false])) });
    if (Object.keys(tools).length) meta.builtinTools = tools;
    else delete meta.builtinTools;
    metaChanged = true;
  }

  const params: Tree = { ...now.params };
  let paramsChanged = false;
  for (const key of new Set([...Object.keys(before.params), ...Object.keys(after.params)])) {
    if (same(before.params[key], after.params[key])) continue;
    paramsChanged = true;
    if (empty(after.params[key])) delete params[key];
    else params[key] = after.params[key];
  }
  const customChanged = !same(before.custom, after.custom);
  return {
    ...config,
    ...(metaChanged ? { DEFAULT_MODEL_METADATA: meta } : {}),
    ...(paramsChanged || customChanged ? { DEFAULT_MODEL_PARAMS: modelParamsToSave(params, customChanged ? after.custom : now.custom) } : {}),
  };
}

/** One changed default, for the list a save shows first. */
export interface DefaultChange {
  label: string;
  from: string;
  to: string;
}

const onOff = (on: boolean) => (on ? 'on' : 'off');
const shown = (value: unknown) => (empty(value) ? 'Default' : typeof value === 'string' ? value : JSON.stringify(value));

/** What changed between two versions of the defaults, in the sheet's words. */
export function modelDefaultsChanges(before: ModelDefaults, after: ModelDefaults): DefaultChange[] {
  const changes: DefaultChange[] = [];
  for (const item of MODEL_CAPABILITIES) if (before.capabilities[item.key] !== after.capabilities[item.key]) changes.push({ label: item.label, from: onOff(before.capabilities[item.key]), to: onOff(after.capabilities[item.key]) });
  for (const item of DEFAULT_FEATURES) {
    const was = before.featureIds.includes(item.key);
    const is = after.featureIds.includes(item.key);
    if (was !== is) changes.push({ label: `${item.label} in new chats`, from: onOff(was), to: onOff(is) });
  }
  for (const tool of BUILTIN_TOOLS) {
    const was = before.builtinTools[tool.key] !== false;
    const is = after.builtinTools[tool.key] !== false;
    if (was !== is) changes.push({ label: `Built-in tool: ${tool.label}`, from: onOff(was), to: onOff(is) });
  }
  for (const key of new Set([...Object.keys(before.params), ...Object.keys(after.params)])) {
    if (same(before.params[key], after.params[key])) continue;
    changes.push({ label: PARAM_SPECS.find((spec) => spec.key === key)?.label ?? key, from: shown(before.params[key]), to: shown(after.params[key]) });
  }
  if (!same(before.custom, after.custom)) {
    const named = (custom: CustomParam[]) => custom.filter((item) => item.name.trim()).map((item) => `${item.name.trim()} = ${item.value}`).join(', ') || 'none';
    changes.push({ label: 'Custom parameters', from: named(before.custom), to: named(after.custom) });
  }
  return changes;
}

// --- Prompt suggestions for everyone: new chats offer them where the model has none of its own. ---

export interface DefaultSuggestions {
  /** The list; null (0.12 only) leaves Open WebUI's built-in ones. */
  prompts: SuggestedPrompt[] | null;
  /** 0.12's translations by language, sent back as read (a save without them wipes them); null on 0.11, which has none. */
  translations: Tree | null;
}

/** The server's suggestions from its config (`/api/config`, signed in). */
export function defaultSuggestionsOf(config: Tree): DefaultSuggestions {
  const translations = 'default_prompt_suggestions_i18n' in config ? record(config.default_prompt_suggestions_i18n) : null;
  const prompts = suggestionsOf({ suggestion_prompts: config.default_prompt_suggestions });
  return { prompts: prompts ?? (translations === null ? [] : null), translations };
}

/** Languages the suggestions have translations for (0.12). */
export const translatedLanguages = (value: DefaultSuggestions): string[] =>
  Object.entries(value.translations ?? {})
    .filter(([, entry]) => Array.isArray(record(entry).suggestion_prompts))
    .map(([language]) => language);

/**
 * Saves them (admins): the list as the web keeps it (ones without a prompt dropped); on 0.12 with
 * the translations as read. Returns the list the server keeps (null: the built-in ones).
 */
export async function saveDefaultSuggestions(client: OwuiClient, value: DefaultSuggestions): Promise<SuggestedPrompt[] | null> {
  const suggestions = suggestionsMeta(value.prompts);
  const body = value.translations === null ? { suggestions: suggestions ?? [] } : { suggestions, i18n: value.translations };
  const saved = await client.post<unknown>('/api/v1/configs/suggestions', body);
  return suggestionsOf({ suggestion_prompts: Array.isArray(saved) ? saved : record(saved).suggestions });
}

/** Whether two suggestion lists say the same (ones without a prompt don't count, as the save drops them). */
export const sameSuggestions = (a: SuggestedPrompt[] | null, b: SuggestedPrompt[] | null): boolean => same(suggestionsMeta(a), suggestionsMeta(b));

// --- Import and export, as the web's admin Actions menu has them. ---

/**
 * Models from an export file for the server's own import: one or a list; an older export's
 * `{id, info}` unwrapped. Entries without an id or a name are left out (the server would refuse
 * the whole file); the rest go as they are, sharing included, as the web sends them.
 */
export function rowsFromImport(json: unknown): { rows: Tree[]; skipped: number } {
  let skipped = 0;
  const rows = (Array.isArray(json) ? json : [json]).flatMap((raw): Tree[] => {
    const item = record(raw);
    const inner = record(item.info);
    const row = Object.keys(inner).length && !text(item.name) ? { ...inner, id: text(inner.id) || text(item.id) } : item;
    if (!text(row.id).trim() || !text(row.name).trim()) {
      skipped += 1;
      return [];
    }
    return [row];
  });
  return { rows, skipped };
}

/** Makes or changes the models (admins): a model already saved here keeps what the file leaves out of its `meta` and takes the rest. */
export async function importAdminModels(client: OwuiClient, rows: Tree[]): Promise<void> {
  const ok = await client.post<unknown>('/api/v1/models/import', { models: rows });
  if (ok !== true) throw new Error('the server didn’t import them');
}

/**
 * Every saved model (admins), as the server keeps them: the server's own models with saved
 * settings (its export leaves those out), then workspace models from its export (0.12 adds their
 * background pictures). Models nobody saved anything for have nothing to export.
 */
export async function exportAdminModels(client: OwuiClient): Promise<Tree[]> {
  const [rows, presets] = await Promise.all([client.get<unknown>('/api/v1/models/base'), client.get<unknown>('/api/v1/models/export')]);
  return [...list(rows), ...list(presets)].map(record);
}

/** One saved model, the same way (0.12 refuses its export for a model that isn't a workspace one; 0.11 sends them all). */
export async function exportAdminModel(client: OwuiClient, model: { id: string; preset: boolean }): Promise<Tree> {
  const rows = list(await (model.preset ? client.get<unknown>('/api/v1/models/export', { query: { ids: model.id } }) : client.get<unknown>('/api/v1/models/base'))).map(record);
  const row = rows.find((item) => item.id === model.id);
  if (!row) throw new Error('the server didn’t export it');
  return row;
}
