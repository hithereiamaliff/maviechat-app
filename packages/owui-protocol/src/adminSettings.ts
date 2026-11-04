import type { OwuiClient } from './http';

/*
 * Admin settings (Open WebUI 0.11.3) as data: pages of sections of fields, each field a key of
 * the object its endpoint reads and writes. The app edits only the fields an admin touches and
 * sends nothing when nothing changed (every save stamps the server's settings and can set off
 * reloads and events). A save is built on a fresh read with the edits laid over it, as most
 * endpoints replace their whole object; untouched values go back exactly as they came.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});

export type SettingKind = 'switch' | 'text' | 'multiline' | 'number' | 'select' | 'secret' | 'list';

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingField {
  key: string;
  label: string;
  hint?: string;
  kind: SettingKind;
  /** Fixed choices; or, with `optionsFrom`, filled in by the screen (groups, models…). */
  options?: SettingOption[];
  optionsFrom?: 'groups' | 'models';
  /** Shown only while these switches (keys on the same page) are on, or (`KEY=value`) set so. */
  needs?: string[];
  /** For numbers: what an empty field means (it's sent as ''). */
  empty?: string;
  /** Why a value can't be saved, if it can't. */
  check?: (value: unknown) => string | null;
  /** Something to confirm before saving this value. */
  confirm?: (value: unknown) => string | null;
}

export interface SettingSection {
  title: string;
  note?: string;
  fields: SettingField[];
}

/** What the form edits: the text or switch the admin sees, per key. */
export type SettingEdits = Record<string, string | boolean>;

/** A stored value as the form shows it (a list as text, separated by commas). */
export function formValue(field: SettingField, stored: unknown): string | boolean {
  if (field.kind === 'switch') return stored === true;
  if (field.kind === 'list') return Array.isArray(stored) ? stored.map(String).join(', ') : typeof stored === 'string' ? stored : '';
  if (stored === null || stored === undefined) return '';
  return typeof stored === 'string' ? stored : String(stored);
}

/**
 * A form value as the server stores it, keeping the stored type: switches as booleans, numbers
 * as numbers ('' when empty), text as text (an untouched empty value stays null if it was).
 */
export function storedValue(field: SettingField, value: string | boolean, original: unknown): unknown {
  if (field.kind === 'switch') return value === true;
  const text = typeof value === 'string' ? value : String(value);
  if (field.kind === 'list') {
    const items = text
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return !items.length && (original === null || original === undefined) ? original : items;
  }
  if (field.kind === 'number') {
    const trimmed = text.trim();
    if (!trimmed) return original === null || original === undefined ? original : '';
    const number = Number(trimmed);
    return Number.isFinite(number) ? number : trimmed;
  }
  if (!text && (original === null || original === undefined)) return original;
  return text;
}

/** Whether a field shows, given the page's values (stored, with edits laid over). */
export function settingShown(field: SettingField, values: Tree): boolean {
  return (field.needs ?? []).every((need) => {
    const at = need.indexOf('=');
    return at < 0 ? values[need] === true : String(values[need.slice(0, at)] ?? '') === need.slice(at + 1);
  });
}

/** The page's values with the edits laid over, in stored form. */
export function settingValues(fields: SettingField[], stored: Tree, edits: SettingEdits): Tree {
  const values: Tree = { ...stored };
  for (const field of fields) if (field.key in edits) values[field.key] = storedValue(field, edits[field.key] as string | boolean, stored[field.key]);
  return values;
}

