import type { SessionUser } from './auth';
import { OwuiHttpError, type OwuiClient } from './http';

/*
 * Your account (Open WebUI 0.11.3, Settings → Account): your profile (picture, name, bio, gender,
 * birth date), your own variables for system prompts, your password, and your API key.
 */

// ── Profile ──────────────────────────────────────────────────────────────────

export interface Profile {
  name: string;
  /** A data: image, a web address, or one of the server's own (`/user.png` is "no picture"). */
  profile_image_url: string;
  bio: string;
  /** "", "male", "female", or your own words. */
  gender: string;
  /** `YYYY-MM-DD`, or "". */
  date_of_birth: string;
}

/** The server's stand-in picture: "no picture of your own". */
export const DEFAULT_PROFILE_IMAGE = '/user.png';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export function profileOf(user: SessionUser): Profile {
  return {
    name: text(user.name),
    profile_image_url: text(user.profile_image_url),
    bio: text(user.bio),
    gender: text(user.gender),
    date_of_birth: text(user.date_of_birth).slice(0, 10),
  };
}

/**
 * Saves the whole profile, as the web does: the server writes all five fields, so an empty bio,
 * gender or birth date clears it. A picture the server won't take is refused (422).
 */
export function updateProfile(client: OwuiClient, profile: Profile): Promise<SessionUser> {
  return client.post<SessionUser>('/api/v1/auths/update/profile', {
    name: profile.name.trim(),
    profile_image_url: profile.profile_image_url,
    bio: profile.bio.trim() || null,
    gender: profile.gender.trim() || null,
    date_of_birth: profile.date_of_birth.trim() || null,
  });
}

const SERVER_IMAGES = new Set(['', DEFAULT_PROFILE_IMAGE, '/favicon.png', '/static/favicon.png']);
const OWN_IMAGE_ROUTE = /^\/api\/v1\/users\/[^/?#]+\/profile\/image$/;

/** Whether the server takes this as a picture: its own images, a web address with a host, or a PNG, JPEG, GIF or WebP data: image. */
export function acceptedProfileImage(url: string): boolean {
  if (SERVER_IMAGES.has(url) || OWN_IMAGE_ROUTE.test(url)) return true;
  if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(url)) return true;
  return /^https?:\/\/[^/?#:@]+/i.test(url);
}

/** True for a picture you chose, false for none or the server's stand-ins. */
export function hasOwnPicture(url: string | null | undefined): boolean {
  return Boolean(url) && !SERVER_IMAGES.has(url as string) && !(url as string).endsWith(DEFAULT_PROFILE_IMAGE);
}

/** Where to load a picture from; `authed` when it's on your server (send the token). */
export function profileImageSource(url: string | null | undefined, baseUrl: string): { uri: string; authed: boolean } | null {
  if (!url || !hasOwnPicture(url)) return null;
  if (url.startsWith('data:')) return { uri: url, authed: false };
  if (/^https?:\/\//i.test(url)) return { uri: url, authed: url.startsWith(`${baseUrl}/`) };
  if (url.startsWith('/')) return { uri: `${baseUrl}${url}`, authed: true };
  return null;
}

/** The address of your Gravatar picture, as the server works it out from your email. */
export function gravatarUrl(client: OwuiClient, email: string): Promise<string> {
  return client.get<string>('/api/v1/utils/gravatar', { query: { email } });
}

/** A birth date as typed: `YYYY-MM-DD` and a real day, or empty. */
export function validBirthDate(value: string): boolean {
  const date = value.trim();
  if (!date) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day && year >= 1900;
}

// ── Your variables ───────────────────────────────────────────────────────────

/** A variable's name: lower case, starting with a letter, then letters, digits or underscores. */
export const VARIABLE_KEY = /^[a-z][a-z0-9_]*$/;
export const VARIABLE_VALUE_LIMIT = 20_000;
export const VARIABLES_TOTAL_LIMIT = 100_000;

export interface Variable {
  key: string;
  value: string;
}

/** Your variables, in the order the server keeps them. */
export async function getUserVariables(client: OwuiClient): Promise<Variable[]> {
  const raw = await client.get<{ variables?: unknown }>('/api/v1/users/user/variables');
  const variables = raw && typeof raw.variables === 'object' && raw.variables !== null ? (raw.variables as Record<string, unknown>) : {};
  return Object.entries(variables)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, value]) => ({ key, value }));
}

/** Replaces them all (the server's own checks match `variablesProblem`). */
export async function updateUserVariables(client: OwuiClient, variables: Variable[]): Promise<Variable[]> {
  const body = Object.fromEntries(variables.map(({ key, value }) => [key, value.replace(/\r\n/g, '\n')]));
  await client.post<unknown>('/api/v1/users/user/variables/update', { variables: body });
  return variables;
}

/** Why the server would refuse these, or null. */
export function variablesProblem(variables: Variable[]): string | null {
  const seen = new Set<string>();
  for (const { key, value } of variables) {
    if (!VARIABLE_KEY.test(key)) return `“${key || '(empty)'}” can’t be a name: use lower-case letters, digits and _, starting with a letter.`;
    if (seen.has(key)) return `There are two variables called “${key}”.`;
    seen.add(key);
    if (value.length > VARIABLE_VALUE_LIMIT) return `“${key}” is longer than ${VARIABLE_VALUE_LIMIT.toLocaleString('en')} characters.`;
  }
  const total = JSON.stringify(Object.fromEntries(variables.map(({ key, value }) => [key, value]))).length;
  if (total > VARIABLES_TOTAL_LIMIT) return `Your variables add up to more than ${VARIABLES_TOTAL_LIMIT.toLocaleString('en')} characters.`;
  return null;
}

/** How a system prompt uses one. */
export const variableTag = (key: string) => `{{user.variables.${key}}}`;

// ── Password ─────────────────────────────────────────────────────────────────

/**
 * Changes your password. The server then signs you out everywhere (your token stops working), so
 * sign in again with the new one. A wrong current password, or one your admin's rules refuse, is a 400.
 */
export function updatePassword(client: OwuiClient, current: string, next: string): Promise<boolean> {
  return client.post<boolean>('/api/v1/auths/update/password', { password: current, new_password: next });
}

// ── API key ──────────────────────────────────────────────────────────────────

/** Your API key, or null when you have none. Refused (403) unless the admin allows API keys for you. */
export async function getApiKey(client: OwuiClient): Promise<string | null> {
  try {
    const raw = await client.get<{ api_key?: unknown }>('/api/v1/auths/api_key');
    return typeof raw?.api_key === 'string' && raw.api_key ? raw.api_key : null;
  } catch (error) {
    if (error instanceof OwuiHttpError && error.status === 404) return null;
    throw error;
  }
}

/** A new key, replacing the one you had (one per account). */
export async function createApiKey(client: OwuiClient): Promise<string> {
  const raw = await client.post<{ api_key?: unknown }>('/api/v1/auths/api_key');
  if (typeof raw?.api_key !== 'string') throw new Error('The server sent no key.');
  return raw.api_key;
}

export function deleteApiKey(client: OwuiClient): Promise<boolean> {
  return client.delete<boolean>('/api/v1/auths/api_key');
}

/** A secret shown without giving it away: its start and its last four. */
export function maskSecret(secret: string): string {
  if (secret.length <= 10) return '•'.repeat(secret.length);
  return `${secret.slice(0, 3)}${'•'.repeat(8)}${secret.slice(-4)}`;
}
