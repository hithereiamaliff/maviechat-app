import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import {
  AUTHENTICATION_SECTIONS,
  CHAT_SECTIONS,
  CODE_EXECUTION_SECTIONS,
  WEB_SEARCH_SECTIONS,
  describeSettingChange,
  formValue,
  GENERAL_SECTIONS,
  getBanners,
  saveBanners,
  settingChanges,
  settingConflicts,
  settingProblems,
  settingShown,
  settingsPayload,
  settingValues,
  storedValue,
  type SettingField,
} from './adminSettings';

const fields = [...GENERAL_SECTIONS, ...AUTHENTICATION_SECTIONS].flatMap((section) => section.fields);
const field = (key: string) => fields.find((item) => item.key === key) as SettingField;
const STORED = { ENABLE_FOLDERS: true, FOLDER_MAX_FILE_COUNT: '', ENABLE_SIGNUP: false, DEFAULT_USER_ROLE: 'pending', RESPONSE_WATERMARK: null, JWT_EXPIRES_IN: '4w', ADMIN_EMAIL: null, AUTOMATION_MAX_COUNT: '' };

describe('admin settings form', () => {
  it('shows stored values as the form edits them, and keeps their types going back', () => {
    expect(formValue(field('FOLDER_MAX_FILE_COUNT'), '')).toBe('');
    expect(formValue(field('FOLDER_MAX_FILE_COUNT'), 12)).toBe('12');
    expect(storedValue(field('FOLDER_MAX_FILE_COUNT'), '12', '')).toBe(12);
    expect(storedValue(field('FOLDER_MAX_FILE_COUNT'), ' ', 12)).toBe('');
    expect(storedValue(field('RESPONSE_WATERMARK'), '', null)).toBeNull();
    expect(storedValue(field('ENABLE_SIGNUP'), true, false)).toBe(true);
  });

  it('finds no change when nothing was touched, or touched back', () => {
    expect(settingChanges(fields, STORED, {})).toEqual([]);
    expect(settingChanges(fields, STORED, { RESPONSE_WATERMARK: '', FOLDER_MAX_FILE_COUNT: '', JWT_EXPIRES_IN: '4w', ENABLE_SIGNUP: false })).toEqual([]);
    expect(settingChanges(fields, { FOLDER_MAX_FILE_COUNT: 5 }, { FOLDER_MAX_FILE_COUNT: '5' })).toEqual([]);
    expect(settingChanges(fields, STORED, { ENABLE_SIGNUP: true, JWT_EXPIRES_IN: '7d' })).toEqual(['ENABLE_SIGNUP', 'JWT_EXPIRES_IN']);
  });

  it('lays only the changes over a fresh read, everything else as it came', () => {
    const fresh = { ...STORED, ENABLE_FOLDERS: false, UNKNOWN_EXTRA: { keep: true } };
    const payload = settingsPayload(fields, fresh, STORED, { ENABLE_SIGNUP: true, DEFAULT_USER_ROLE: 'pending' });
    expect(payload).toEqual({ ...fresh, ENABLE_SIGNUP: true });
    // The admin switched folders off while someone else did the same on the server: both touched it.
    expect(settingConflicts(fields, STORED, fresh, { ENABLE_FOLDERS: false })).toEqual(['ENABLE_FOLDERS']);
    expect(settingConflicts(fields, STORED, fresh, { ENABLE_SIGNUP: true })).toEqual([]);
  });

  it('checks durations and limits as the server reads them', () => {
    expect(settingProblems(fields, STORED, { JWT_EXPIRES_IN: '12h' })).toEqual([]);
    // The server takes one number and unit only: a pair like this would be silently dropped.
    expect(settingProblems(fields, STORED, { JWT_EXPIRES_IN: '1d12h' })).toHaveLength(1);
    expect(settingProblems(fields, STORED, { JWT_EXPIRES_IN: '-1' })).toEqual([]);
    expect(settingProblems(fields, STORED, { JWT_EXPIRES_IN: 'forever' })).toHaveLength(1);
    expect(settingProblems(fields, STORED, { FOLDER_MAX_FILE_COUNT: '2.5' })).toHaveLength(1);
    expect(settingProblems(fields, STORED, { FOLDER_MAX_FILE_COUNT: '' })).toEqual([]);
  });

  it('shows dependent fields only when what they need is on', () => {
    const values = settingValues(fields, STORED, { ENABLE_FOLDERS: false });
    expect(settingShown(field('FOLDER_MAX_FILE_COUNT'), values)).toBe(false);
    expect(settingShown(field('FOLDER_MAX_FILE_COUNT'), STORED)).toBe(true);
    expect(settingShown(field('ADMIN_EMAIL'), STORED)).toBe(false);
  });

  it('says what changes, never a secret, and asks before making everyone an admin', () => {
    expect(describeSettingChange(field('DEFAULT_USER_ROLE'), 'pending', 'admin')).toBe('New accounts are: “Waiting for approval” → “Admins”');
    expect(describeSettingChange({ key: 'K', label: 'Key', kind: 'secret' }, 'old-secret', 'new-secret')).toBe('Key: changed');
    expect(describeSettingChange(field('FOLDER_MAX_FILE_COUNT'), '', 10)).toBe('Files a folder can hold: no limit → “10”');
    expect(field('DEFAULT_USER_ROLE').confirm?.('admin')).toBeTruthy();
    expect(field('DEFAULT_USER_ROLE').confirm?.('user')).toBeNull();
  });

  it('sends banners whole, an empty title as none', async () => {
    const calls: unknown[] = [];
    const fetch: FetchLike = async (_url, init) => {
      calls.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
      return new Response('[]', { status: 200 });
    };
    await saveBanners(new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), [{ id: 'b1', type: 'warning', title: '', content: 'Down at 9', dismissible: true, timestamp: 1_730_000_000 }]);
    expect(calls[0]).toEqual({ banners: [{ id: 'b1', type: 'warning', title: null, content: 'Down at 9', dismissible: true, timestamp: 1_730_000_000 }] });
  });

  it('keeps what else a banner has (0.12’s translations) through a read and a save', async () => {
    const stored = [{ id: 'b1', type: 'info', title: 'Hi', content: 'Hello', dismissible: true, timestamp: 1, i18n: { ms: { content: 'Helo' } } }];
    const calls: unknown[] = [];
    const fetch: FetchLike = async (_url, init) => {
      if (init?.method === 'POST') calls.push(typeof init.body === 'string' ? JSON.parse(init.body) : undefined);
      return new Response(JSON.stringify(stored), { status: 200 });
    };
    const client = new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch });
    const read = await getBanners(client);
    expect(read[0]?.extra).toEqual({ i18n: { ms: { content: 'Helo' } } });
    await saveBanners(client, read);
    expect(calls[0]).toEqual({ banners: stored });
  });
});