const same = (a: unknown, b: unknown) =>
  a === b ||
  (typeof a === 'number' && typeof b === 'string' && String(a) === b.trim()) ||
  (typeof b === 'number' && typeof a === 'string' && String(b) === a.trim()) ||
  (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

/** The keys an admin changed (their stored form differs from what's stored), each once. */
export function settingChanges(fields: SettingField[], stored: Tree, edits: SettingEdits): string[] {
  const keys = fields.filter((field) => field.key in edits && !same(storedValue(field, edits[field.key] as string | boolean, stored[field.key]), stored[field.key])).map((field) => field.key);
  return [...new Set(keys)];
}

/** Problems that stop a save: each changed field's own check. */
export function settingProblems(fields: SettingField[], stored: Tree, edits: SettingEdits): string[] {
  const changed = new Set(settingChanges(fields, stored, edits));
  const checked = new Set<string>();
  return fields.flatMap((field) => {
    if (!changed.has(field.key) || !field.check || checked.has(field.key)) return [];
    checked.add(field.key);
    const problem = field.check(storedValue(field, edits[field.key] as string | boolean, stored[field.key]));
    return problem ? [`${field.label}: ${problem}`] : [];
  });
}

/** For "what changes": old → new, secrets only as "changed". */
export function describeSettingChange(field: SettingField, before: unknown, after: unknown, options: SettingOption[] = field.options ?? []): string {
  if (field.kind === 'secret') return `${field.label}: changed`;
  const show = (value: unknown) => {
    if (field.kind === 'switch') return value === true ? 'on' : 'off';
    if (value === null || value === undefined || value === '') return field.empty ?? 'empty';
    const option = options.find((item) => item.value === String(value));
    const text = option ? option.label : String(value);
    return text.length > 40 ? `“${text.slice(0, 40)}…”` : `“${text}”`;
  };
  return `${field.label}: ${show(before)} → ${show(after)}`;
}

/** Only the changed keys, laid over a fresh read (for endpoints that replace their whole object). */
export function settingsPayload(fields: SettingField[], fresh: Tree, read: Tree, edits: SettingEdits): Tree {
  const payload: Tree = { ...fresh };
  for (const key of settingChanges(fields, read, edits)) {
    const field = fields.find((item) => item.key === key);
    if (field) payload[key] = storedValue(field, edits[key] as string | boolean, fresh[key]);
  }
  return payload;
}

/** Keys that changed on the server since the form was read and that the admin also touched. */
export function settingConflicts(fields: SettingField[], read: Tree, fresh: Tree, edits: SettingEdits): string[] {
  return settingChanges(fields, read, edits).filter((key) => !same(read[key], fresh[key]));
}

// --- The admin config: General and Authentication share it (POST replaces it whole). ---

export async function getAdminConfig(client: OwuiClient): Promise<Tree> {
  return record(await client.get<unknown>('/api/v1/auths/admin/config'));
}

export async function saveAdminConfig(client: OwuiClient, config: Tree): Promise<Tree> {
  return record(await client.post<unknown>('/api/v1/auths/admin/config', config));
}

/** As the server reads durations: -1 or 0, or number-and-unit pairs (`4w`, `1d12h`). */
const JWT = /^(-1|0|(\d+(\.\d+)?(ms|s|m|h|d|w))+)$/;

export const GENERAL_SECTIONS: SettingSection[] = [
  {
    title: 'Features',
    note: 'For everyone on this server.',
    fields: [
      { key: 'ENABLE_FOLDERS', label: 'Folders', kind: 'switch' },
      { key: 'FOLDER_MAX_FILE_COUNT', label: 'Files a folder can hold', kind: 'number', empty: 'no limit', needs: ['ENABLE_FOLDERS'], check: (value) => (value === '' || (typeof value === 'number' && Number.isInteger(value) && value > 0) ? null : 'a whole number, or empty for no limit') },
      { key: 'ENABLE_MEMORIES', label: 'Memories', kind: 'switch' },
      { key: 'ENABLE_MEMORY_SYSTEM_CONTEXT', label: 'Put memories in every chat', hint: 'Otherwise models look them up when they need them.', kind: 'switch', needs: ['ENABLE_MEMORIES'] },
      { key: 'ENABLE_NOTES', label: 'Notes', kind: 'switch' },
      { key: 'ENABLE_CHANNELS', label: 'Channels', kind: 'switch' },
      {
        key: 'CHANNEL_MODEL_RESPONSE_MODE',
        label: 'Models answer in channels',
        kind: 'select',
        needs: ['ENABLE_CHANNELS'],
        options: [
          { value: 'thread', label: 'In a thread' },
          { value: 'channel', label: 'In the channel' },
        ],
      },
      { key: 'ENABLE_CALENDAR', label: 'Calendar', kind: 'switch' },
      { key: 'ENABLE_AUTOMATIONS', label: 'Automations', kind: 'switch' },
      { key: 'ENABLE_USER_WEBHOOKS', label: 'People’s own webhooks', kind: 'switch' },
      { key: 'ENABLE_USER_STATUS', label: 'Status messages', kind: 'switch' },
      { key: 'ENABLE_MESSAGE_RATING', label: 'Rating replies', kind: 'switch' },
      { key: 'ENABLE_COMMUNITY_SHARING', label: 'Sharing to the Open WebUI community', kind: 'switch' },
    ],
  },
  {
    title: 'Server',
    fields: [
      { key: 'WEBUI_URL', label: 'This server’s address', hint: 'Used in links it sends (emails, OAuth, webhooks).', kind: 'text' },
      { key: 'RESPONSE_WATERMARK', label: 'Text added when copying a reply', kind: 'multiline' },
    ],
  },
];

export const AUTHENTICATION_SECTIONS: SettingSection[] = [
  {
    title: 'Signing up',
    fields: [
      { key: 'ENABLE_SIGNUP', label: 'Anyone can sign up', kind: 'switch' },
      {
        key: 'DEFAULT_USER_ROLE',
        label: 'New accounts are',
        kind: 'select',
        options: [
          { value: 'pending', label: 'Waiting for approval' },
          { value: 'user', label: 'Users' },
          { value: 'admin', label: 'Admins' },
        ],
        confirm: (value) => (value === 'admin' ? 'Every new account would be an admin, able to change everything on this server.' : null),
      },
      { key: 'DEFAULT_GROUP_ID', label: 'New accounts join', kind: 'select', optionsFrom: 'groups' },
    ],
  },
  {
    title: 'While waiting for approval',
    fields: [
      { key: 'PENDING_USER_OVERLAY_TITLE', label: 'Title they see', kind: 'text' },
      { key: 'PENDING_USER_OVERLAY_CONTENT', label: 'Message they see', kind: 'multiline' },
      { key: 'SHOW_ADMIN_DETAILS', label: 'Show whom to contact', kind: 'switch' },
      { key: 'ADMIN_EMAIL', label: 'Contact email', hint: 'Empty: the first admin’s.', kind: 'text', needs: ['SHOW_ADMIN_DETAILS'] },
    ],
  },
  {
    title: 'Sessions and API keys',
    fields: [
      { key: 'JWT_EXPIRES_IN', label: 'Sign-ins last', hint: 'Like 4w, 7d, 12h; -1 never expires. New sign-ins only.', kind: 'text', check: (value) => (typeof value === 'string' && JWT.test(value.trim()) ? null : 'a number with ms, s, m, h, d or w; or -1, or 0') },
      { key: 'ENABLE_API_KEYS', label: 'API keys', kind: 'switch' },
      { key: 'ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS', label: 'Limit what API keys can reach', kind: 'switch', needs: ['ENABLE_API_KEYS'] },
      { key: 'API_KEYS_ALLOWED_ENDPOINTS', label: 'Allowed paths', hint: 'Separated by commas, like /api/v1/messages, /api/v1/channels', kind: 'text', needs: ['ENABLE_API_KEYS', 'ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS'] },
    ],
  },
];

// --- Banners: shown to everyone at the top of their chats (POST replaces the whole list). ---

export type BannerType = 'info' | 'warning' | 'error' | 'success';

export interface Banner {
  id: string;
  type: BannerType;
  title: string;
  content: string;
  dismissible: boolean;
  /** Seconds. */
  timestamp: number;
}

const BANNER_TYPES: BannerType[] = ['info', 'warning', 'error', 'success'];

export async function getBanners(client: OwuiClient): Promise<Banner[]> {
  const body = await client.get<unknown>('/api/v1/configs/banners');
  return (Array.isArray(body) ? body : []).flatMap((raw) => {
    const row = record(raw);
    if (typeof row.id !== 'string') return [];
    const type = BANNER_TYPES.includes(row.type as BannerType) ? (row.type as BannerType) : 'info';
    return [{ id: row.id, type, title: typeof row.title === 'string' ? row.title : '', content: typeof row.content === 'string' ? row.content : '', dismissible: row.dismissible !== false, timestamp: typeof row.timestamp === 'number' ? row.timestamp : 0 }];
  });
}

export async function saveBanners(client: OwuiClient, banners: Banner[]): Promise<void> {
  await client.post<unknown>('/api/v1/configs/banners', { banners: banners.map((banner) => ({ id: banner.id, type: banner.type, title: banner.title || null, content: banner.content, dismissible: banner.dismissible, timestamp: banner.timestamp })) });
}

/** Whether two banner lists say the same (for no-change saves). */
export const sameBanners = (a: Banner[], b: Banner[]): boolean => JSON.stringify(a) === JSON.stringify(b);

// --- Interface: background tasks (their own endpoint) and chat context (another one). ---

const templateHint = 'Empty: the built-in one.';
const checkWhole = (min: number, max?: number) => (value: unknown) =>
  value === '' || value === null || (typeof value === 'number' && Number.isInteger(value) && value >= min && (max === undefined || value <= max)) ? null : `a whole number${max === undefined ? ` from ${min}` : ` from ${min} to ${max}`}`;

export async function getTaskConfig(client: OwuiClient): Promise<Tree> {
  return record(await client.get<unknown>('/api/v1/tasks/config'));
}
export async function saveTaskConfig(client: OwuiClient, config: Tree): Promise<Tree> {
  return record(await client.post<unknown>('/api/v1/tasks/config/update', config));
}

export const TASK_SECTIONS: SettingSection[] = [
  {
    title: 'Background tasks',
    note: 'Titles, tags, follow-ups and searches are written by a model for every chat, spending its tokens.',
    fields: [
      { key: 'TASK_MODEL', label: 'Model for local models’ chats', kind: 'select', optionsFrom: 'models' },
      { key: 'TASK_MODEL_EXTERNAL', label: 'Model for other chats', kind: 'select', optionsFrom: 'models' },
      { key: 'ENABLE_TITLE_GENERATION', label: 'Chat titles', kind: 'switch' },
      { key: 'TITLE_GENERATION_PROMPT_TEMPLATE', label: 'Title prompt', hint: templateHint, kind: 'multiline', needs: ['ENABLE_TITLE_GENERATION'] },
      { key: 'ENABLE_FOLLOW_UP_GENERATION', label: 'Suggested follow-ups', kind: 'switch' },
      { key: 'FOLLOW_UP_GENERATION_PROMPT_TEMPLATE', label: 'Follow-up prompt', hint: templateHint, kind: 'multiline', needs: ['ENABLE_FOLLOW_UP_GENERATION'] },
      { key: 'ENABLE_TAGS_GENERATION', label: 'Chat tags', kind: 'switch' },
      { key: 'TAGS_GENERATION_PROMPT_TEMPLATE', label: 'Tags prompt', hint: templateHint, kind: 'multiline', needs: ['ENABLE_TAGS_GENERATION'] },
      { key: 'ENABLE_AUTOCOMPLETE_GENERATION', label: 'Autocomplete while typing', kind: 'switch' },
      { key: 'AUTOCOMPLETE_GENERATION_INPUT_MAX_LENGTH', label: 'Longest text to autocomplete', hint: '-1: no limit.', kind: 'number', needs: ['ENABLE_AUTOCOMPLETE_GENERATION'], check: checkWhole(-1) },
      { key: 'AUTOCOMPLETE_GENERATION_PROMPT_TEMPLATE', label: 'Autocomplete prompt', hint: templateHint, kind: 'multiline', needs: ['ENABLE_AUTOCOMPLETE_GENERATION'] },
      { key: 'ENABLE_SEARCH_QUERY_GENERATION', label: 'Write web searches', kind: 'switch' },
      { key: 'ENABLE_RETRIEVAL_QUERY_GENERATION', label: 'Write knowledge searches', kind: 'switch' },
      { key: 'QUERY_GENERATION_PROMPT_TEMPLATE', label: 'Search prompt', hint: templateHint, kind: 'multiline' },
      { key: 'IMAGE_PROMPT_GENERATION_PROMPT_TEMPLATE', label: 'Image prompt', hint: templateHint, kind: 'multiline' },
      { key: 'TOOLS_FUNCTION_CALLING_PROMPT_TEMPLATE', label: 'Tool calling prompt', hint: templateHint, kind: 'multiline' },
      { key: 'ENABLE_VOICE_MODE_PROMPT', label: 'Voice mode instructions', kind: 'switch' },
      { key: 'VOICE_MODE_PROMPT_TEMPLATE', label: 'Voice mode prompt', hint: templateHint, kind: 'multiline', needs: ['ENABLE_VOICE_MODE_PROMPT'] },
    ],
  },
];

export async function getChatConfig(client: OwuiClient): Promise<Tree> {
  return record(await client.get<unknown>('/api/v1/chats/config'));
}
export async function saveChatConfig(client: OwuiClient, config: Tree): Promise<Tree> {
  return record(await client.post<unknown>('/api/v1/chats/config', config));
}

export const CHAT_SECTIONS: SettingSection[] = [
  {
    title: 'Chats',
    fields: [
      { key: 'ENABLE_TOOL_PERMISSIONS', label: 'Tools ask before acting', hint: 'People approve each tool call, or allow it fully.', kind: 'switch' },
      { key: 'ENABLE_CONTEXT_COMPACTION', label: 'Shorten long chats', hint: 'Older messages are summed up when a chat gets long.', kind: 'switch' },
      { key: 'CONTEXT_COMPACTION_MODEL', label: 'Model that sums up', kind: 'select', optionsFrom: 'models', needs: ['ENABLE_CONTEXT_COMPACTION'] },
      { key: 'CONTEXT_COMPACTION_TOKEN_THRESHOLD', label: 'From this many tokens', kind: 'number', needs: ['ENABLE_CONTEXT_COMPACTION'], check: checkWhole(1) },
      { key: 'CONTEXT_COMPACTION_TOKEN_CAP', label: 'Never past this many tokens', hint: 'Empty: the same as above.', kind: 'number', needs: ['ENABLE_CONTEXT_COMPACTION'], check: checkWhole(1) },
      { key: 'CONTEXT_COMPACTION_RETENTION_PERCENTAGE', label: 'Keep this % word for word', hint: 'From 10 to 50.', kind: 'number', needs: ['ENABLE_CONTEXT_COMPACTION'], check: checkWhole(10, 50) },
      { key: 'CONTEXT_COMPACTION_PROMPT_TEMPLATE', label: 'Summary prompt', hint: templateHint, kind: 'multiline', needs: ['ENABLE_CONTEXT_COMPACTION'] },
    ],
  },
];

// --- Sub-agents and code execution: one endpoint each, every field sent. ---

export async function getSubagentsConfig(client: OwuiClient): Promise<Tree> {
  return record(await client.get<unknown>('/api/v1/configs/subagents'));
}
export async function saveSubagentsConfig(client: OwuiClient, config: Tree): Promise<Tree> {
  return record(await client.post<unknown>('/api/v1/configs/subagents', config));
}

export const SUBAGENT_SECTIONS: SettingSection[] = [
  {
    title: 'Sub-agents',
    note: 'Models hand parts of a task to helpers of their own: more loops, more tokens.',
    fields: [
      { key: 'ENABLE_SUBAGENTS', label: 'Sub-agents', kind: 'switch' },
      { key: 'SUBAGENTS_BACKGROUND_ENABLED', label: 'Run in the background', kind: 'switch', needs: ['ENABLE_SUBAGENTS'] },
      { key: 'SUBAGENTS_MAX_CONCURRENT', label: 'At once, at most', kind: 'number', needs: ['ENABLE_SUBAGENTS'], check: checkWhole(0) },
      { key: 'SUBAGENTS_MAX_ASYNC', label: 'In the background, at most', kind: 'number', needs: ['ENABLE_SUBAGENTS'], check: checkWhole(0) },
      { key: 'SUBAGENTS_MAX_ITERATIONS', label: 'Steps each, at most', kind: 'number', needs: ['ENABLE_SUBAGENTS'], check: checkWhole(0) },
      { key: 'SUBAGENTS_MAX_OUTPUT', label: 'Characters each returns, at most', kind: 'number', needs: ['ENABLE_SUBAGENTS'], check: checkWhole(0) },
      { key: 'SUBAGENTS_SYSTEM_PROMPT', label: 'Their instructions', hint: templateHint, kind: 'multiline', needs: ['ENABLE_SUBAGENTS'] },
    ],
  },
];

export async function getCodeExecutionConfig(client: OwuiClient): Promise<Tree> {
  return record(await client.get<unknown>('/api/v1/configs/code_execution'));
}
export async function saveCodeExecutionConfig(client: OwuiClient, config: Tree): Promise<Tree> {
  return record(await client.post<unknown>('/api/v1/configs/code_execution', config));
}

const ENGINES: SettingOption[] = [
  { value: 'pyodide', label: 'In the browser' },
  { value: 'jupyter', label: 'Jupyter (on a server)' },
];
const AUTH: SettingOption[] = [
  { value: '', label: 'None' },
  { value: 'token', label: 'Token' },
  { value: 'password', label: 'Password' },
];
const jupyterFields = (prefix: 'CODE_EXECUTION' | 'CODE_INTERPRETER', on: string): SettingField[] => [
  { key: `${prefix}_JUPYTER_URL`, label: 'Jupyter address', kind: 'text', needs: [on, `${prefix}_ENGINE=jupyter`] },
  { key: `${prefix}_JUPYTER_AUTH`, label: 'Jupyter sign-in', kind: 'select', options: AUTH, needs: [on, `${prefix}_ENGINE=jupyter`] },
  { key: `${prefix}_JUPYTER_AUTH_TOKEN`, label: 'Jupyter token', kind: 'secret', needs: [on, `${prefix}_ENGINE=jupyter`, `${prefix}_JUPYTER_AUTH=token`] },
  { key: `${prefix}_JUPYTER_AUTH_PASSWORD`, label: 'Jupyter password', kind: 'secret', needs: [on, `${prefix}_ENGINE=jupyter`, `${prefix}_JUPYTER_AUTH=password`] },
  { key: `${prefix}_JUPYTER_TIMEOUT`, label: 'Seconds before it gives up', kind: 'number', needs: [on, `${prefix}_ENGINE=jupyter`], check: checkWhole(1) },
];

export const CODE_EXECUTION_SECTIONS: SettingSection[] = [
  {
    title: 'Running code in replies',
    note: 'The app’s Run button needs Jupyter: an iPhone can’t run code the browser way.',
    fields: [{ key: 'ENABLE_CODE_EXECUTION', label: 'Run button on code', kind: 'switch' }, { key: 'CODE_EXECUTION_ENGINE', label: 'Runs', kind: 'select', options: ENGINES, needs: ['ENABLE_CODE_EXECUTION'] }, ...jupyterFields('CODE_EXECUTION', 'ENABLE_CODE_EXECUTION')],
  },
  {
    title: 'Code interpreter',
    note: 'Models write and run code themselves while they answer.',
    fields: [
      { key: 'ENABLE_CODE_INTERPRETER', label: 'Code interpreter', kind: 'switch' },
      { key: 'CODE_INTERPRETER_ENGINE', label: 'Runs', kind: 'select', options: ENGINES, needs: ['ENABLE_CODE_INTERPRETER'] },
      { key: 'CODE_INTERPRETER_PROMPT_TEMPLATE', label: 'Its prompt', hint: templateHint, kind: 'multiline', needs: ['ENABLE_CODE_INTERPRETER'] },
      ...jupyterFields('CODE_INTERPRETER', 'ENABLE_CODE_INTERPRETER'),
    ],
  },
];

// --- Web Search: the retrieval settings' `web` part, sent whole (a field left out is nulled). ---

/** The web search and page-reading settings, as the server keeps them. */
export async function getWebConfig(client: OwuiClient): Promise<Tree> {
  return record(record(await client.get<unknown>('/api/v1/retrieval/config')).web);
}

/** Saves only `web` (the other retrieval settings, left out, stay as they are). With hybrid search on, the server reloads its reranker. */
export async function saveWebConfig(client: OwuiClient, web: Tree): Promise<Tree> {
  return record(await client.post<unknown>('/api/v1/retrieval/config/update', { web }, { timeoutMs: 120_000 }));
}

const ENGINE_OPTIONS: SettingOption[] = [
  ['searxng', 'SearXNG'],
  ['brave', 'Brave'],
  ['brave_llm_context', 'Brave (LLM context)'],
  ['tavily', 'Tavily'],
  ['duckduckgo', 'DuckDuckGo'],
  ['google_pse', 'Google PSE'],
  ['perplexity', 'Perplexity'],
  ['perplexity_search', 'Perplexity Search'],
  ['exa', 'Exa'],
  ['jina', 'Jina'],
  ['kagi', 'Kagi'],
  ['mojeek', 'Mojeek'],
  ['bocha', 'Bocha'],
  ['serpstack', 'Serpstack'],
  ['serper', 'Serper'],
  ['serply', 'Serply'],
  ['serphouse', 'SerpHouse'],
  ['searchapi', 'SearchApi'],
  ['serpapi', 'SerpApi'],
  ['firecrawl', 'Firecrawl'],
  ['linkup', 'Linkup'],
  ['youcom', 'You.com'],
  ['yandex', 'Yandex'],
  ['yacy', 'YaCy'],
  ['openserp', 'OpenSERP'],
  ['sougou', 'Sougou'],
  ['ollama_cloud', 'Ollama Cloud'],
  ['microsoft_web_iq', 'Microsoft Web IQ'],
  ['bing', 'Bing'],
  ['azure', 'Azure'],
  ['external', 'Your own (external)'],
].map(([value = '', label = '']) => ({ value, label }));

/** Each engine's own settings (only shown for that engine). */
const ENGINE_FIELDS: [string, SettingField[]][] = [
  ['searxng', [{ key: 'SEARXNG_QUERY_URL', label: 'Query address', hint: 'With <query> where the words go.', kind: 'text' }, { key: 'SEARXNG_LANGUAGE', label: 'Language', kind: 'text' }]],
  ['brave', [{ key: 'BRAVE_SEARCH_API_KEY', label: 'Brave key', kind: 'secret' }]],
  ['brave_llm_context', [{ key: 'BRAVE_SEARCH_API_KEY', label: 'Brave key', kind: 'secret' }, { key: 'BRAVE_SEARCH_CONTEXT_TOKENS', label: 'Tokens of context', kind: 'number' }]],
  ['tavily', [{ key: 'TAVILY_API_KEY', label: 'Tavily key', kind: 'secret' }]],
  ['duckduckgo', [{ key: 'DDGS_BACKEND', label: 'Backend', kind: 'text' }]],
  ['google_pse', [{ key: 'GOOGLE_PSE_API_KEY', label: 'Google key', kind: 'secret' }, { key: 'GOOGLE_PSE_ENGINE_ID', label: 'Search engine id', kind: 'text' }]],
  ['perplexity', [{ key: 'PERPLEXITY_API_KEY', label: 'Perplexity key', kind: 'secret' }, { key: 'PERPLEXITY_MODEL', label: 'Model', kind: 'text' }, { key: 'PERPLEXITY_SEARCH_CONTEXT_USAGE', label: 'Search context size', kind: 'text' }]],
  ['perplexity_search', [{ key: 'PERPLEXITY_API_KEY', label: 'Perplexity key', kind: 'secret' }, { key: 'PERPLEXITY_SEARCH_API_URL', label: 'API address', kind: 'text' }]],
  ['exa', [{ key: 'EXA_API_KEY', label: 'Exa key', kind: 'secret' }]],
  ['jina', [{ key: 'JINA_API_KEY', label: 'Jina key', kind: 'secret' }, { key: 'JINA_API_BASE_URL', label: 'API address', kind: 'text' }]],
  ['kagi', [{ key: 'KAGI_SEARCH_API_KEY', label: 'Kagi key', kind: 'secret' }]],
  ['mojeek', [{ key: 'MOJEEK_SEARCH_API_KEY', label: 'Mojeek key', kind: 'secret' }]],
  ['bocha', [{ key: 'BOCHA_SEARCH_API_KEY', label: 'Bocha key', kind: 'secret' }]],
  ['serpstack', [{ key: 'SERPSTACK_API_KEY', label: 'Serpstack key', kind: 'secret' }, { key: 'SERPSTACK_HTTPS', label: 'Use HTTPS', kind: 'switch' }]],
  ['serper', [{ key: 'SERPER_API_KEY', label: 'Serper key', kind: 'secret' }]],
  ['serply', [{ key: 'SERPLY_API_KEY', label: 'Serply key', kind: 'secret' }]],
  ['serphouse', [{ key: 'SERPHOUSE_API_KEY', label: 'SerpHouse key', kind: 'secret' }, { key: 'SERPHOUSE_DOMAIN', label: 'Domain', kind: 'text' }]],
  ['searchapi', [{ key: 'SEARCHAPI_API_KEY', label: 'SearchApi key', kind: 'secret' }, { key: 'SEARCHAPI_ENGINE', label: 'Engine', kind: 'text' }]],
  ['serpapi', [{ key: 'SERPAPI_API_KEY', label: 'SerpApi key', kind: 'secret' }, { key: 'SERPAPI_ENGINE', label: 'Engine', kind: 'text' }]],
  ['firecrawl', [{ key: 'FIRECRAWL_API_KEY', label: 'Firecrawl key', kind: 'secret' }, { key: 'FIRECRAWL_API_BASE_URL', label: 'API address', kind: 'text' }]],
  ['linkup', [{ key: 'LINKUP_API_KEY', label: 'Linkup key', kind: 'secret' }]],
  ['youcom', [{ key: 'YOUCOM_API_KEY', label: 'You.com key', kind: 'secret' }]],
  ['yandex', [{ key: 'YANDEX_WEB_SEARCH_URL', label: 'Address', kind: 'text' }, { key: 'YANDEX_WEB_SEARCH_API_KEY', label: 'Yandex key', kind: 'secret' }, { key: 'YANDEX_WEB_SEARCH_CONFIG', label: 'Settings (JSON)', kind: 'multiline' }]],
  ['yacy', [{ key: 'YACY_QUERY_URL', label: 'Query address', kind: 'text' }, { key: 'YACY_USERNAME', label: 'Username', kind: 'text' }, { key: 'YACY_PASSWORD', label: 'Password', kind: 'secret' }]],
  ['openserp', [{ key: 'OPENSERP_BASE_URL', label: 'Address', kind: 'text' }]],
  ['sougou', [{ key: 'SOUGOU_API_SID', label: 'Secret id', kind: 'secret' }, { key: 'SOUGOU_API_SK', label: 'Secret key', kind: 'secret' }]],
  ['ollama_cloud', [{ key: 'OLLAMA_CLOUD_WEB_SEARCH_API_KEY', label: 'Ollama key', kind: 'secret' }]],
  ['microsoft_web_iq', [{ key: 'MICROSOFT_WEB_IQ_API_BASE_URL', label: 'Address', kind: 'text' }, { key: 'MICROSOFT_WEB_IQ_API_KEY', label: 'Key', kind: 'secret' }, { key: 'MICROSOFT_WEB_IQ_LANGUAGE', label: 'Language', kind: 'text' }]],
  ['external', [{ key: 'EXTERNAL_WEB_SEARCH_URL', label: 'Address', kind: 'text' }, { key: 'EXTERNAL_WEB_SEARCH_API_KEY', label: 'Key', kind: 'secret' }]],
];

const count = (min: number) => (value: unknown) => (value === '' || value === null || (typeof value === 'number' && Number.isInteger(value) && value >= min) ? null : `a whole number from ${min}`);

export const WEB_SEARCH_SECTIONS: SettingSection[] = [
  {
    title: 'Web search',
    note: 'Searching spends the engine’s credits; results are read into chats.',
    fields: [
      { key: 'ENABLE_WEB_SEARCH', label: 'Web search', kind: 'switch' },
      { key: 'WEB_SEARCH_ENGINE', label: 'Engine', kind: 'select', options: ENGINE_OPTIONS, needs: ['ENABLE_WEB_SEARCH'] },
      { key: 'WEB_SEARCH_RESULT_COUNT', label: 'Results to read', kind: 'number', needs: ['ENABLE_WEB_SEARCH'], check: count(1) },
      { key: 'WEB_SEARCH_CONCURRENT_REQUESTS', label: 'Searches at once', kind: 'number', needs: ['ENABLE_WEB_SEARCH'], check: count(0) },
      { key: 'WEB_SEARCH_DOMAIN_FILTER_LIST', label: 'Only these sites', hint: 'Separated by commas; ! before one leaves it out. Empty: any site.', kind: 'list', needs: ['ENABLE_WEB_SEARCH'] },
      { key: 'ENABLE_WEB_SEARCH_CONFIRMATION', label: 'Ask before searching', kind: 'switch', needs: ['ENABLE_WEB_SEARCH'] },
      { key: 'WEB_SEARCH_CONFIRMATION_CONTENT', label: 'What it asks', kind: 'multiline', needs: ['ENABLE_WEB_SEARCH', 'ENABLE_WEB_SEARCH_CONFIRMATION'] },
      { key: 'BYPASS_WEB_SEARCH_EMBEDDING_AND_RETRIEVAL', label: 'Use whole pages', hint: 'Instead of the parts that match best.', kind: 'switch', needs: ['ENABLE_WEB_SEARCH'] },
      { key: 'BYPASS_WEB_SEARCH_WEB_LOADER', label: 'Use only the search’s snippets', kind: 'switch', needs: ['ENABLE_WEB_SEARCH'] },
      { key: 'WEB_FETCH_MAX_CONTENT_LENGTH', label: 'Characters read from a page, at most', kind: 'number', needs: ['ENABLE_WEB_SEARCH'], check: count(0) },
      { key: 'WEB_SEARCH_TRUST_ENV', label: 'Use the server’s proxy settings', kind: 'switch', needs: ['ENABLE_WEB_SEARCH'] },
    ],
  },
  ...ENGINE_FIELDS.map(([engine, fields]) => ({ title: `${ENGINE_OPTIONS.find((option) => option.value === engine)?.label ?? engine} settings`, fields: fields.map((field) => ({ ...field, needs: ['ENABLE_WEB_SEARCH', `WEB_SEARCH_ENGINE=${engine}`] })) })),
  {
    title: 'Reading pages',
    fields: [
      {
        key: 'WEB_LOADER_ENGINE',
        label: 'Pages are read by',
        kind: 'select',
        options: [
          { value: '', label: 'The server' },
          { value: 'playwright', label: 'Playwright' },
          { value: 'firecrawl', label: 'Firecrawl' },
          { value: 'tavily', label: 'Tavily' },
          { value: 'external', label: 'Your own' },
        ],
      },
      { key: 'WEB_LOADER_TIMEOUT', label: 'Seconds per page', kind: 'text' },
      { key: 'WEB_LOADER_CONCURRENT_REQUESTS', label: 'Pages at once', kind: 'number', check: count(0) },
      { key: 'ENABLE_WEB_LOADER_SSL_VERIFICATION', label: 'Check sites’ certificates', kind: 'switch' },
      { key: 'PLAYWRIGHT_WS_URL', label: 'Playwright address', kind: 'text', needs: ['WEB_LOADER_ENGINE=playwright'] },
      { key: 'PLAYWRIGHT_TIMEOUT', label: 'Playwright timeout (ms)', kind: 'number', needs: ['WEB_LOADER_ENGINE=playwright'] },
      { key: 'FIRECRAWL_API_KEY', label: 'Firecrawl key', kind: 'secret', needs: ['WEB_LOADER_ENGINE=firecrawl'] },
      { key: 'FIRECRAWL_API_BASE_URL', label: 'Firecrawl address', kind: 'text', needs: ['WEB_LOADER_ENGINE=firecrawl'] },
      { key: 'TAVILY_API_KEY', label: 'Tavily key', kind: 'secret', needs: ['WEB_LOADER_ENGINE=tavily'] },
      { key: 'TAVILY_EXTRACT_DEPTH', label: 'Tavily depth', kind: 'text', needs: ['WEB_LOADER_ENGINE=tavily'] },
      { key: 'EXTERNAL_WEB_LOADER_URL', label: 'Address', kind: 'text', needs: ['WEB_LOADER_ENGINE=external'] },
      { key: 'EXTERNAL_WEB_LOADER_API_KEY', label: 'Key', kind: 'secret', needs: ['WEB_LOADER_ENGINE=external'] },
    ],
  },
  {
    title: 'YouTube',
    fields: [
      { key: 'YOUTUBE_LOADER_LANGUAGE', label: 'Caption languages', hint: 'Separated by commas, like en, ms.', kind: 'list' },
      { key: 'YOUTUBE_LOADER_PROXY_URL', label: 'Proxy', hint: 'YouTube may block the server without one.', kind: 'secret' },
    ],
  },
];
