import type { OwuiClient } from './http';
import type { KnowledgeChoice } from './knowledge';
import { stopTokens } from './params';
import type { FunctionItem } from './valves';

/*
 * The rest of a workspace model (Open WebUI 0.11.3), kept in its `meta` and `params`: what it
 * can do (capabilities), features switched on in new chats, the built-in tools it may use, what
 * it brings (knowledge, tools, skills, filters, actions), suggested prompts, and parameters
 * (with custom ones the server merges in).
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const strings = (value: unknown): string[] => list(value).map(text).filter(Boolean);

export const MODEL_CAPABILITIES = [
  { key: 'vision', label: 'Vision', note: 'It can look at pictures.' },
  { key: 'file_upload', label: 'File upload', note: 'Files can be attached.' },
  { key: 'file_context', label: 'File context', note: 'Attached files go into the prompt.' },
  { key: 'web_search', label: 'Web search', note: '' },
  { key: 'image_generation', label: 'Image generation', note: '' },
  { key: 'code_interpreter', label: 'Code interpreter', note: '' },
  { key: 'terminal', label: 'Terminal', note: '' },
  { key: 'citations', label: 'Citations', note: 'Sources are shown with answers.' },
  { key: 'status_updates', label: 'Status updates', note: 'What it’s doing shows as it works.' },
  { key: 'usage', label: 'Usage', note: 'Token counts are shown with answers.' },
  { key: 'memory', label: 'Memory', note: '' },
  { key: 'builtin_tools', label: 'Built-in tools', note: 'Open WebUI’s own tools (choose them below).' },
] as const;

export type WorkspaceCapability = (typeof MODEL_CAPABILITIES)[number]['key'];

/** The admin's defaults for every model (`DEFAULT_MODEL_METADATA`); any signed-in user may read them. */
export async function getModelDefaults(client: OwuiClient): Promise<Tree> {
  return record(record(await client.get<unknown>('/api/v1/configs/models/defaults')).DEFAULT_MODEL_METADATA);
}

/** A model's capabilities, as the web's editor starts them: all on but usage, then the admin's defaults, then the model's own. */
export function capabilitiesOf(meta: Tree, defaults: Tree = {}): Record<WorkspaceCapability, boolean> {
  const out = Object.fromEntries(MODEL_CAPABILITIES.map((item) => [item.key, item.key !== 'usage'])) as Record<WorkspaceCapability, boolean>;
  for (const source of [record(defaults.capabilities), record(meta.capabilities)]) {
    for (const item of MODEL_CAPABILITIES) if (typeof source[item.key] === 'boolean') out[item.key] = source[item.key] as boolean;
  }
  return out;
}

export const DEFAULT_FEATURES = [
  { key: 'web_search', label: 'Web search' },
  { key: 'code_interpreter', label: 'Code interpreter' },
  { key: 'image_generation', label: 'Image generation' },
] as const;

/** Features a new chat with the model starts with on, among the capabilities it has. */
export function defaultFeaturesOf(meta: Tree, capabilities: Record<WorkspaceCapability, boolean>): string[] {
  return strings(meta.defaultFeatureIds).filter((key) => capabilities[key as WorkspaceCapability]);
}

export const BUILTIN_TOOLS = [
  { key: 'time', label: 'Time' },
  { key: 'user_input', label: 'Asking you' },
  { key: 'memory', label: 'Memory' },
  { key: 'chats', label: 'Your chats' },
  { key: 'notes', label: 'Notes' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'files', label: 'Files' },
  { key: 'channels', label: 'Channels' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'web_search', label: 'Web search' },
  { key: 'image_generation', label: 'Image generation' },
  { key: 'code_interpreter', label: 'Code interpreter' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'automations', label: 'Automations' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'subagents', label: 'Sub-agents' },
] as const;

/** Built-in tools on (all are, unless switched off). */
export function builtinToolsOf(meta: Tree): Record<string, boolean> {
  const saved = record(meta.builtinTools);
  return Object.fromEntries(BUILTIN_TOOLS.map((tool) => [tool.key, saved[tool.key] !== false]));
}

/** As saved: only the ones switched off. */
export function builtinToolsMeta(state: Record<string, boolean>): Record<string, false> {
  return Object.fromEntries(Object.entries(state).flatMap(([key, on]) => (on ? [] : [[key, false] as const])));
}

