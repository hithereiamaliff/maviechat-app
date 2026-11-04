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

export type SettingKind = 'switch' | 'text' | 'multiline' | 'number' | 'select' | 'secret';

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
  optionsFrom?: 'groups';
  /** Shown only while these switches (keys on the same page) are on. */
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

/** A stored value as the form shows it. */
export function formValue(field: SettingField, stored: unknown): string | boolean {
  if (field.kind === 'switch') return stored === true;
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
  return (field.needs ?? []).every((key) => values[key] === true);
}

/** The page's values with the edits laid over, in stored form. */
export function settingValues(fields: SettingField[], stored: Tree, edits: SettingEdits): Tree {
  const values: Tree = { ...stored };
  for (const field of fields) if (field.key in edits) values[field.key] = storedValue(field, edits[field.key] as string | boolean, stored[field.key]);
  return values;
}

const same = (a: unknown, b: unknown) => a === b || (typeof a === 'number' && typeof b === 'string' && String(a) === b.trim()) || (typeof b === 'number' && typeof a === 'string' && String(b) === a.trim());

/** The keys an admin changed (their stored form differs from what's stored). */
export function settingChanges(fields: SettingField[], stored: Tree, edits: SettingEdits): string[] {
  return fields.filter((field) => field.key in edits && !same(storedValue(field, edits[field.key] as string | boolean, stored[field.key]), stored[field.key])).map((field) => field.key);
}

/** Problems that stop a save: each changed field's own check. */
export function settingProblems(fields: SettingField[], stored: Tree, edits: SettingEdits): string[] {
  const changed = new Set(settingChanges(fields, stored, edits));
  return fields.flatMap((field) => {
    if (!changed.has(field.key) || !field.check) return [];
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
