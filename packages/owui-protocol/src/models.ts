import type { OwuiClient } from './http';
import type { ServerConfig } from './server';

/** A suggested prompt: `title` is one or two display lines, `content` is what gets sent. */
export interface PromptSuggestion {
  title?: string[];
  content: string;
}

/** An item of `GET /api/models`. Unknown fields are kept. */
export interface ModelItem {
  id: string;
  name: string;
  owned_by?: string;
  connection_type?: string;
  tags?: unknown[];
  info?: {
    meta?: {
      description?: string | null;
      profile_image_url?: string | null;
      suggestion_prompts?: PromptSuggestion[] | null;
      capabilities?: Record<string, boolean> | null;
      /** Kept out of the model picker (the model still works). */
      hidden?: boolean | null;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export async function listModels(client: OwuiClient): Promise<ModelItem[]> {
  const response = await client.get<{ data?: ModelItem[] }>('/api/models');
  return response.data ?? [];
}

/** `GET /api/v1/users/user/settings` → `{ui: {...}}`, the settings the web app syncs. Unknown keys are kept. */
export interface UserSettings {
  ui?: {
    models?: string[];
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export async function getUserSettings(client: OwuiClient): Promise<UserSettings> {
  return (await client.get<UserSettings | null>('/api/v1/users/user/settings')) ?? {};
}

/** Replaces the user's settings. Non-admins need the `settings.interface` permission (else 403). */
export function updateUserSettings(client: OwuiClient, settings: UserSettings): Promise<UserSettings> {
  return client.post<UserSettings>('/api/v1/users/user/settings/update', settings);
}

/** Makes `modelIds` the default for new chats, keeping every other setting (read, change, write back). */
export async function saveDefaultModels(client: OwuiClient, modelIds: string[]): Promise<UserSettings> {
  const current = await getUserSettings(client);
  return updateUserSettings(client, { ...current, ui: { ...(current.ui ?? {}), models: modelIds } });
}

/** The model a new chat starts with: the user's default, then the server's, then the first visible model. */
export function defaultModelId(models: ModelItem[], settings: UserSettings | undefined, config: ServerConfig | undefined): string | null {
  const visible = new Set(models.map((model) => model.id));
  const candidates = [
    ...(settings?.ui?.models ?? []),
    ...(typeof config?.default_models === 'string' ? config.default_models.split(',').map((id) => id.trim()) : []),
  ];
  return candidates.find((id) => id && visible.has(id)) ?? models[0]?.id ?? null;
}

/**
 * Suggested prompts for the new-chat screen: the model's own list, else the server's defaults.
 * As on the web, a model with an empty list (custom, no prompts) shows none.
 */
export function promptSuggestions(model: ModelItem | undefined, config: ServerConfig | undefined): PromptSuggestion[] {
  const own = model?.info?.meta?.suggestion_prompts;
  const list: unknown = Array.isArray(own) ? own : config?.default_prompt_suggestions;
  return Array.isArray(list) ? (list as PromptSuggestion[]).filter((item) => typeof item?.content === 'string') : [];
}

/** Display name for a model id, falling back to the id itself. */
export function modelName(models: ModelItem[] | undefined, id: string | undefined): string {
  if (!id) return 'Assistant';
  return models?.find((model) => model.id === id)?.name ?? id;
}

/** Models the picker lists. An admin can hide a model from it (`info.meta.hidden`) without taking it away. */
export function pickerModels(models: ModelItem[]): ModelItem[] {
  return models.filter((model) => !model.info?.meta?.hidden);
}

/** A model's tag names. `tags` holds `{name}` objects; plain strings are accepted too. */
export function modelTags(model: ModelItem): string[] {
  return (model.tags ?? []).flatMap((tag) => {
    const name = typeof tag === 'string' ? tag : typeof tag === 'object' && tag !== null ? (tag as { name?: unknown }).name : undefined;
    return typeof name === 'string' && name.trim() ? [name.trim()] : [];
  });
}

/** One of the picker's filters: `''` is All, then `connection:local|external` or `tag:<name>`. */
export interface ModelFilterOption {
  value: string;
  label: string;
}

/**
 * The picker's filters, as on the web: Local and External when the list has such models,
 * then every tag (lower case, sorted). Direct connections live in the browser, so the
 * server's list never has them.
 */
export function modelFilterOptions(models: ModelItem[]): ModelFilterOption[] {
  const options: ModelFilterOption[] = [];
  if (models.some((model) => model.connection_type === 'local')) options.push({ value: 'connection:local', label: 'Local' });
  if (models.some((model) => model.connection_type === 'external')) options.push({ value: 'connection:external', label: 'External' });
  const tags = [...new Set(models.flatMap((model) => modelTags(model).map((tag) => tag.toLowerCase())))].sort((a, b) => a.localeCompare(b));
  return [...options, ...tags.map((tag) => ({ value: `tag:${tag}`, label: tag }))];
}

export function matchesModelFilter(model: ModelItem, filter: string): boolean {
  if (filter.startsWith('connection:')) return model.connection_type === filter.slice('connection:'.length);
  if (filter.startsWith('tag:')) {
    const wanted = filter.slice('tag:'.length);
    return modelTags(model).some((tag) => tag.toLowerCase() === wanted);
  }
  return true;
}

/**
 * The small size label after a local model's name: Ollama's parameter size (e.g. "8B");
 * for LM Studio and llama.cpp the parameters, else the quantisation, else the file size.
 */
export function modelSizeLabel(model: ModelItem): string | null {
  const read = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const field = (source: unknown, key: string): unknown =>
    typeof source === 'object' && source !== null ? (source as Record<string, unknown>)[key] : undefined;
  if (model.owned_by === 'ollama') return read(field(field(model.ollama, 'details'), 'parameter_size'));
  if (model.provider !== 'lmstudio' && model.provider !== 'llama.cpp') return null;
  const parameters = read(model.params_string) ?? read(field(model.details, 'parameter_size'));
  const quantisation = read(field(model.quantization, 'name')) ?? read(field(model.details, 'quantization_level'));
  const bytes = typeof model.size_bytes === 'number' ? model.size_bytes : typeof model.size === 'number' ? model.size : null;
  return parameters ?? quantisation ?? (bytes ? `(${(bytes / 1024 ** 3).toFixed(1)}GB)` : null);
}

/** Where a model's picture loads from (send the session's bearer token). Without one the server answers with its own logo. */
export function modelImagePath(modelId: string): string {
  return `/api/v1/models/model/profile/image?id=${encodeURIComponent(modelId)}`;
}

/** "By …" under the model on the new-chat screen. Community models show @username and link to their page. */
export function modelAuthor(model: ModelItem | undefined): { label: string; url?: string } | null {
  const author = model?.info?.meta?.user;
  if (typeof author !== 'object' || author === null) return null;
  const { name, username, community } = author as { name?: unknown; username?: unknown; community?: unknown };
  const displayName = typeof name === 'string' && name.trim() ? name.trim() : null;
  const handle = typeof username === 'string' && username.trim() ? username.trim() : null;
  if (community && handle) return { label: displayName ?? `@${handle}`, url: `https://openwebui.com/m/${encodeURIComponent(handle)}` };
  return displayName ? { label: displayName } : null;
}