describe('more admin settings pages', () => {
  const code = CODE_EXECUTION_SECTIONS.flatMap((section) => section.fields);
  const chat = CHAT_SECTIONS.flatMap((section) => section.fields);
  const find = (fields: SettingField[], key: string) => fields.find((item) => item.key === key) as SettingField;

  it('shows Jupyter settings only for Jupyter, and its token only for token sign-in', () => {
    const stored = { ENABLE_CODE_EXECUTION: true, CODE_EXECUTION_ENGINE: 'pyodide', CODE_EXECUTION_JUPYTER_AUTH: '' };
    expect(settingShown(find(code, 'CODE_EXECUTION_JUPYTER_URL'), stored)).toBe(false);
    const jupyter = settingValues(code, stored, { CODE_EXECUTION_ENGINE: 'jupyter', CODE_EXECUTION_JUPYTER_AUTH: 'token' });
    expect(settingShown(find(code, 'CODE_EXECUTION_JUPYTER_URL'), jupyter)).toBe(true);
    expect(settingShown(find(code, 'CODE_EXECUTION_JUPYTER_AUTH_TOKEN'), jupyter)).toBe(true);
    expect(settingShown(find(code, 'CODE_EXECUTION_JUPYTER_AUTH_PASSWORD'), jupyter)).toBe(false);
    expect(find(code, 'CODE_EXECUTION_JUPYTER_AUTH_TOKEN').kind).toBe('secret');
  });

  it('keeps numbers within what the server takes', () => {
    const stored = { ENABLE_CONTEXT_COMPACTION: true, CONTEXT_COMPACTION_RETENTION_PERCENTAGE: 40, CONTEXT_COMPACTION_TOKEN_CAP: null };
    expect(settingProblems(chat, stored, { CONTEXT_COMPACTION_RETENTION_PERCENTAGE: '60' })).toHaveLength(1);
    expect(settingProblems(chat, stored, { CONTEXT_COMPACTION_RETENTION_PERCENTAGE: '25' })).toEqual([]);
    expect(settingChanges(chat, stored, { CONTEXT_COMPACTION_TOKEN_CAP: '' })).toEqual([]);
  });
});

describe('web search settings', () => {
  const web = WEB_SEARCH_SECTIONS.flatMap((section) => section.fields);
  const STORED = { ENABLE_WEB_SEARCH: true, WEB_SEARCH_ENGINE: 'brave', WEB_SEARCH_DOMAIN_FILTER_LIST: ['a.test', '!b.test'], YOUTUBE_LOADER_LANGUAGE: null, BRAVE_SEARCH_API_KEY: 'k', LINKUP_SEARCH_PARAMS: { depth: 'deep' } };

  it('edits lists as text and stores them as lists', () => {
    const domains = web.find((field) => field.key === 'WEB_SEARCH_DOMAIN_FILTER_LIST') as SettingField;
    expect(formValue(domains, STORED.WEB_SEARCH_DOMAIN_FILTER_LIST)).toBe('a.test, !b.test');
    expect(settingChanges(web, STORED, { WEB_SEARCH_DOMAIN_FILTER_LIST: 'a.test,  !b.test' })).toEqual([]);
    expect(settingsPayload(web, STORED, STORED, { WEB_SEARCH_DOMAIN_FILTER_LIST: 'a.test' }).WEB_SEARCH_DOMAIN_FILTER_LIST).toEqual(['a.test']);
    expect(settingChanges(web, STORED, { YOUTUBE_LOADER_LANGUAGE: '' })).toEqual([]);
  });

  it('counts a key shared by several engines once, and shows only the chosen engine’s fields', () => {
    expect(settingChanges(web, STORED, { BRAVE_SEARCH_API_KEY: 'k2' })).toEqual(['BRAVE_SEARCH_API_KEY']);
    const shown = web.filter((field) => settingShown(field, STORED)).map((field) => field.key);
    expect(shown).toContain('BRAVE_SEARCH_API_KEY');
    expect(shown).not.toContain('TAVILY_API_KEY');
    const payload = settingsPayload(web, STORED, STORED, { ENABLE_WEB_SEARCH: false });
    expect(payload.LINKUP_SEARCH_PARAMS).toEqual({ depth: 'deep' });
  });
});
