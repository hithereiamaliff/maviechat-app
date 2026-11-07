import type { Capabilities } from './capabilities';
import type { FeatureToggles } from './completions';
import type { FileItem } from './files';
import type { ModelItem } from './models';
import type { ServerConfig } from './server';
import type { ToolItem } from './tools';

/** Model capabilities the input bar checks (`info.meta.capabilities`). */
export type ModelCapability = 'vision' | 'file_upload' | 'web_search' | 'image_generation' | 'code_interpreter';

/** A capability the model doesn't list counts as supported, as on the web. */
export function modelSupports(model: ModelItem | undefined, capability: ModelCapability): boolean {
  return model?.info?.meta?.capabilities?.[capability] ?? true;
}

const TOGGLES = [
  { key: 'webSearch', feature: 'webSearch', capability: 'web_search' },
  { key: 'imageGeneration', feature: 'imageGeneration', capability: 'image_generation' },
  { key: 'codeInterpreter', feature: 'codeInterpreter', capability: 'code_interpreter' },
] as const;

export type ToggleKey = (typeof TOGGLES)[number]['key'];

/** Which of web search, image generation and code interpreter the input bar offers: server, permission and model all allow it. */
export function availableToggles(capabilities: Pick<Capabilities, 'feature'>, model: ModelItem | ModelItem[] | undefined): Record<ToggleKey, boolean> {
  // With several models (Compare), a toggle is offered only when every one of them supports it, as on the web.
  const models = Array.isArray(model) ? model : [model];
  const result = {} as Record<ToggleKey, boolean>;
  for (const toggle of TOGGLES) result[toggle.key] = capabilities.feature(toggle.feature) && models.every((item) => modelSupports(item, toggle.capability));
  return result;
}

/** Drops toggles the current model or server doesn't offer (e.g. after switching models). */
export function effectiveToggles(toggles: FeatureToggles, available: Record<ToggleKey, boolean>): FeatureToggles {
  const result: FeatureToggles = {};
  for (const { key } of TOGGLES) if (available[key] && toggles[key]) result[key] = true;
  return result;
}

/**
 * The toggles a model switches on by itself (`info.meta.defaultFeatureIds`). Like the web,
 * only for features the model lists as a capability and the server allows this user.
 */
export function defaultToggles(capabilities: Pick<Capabilities, 'feature'>, model: ModelItem | undefined): FeatureToggles {
  const meta = model?.info?.meta;
  const ids = meta?.defaultFeatureIds;
  const result: FeatureToggles = {};
  if (!Array.isArray(ids)) return result;
  for (const toggle of TOGGLES) {
    if (meta?.capabilities?.[toggle.capability] && capabilities.feature(toggle.feature) && ids.includes(toggle.capability)) {
      result[toggle.key] = true;
    }
  }
  return result;
}

/** Usable tools: OAuth tools you haven't connected yet need the web app first. */
export function usableTools(tools: ToolItem[]): ToolItem[] {
  return tools.filter((tool) => tool.authenticated !== false);
}

/** Tools switched on for a new chat: the model's own (`info.meta.toolIds`), else the ones you last saved (`ui.tools`). */
export function defaultToolIds(model: ModelItem | undefined, tools: ToolItem[], saved?: unknown): string[] {
  const known = new Set(usableTools(tools).map((tool) => tool.id));
  const own = model?.info?.meta?.toolIds;
  const source = Array.isArray(own) ? own : Array.isArray(saved) ? saved : [];
  return [...new Set(source.filter((id): id is string => typeof id === 'string' && known.has(id)))];
}

/** A model's switchable filters (the server lists only those an admin made switchable). */
export function modelFilters(model: ModelItem | undefined): { id: string; name: string; description: string }[] {
  const raw = (model as { filters?: unknown } | undefined)?.filters;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const row = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
    return typeof row.id === 'string' && row.id
      ? [{ id: row.id, name: typeof row.name === 'string' && row.name ? row.name : row.id, description: typeof row.description === 'string' ? row.description : '' }]
      : [];
  });
}

/** The model's filters that start on (`info.meta.defaultFilterIds`), as the web turns them on for a new message. */
export function defaultFilterIds(model: ModelItem | undefined): string[] {
  const own = (model?.info?.meta as { defaultFilterIds?: unknown } | undefined)?.defaultFilterIds;
  const known = new Set(modelFilters(model).map((filter) => filter.id));
  return Array.isArray(own) ? [...new Set(own.filter((id): id is string => typeof id === 'string' && known.has(id)))] : [];
}

/** The model's skills that start on (`info.meta.skillIds`), the ones still active. */
export function defaultSkillIds(model: ModelItem | undefined, skills: { id: string; active: boolean }[]): string[] {
  const own = (model?.info?.meta as { skillIds?: unknown } | undefined)?.skillIds;
  const active = new Set(skills.filter((skill) => skill.active).map((skill) => skill.id));
  return Array.isArray(own) ? [...new Set(own.filter((id): id is string => typeof id === 'string' && active.has(id)))] : [];
}

/** A skill as the web puts it in a message from the `/` list; the server adds the skill's text. */
export function skillMention(skill: { id: string; name: string }): string {
  // The server reads the label up to the first ">", so a name can't carry one.
  return '<$' + skill.id + '|' + skill.name.replace(/>/g, '') + '>';
}

/** The server's attachment limits (`file.max_count`, `file.max_size` in MB); null when the files may be attached. */
export function uploadLimitError(
  config: ServerConfig | undefined,
  attachedCount: number,
  incoming: { size?: number | null }[],
): string | null {
  const limits = (config?.file ?? {}) as { max_count?: unknown; max_size?: unknown };
  if (typeof limits.max_count === 'number' && attachedCount + incoming.length > limits.max_count) {
    return `You can only chat with a maximum of ${limits.max_count} file(s) at a time.`;
  }
  if (typeof limits.max_size === 'number' && incoming.some((file) => (file.size ?? 0) > (limits.max_size as number) * 1024 * 1024)) {
    return `File size should not exceed ${limits.max_size} MB.`;
  }
  if (incoming.some((file) => file.size === 0)) return 'You cannot upload an empty file.';
  return null;
}

/** True while an attachment is still uploading or failed: such a message waits instead of sending. */
export function filesPending(files: FileItem[]): boolean {
  return files.some((file) => file.status === 'uploading' || file.status === 'error');
}

/** A message typed while a reply was still running. */
export interface QueuedMessage {
  id: string;
  prompt: string;
  files: FileItem[];
}

/** Queued messages go out together once the reply finishes: one message, texts separated by a blank line. */
export function combineQueued(items: QueuedMessage[]): { prompt: string; files: FileItem[] } {
  return { prompt: items.map((item) => item.prompt).join('\n\n'), files: items.flatMap((item) => item.files) };
}
