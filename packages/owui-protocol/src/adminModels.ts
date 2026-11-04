import type { OwuiClient } from './http';
import { grantsOf, setWorkspaceModelHidden, type AccessGrant } from './workspaceModels';

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
}

const items = (body: unknown): Tree[] => list(record(body).data).map(record);

/**
 * Every model, as the web's admin list builds it: the models in use, then the providers' own
 * list (asking each provider), each with its saved row laid over.
 */
export async function listAdminModels(client: OwuiClient): Promise<AdminModel[]> {
  const [active, provider, rows] = await Promise.all([client.get<unknown>('/api/models'), client.get<unknown>('/api/models/base'), client.get<unknown>('/api/v1/models/base')]);
  const saved = new Map(list(rows).map((row) => [text(record(row).id), record(row)]));
  const seen = new Set<string>();
  return [...items(active), ...items(provider)].flatMap((item) => {
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
      },
    ];
  });
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