/** A knowledge base or file the model brings, as saved (`context: full` puts the whole document in). */
export interface KnowledgeRef {
  id: string;
  name: string;
  type: string;
  description: string;
  full: boolean;
  raw: Tree;
}

export function knowledgeRefsOf(meta: Tree): KnowledgeRef[] {
  return list(meta.knowledge).flatMap((raw) => {
    const row = record(raw);
    const id = text(row.id);
    return id ? [{ id, name: text(row.name) || id, type: text(row.type) || 'collection', description: text(row.description), full: row.context === 'full', raw: row }] : [];
  });
}

const KEPT_KEYS = ['id', 'name', 'type', 'description', 'legacy', 'collection_name', 'collection_names'];

/** A picked knowledge base or file, as the web keeps it on a model. */
export function knowledgeRefFrom(choice: KnowledgeChoice): KnowledgeRef {
  const raw: Tree = {};
  for (const key of KEPT_KEYS) if (choice.raw[key] !== undefined) raw[key] = choice.raw[key];
  raw.id = choice.id;
  raw.name = choice.name;
  raw.type = choice.kind === 'file' ? 'file' : 'collection';
  if (!raw.description) raw.description = choice.description;
  return { id: choice.id, name: choice.name, type: text(raw.type), description: choice.description, full: false, raw };
}

/** As saved: only the kept keys, and `context: full` where asked for. */
export function knowledgeMeta(refs: KnowledgeRef[]): Tree[] {
  return refs.map((ref) => {
    const out: Tree = {};
    for (const key of KEPT_KEYS) if (ref.raw[key] !== undefined) out[key] = ref.raw[key];
    if (ref.full) out.context = 'full';
    return out;
  });
}

export interface SkillChoice {
  id: string;
  name: string;
  description: string;
  active: boolean;
}

/** Skills you can read (for pickers; without their text). */
export async function listSkillChoices(client: OwuiClient): Promise<SkillChoice[]> {
  return list(await client.get<unknown>('/api/v1/skills/')).flatMap((raw) => {
    const row = record(raw);
    const id = text(row.id);
    return id ? [{ id, name: text(row.name) || id, description: text(row.description), active: row.is_active !== false }] : [];
  });
}

export interface FunctionChoice {
  id: string;
  name: string;
  /** On for every chat already (an admin's global function): always on, can't be removed. */
  global: boolean;
  /** A filter you can switch on and off in a chat. */
  toggle: boolean;
}

export function functionChoices(functions: FunctionItem[], type: 'filter' | 'action'): FunctionChoice[] {
  return functions
    .filter((item) => item.type === type && item.is_active !== false)
    .map((item) => ({ id: item.id, name: item.name || item.id, global: item.is_global === true, toggle: record(item.meta).toggle === true }));
}

export interface SuggestedPrompt {
  title: string;
  subtitle: string;
  content: string;
}

/** The model's own suggested prompts, or null for the server's defaults. */
export function suggestionsOf(meta: Tree): SuggestedPrompt[] | null {
  if (!Array.isArray(meta.suggestion_prompts)) return null;
  return meta.suggestion_prompts.map((raw) => {
    const row = record(raw);
    const title = list(row.title);
    return { title: text(title[0]), subtitle: text(title[1]), content: text(row.content) };
  });
}

export function suggestionsMeta(prompts: SuggestedPrompt[] | null): Tree[] | null {
  if (prompts === null) return null;
  return prompts.filter((prompt) => prompt.content.trim()).map((prompt) => ({ content: prompt.content, title: [prompt.title, prompt.subtitle] }));
}

/** Custom parameters, as text (the server reads JSON where it can and merges them in). */
export function customParamsOf(params: Tree): { name: string; value: string }[] {
  return Object.entries(record(params.custom_params)).map(([name, value]) => ({ name, value: typeof value === 'string' ? value : JSON.stringify(value) }));
}

/** Parameters as the model keeps them: stop sequences as a list, custom ones by name, empties dropped. */
export function modelParamsToSave(params: Tree, custom: { name: string; value: string }[]): Tree {
  const out: Tree = {};
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') out[key] = value;
  if ('stop' in out) {
    const stop = stopTokens(out.stop);
    if (stop) out.stop = stop;
    else delete out.stop;
  }
  const named = custom.filter((item) => item.name.trim());
  if (named.length) out.custom_params = Object.fromEntries(named.map((item) => [item.name.trim(), item.value]));
  else delete out.custom_params;
  return out;
}
