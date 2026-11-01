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

/** The model a new chat starts with: the user's default, then the server's, then the first visible model. */
export function defaultModelId(models: ModelItem[], settings: UserSettings | undefined, config: ServerConfig | undefined): string | null {
  const visible = new Set(models.map((model) => model.id));
  const candidates = [
    ...(settings?.ui?.models ?? []),
    ...(typeof config?.default_models === 'string' ? config.default_models.split(',').map((id) => id.trim()) : []),
  ];
  return candidates.find((id) => id && visible.has(id)) ?? models[0]?.id ?? null;
}

/** Suggested prompts for the new-chat screen: the model's own, else the server defaults. */
export function promptSuggestions(model: ModelItem | undefined, config: ServerConfig | undefined): PromptSuggestion[] {
  const own = model?.info?.meta?.suggestion_prompts;
  if (Array.isArray(own) && own.length > 0) return own;
  const defaults = config?.default_prompt_suggestions;
  return Array.isArray(defaults) ? (defaults as PromptSuggestion[]).filter((item) => typeof item?.content === 'string') : [];
}

/** Display name for a model id, falling back to the id itself. */
export function modelName(models: ModelItem[] | undefined, id: string | undefined): string {
  if (!id) return 'Assistant';
  return models?.find((model) => model.id === id)?.name ?? id;
}
