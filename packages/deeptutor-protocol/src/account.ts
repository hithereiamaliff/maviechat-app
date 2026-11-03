import type { DtClient } from './http';

/** `GET /api/auth/profile`: who you are on DeepTutor. Unknown fields are kept. */
export interface DtProfile {
  id: string;
  username: string;
  role: string;
  created_at?: string;
  /** "standard", "custom" or "learner" (a learner sees only chat and some learning). */
  preset?: string;
  avatar?: string;
  /** Still the password an admin gave you. */
  must_change_password?: boolean;
  can_change_password?: boolean;
  [key: string]: unknown;
}

export function getProfile(client: DtClient): Promise<DtProfile> {
  return client.get<DtProfile>('/api/auth/profile');
}

/** At least 8 characters, and different from the current one (DeepTutor checks both). */
export const MIN_PASSWORD_LENGTH = 8;

/** Changes your own password. Signed-in devices stay signed in (DeepTutor's tokens don't depend on it). */
export async function changePassword(client: DtClient, currentPassword: string, newPassword: string): Promise<void> {
  await client.send('PUT', '/api/auth/profile/password', { body: { current_password: currentPassword, new_password: newPassword } });
}

/** `GET /api/settings/ui`: the account's theme and its two languages (DeepTutor's own interface, and replies). */
export interface DtUiSettings {
  theme?: string;
  language?: string;
  response_language?: string;
  [key: string]: unknown;
}

export function getUiSettings(client: DtClient): Promise<DtUiSettings> {
  return client.get<DtUiSettings>('/api/settings/ui');
}

/** Changes only the fields given (`PUT /api/settings/ui` merges). */
export function updateUiSettings(client: DtClient, change: Partial<Pick<DtUiSettings, 'language' | 'response_language'>>): Promise<DtUiSettings> {
  return client.send<DtUiSettings>('PUT', '/api/settings/ui', { body: change }).then((response) => response.data);
}

/** The languages DeepTutor can reply in (its `response_language` values, 1.7.1), with our names for them. */
export const REPLY_LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ms', name: 'Malay' },
  { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'zh-tw', name: 'Chinese (Traditional)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ru', name: 'Russian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'pl', name: 'Polish' },
  { code: 'de', name: 'German' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
];

/** A starting point DeepTutor suggests from what it remembers about you: a short label, and the prompt it fills in. */
export interface DtSuggestion {
  label: string;
  prompt: string;
}

export interface DtSuggestions {
  suggestions: DtSuggestion[];
  /** True while DeepTutor writes a fresh set (asking again shortly gets it). */
  stale: boolean;
}

function suggestionsOf(raw: { suggestions?: unknown; stale?: unknown } | null | undefined): DtSuggestions {
  const items = Array.isArray(raw?.suggestions) ? raw.suggestions : [];
  return {
    suggestions: items.flatMap((item): DtSuggestion[] => {
      const { label, prompt } = (item ?? {}) as Record<string, unknown>;
      return typeof label === 'string' && typeof prompt === 'string' && label.trim() && prompt.trim() ? [{ label: label.trim(), prompt }] : [];
    }),
    stale: raw?.stale === true,
  };
}

/** Ideas for your home screen. Answers at once; an empty list means DeepTutor has nothing to go on yet. */
export async function getSuggestions(client: DtClient): Promise<DtSuggestions> {
  return suggestionsOf(await client.get<{ suggestions?: unknown; stale?: unknown }>('/api/dashboard/suggestions'));
}

/** A different set, written now (this asks DeepTutor's model, so it takes a few seconds). */
export async function refreshSuggestions(client: DtClient): Promise<DtSuggestions> {
  return suggestionsOf(await client.post<{ suggestions?: unknown; stale?: unknown }>('/api/dashboard/suggestions/refresh'));
}
