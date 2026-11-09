import type { OwuiClient } from './http';
import { grantsOf, type AccessGrant } from './workspaceModels';

/*
 * Apps (Open WebUI 0.12, Admin → Apps; marked experimental on the web, and off until General's
 * switch turns it on): outside services that join channels, read and answer there. Each has a
 * manifest (its id, name, description, picture, a public key it signs with, and the access it
 * asks for), read from its address with its key, or entered by hand. An admin installs it with
 * the access granted and who may use it, then connects it: the server opens the connection
 * itself. The server only reaches apps over HTTPS (or plain HTTP to private addresses its own
 * settings allow). Uninstalling keeps the app listed, without its key and switched off.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const base = '/api/v1/apps';

/** What an app can ask for, in the server's names, said for reading. */
export const APP_SCOPES: readonly { scope: string; label: string }[] = [
  { scope: 'channels:read', label: 'See the channels it’s in' },
  { scope: 'channels:mentions:read', label: 'Read messages that mention it' },
  { scope: 'channels:messages:read', label: 'Read the messages and history of its channels' },
  { scope: 'channels:messages:write', label: 'Send messages in its channels, and change its own' },
];

export const appScopeLabel = (scope: string): string => APP_SCOPES.find((item) => item.scope === scope)?.label ?? scope;

export interface AppManifest {
  id: string;
  name: string;
  description: string;
  /** A picture's address, or a data address; null without one. */
  picture: string | null;
  /** The key it signs with (Ed25519, PEM). */
  publicKey: string;
  requestedScopes: string[];
}

export function manifestOf(raw: unknown): AppManifest {
  const row = record(raw);
  return { id: text(row.id), name: text(row.name), description: text(row.description), picture: text(row.profile_image_url) || null, publicKey: text(row.public_key), requestedScopes: list(row.requested_scopes).map(text).filter(Boolean) };
}

/** A manifest as the server takes it. */
const manifestBody = (manifest: AppManifest): Tree => ({ id: manifest.id.trim(), name: manifest.name.trim(), description: manifest.description.trim(), profile_image_url: manifest.picture, public_key: manifest.publicKey.trim(), requested_scopes: manifest.requestedScopes });

export type AppConnection = 'connected' | 'connecting' | 'disconnected';

export interface ServerApp {
  id: string;
  slug: string;
  name: string;
  /** On, and connected or connecting. */
  active: boolean;
  /** It has a key; an uninstalled app has none. */
  configured: boolean;
  connection: AppConnection;
  url: string;
  manifest: AppManifest;
  grantedScopes: string[];
  /** Read with the app's details only. */
  accessGrants: AccessGrant[] | null;
}

function appOf(raw: unknown): ServerApp | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const data = record(row.data);
  const status = text(row.connection_status);
  return {
    id,
    slug: text(row.slug),
    name: text(row.name),
    active: row.is_active === true,
    configured: row.configured === true,
    connection: status === 'connected' || status === 'connecting' ? status : 'disconnected',
    url: text(data.url),
    manifest: manifestOf(data.manifest),
    grantedScopes: list(data.granted_scopes).map(text).filter(Boolean),
    accessGrants: Array.isArray(row.access_grants) ? grantsOf(row.access_grants) : null,
  };
}

const appFrom = (raw: unknown): ServerApp => {
  const app = appOf(raw);
  if (!app) throw new Error('The server didn’t describe the app.');
  return app;
};

/** Every app (admins see them all), by name. 404 "Apps are disabled" while they're off. */
export async function listApps(client: OwuiClient): Promise<ServerApp[]> {
  return list(await client.get<unknown>(base)).flatMap((raw) => appOf(raw) ?? []);
}

/** One app with who may use it. */
export async function getApp(client: OwuiClient, id: string): Promise<ServerApp> {
  return appFrom(await client.get<unknown>(`${base}/${encodeURIComponent(id)}`));
}

/**
 * The manifest at an app's address, read by the server with the app's key (for an installed
 * app, its saved key unless another is given). The server's reason when it can't.
 */
export async function previewAppManifest(client: OwuiClient, input: { url: string; apiKey?: string; appId?: string }): Promise<AppManifest> {
  const body: Tree = { url: input.url.trim() };
  if (input.apiKey?.trim()) body.api_key = input.apiKey.trim();
  if (input.appId) body.app_id = input.appId;
  return manifestOf(await client.post<unknown>(`${base}/manifest/preview`, body));
}

/** A short name for an app from its manifest's id, as the web makes one (lower-case letters, digits and dashes, starting with a letter). */
export function appSlugFrom(id: string): string {
  return (
    id
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^[^a-z]+/, '')
      .slice(0, 40) || 'app'
  );
}

export const appSlugProblem = (slug: string): string | null => (/^[a-z][a-z0-9-]{0,39}$/.test(slug) ? null : 'Lower-case letters, digits and dashes, starting with a letter (40 at most).');

/** Everyone may use it: the grant the server gives a new app unless told otherwise. */
export const EVERYONE: AccessGrant = { principal_type: 'user', principal_id: '*', permission: 'read' };
export const forEveryone = (grants: AccessGrant[] | null): boolean => (grants ?? []).some((grant) => grant.principal_id === '*');
/** The grants with everyone's added or taken away; other people and groups kept. */
export const withEveryone = (grants: AccessGrant[], on: boolean): AccessGrant[] => [...grants.filter((grant) => grant.principal_id !== '*'), ...(on ? [EVERYONE] : [])];

/** Installs an app, switched off until it's connected. 409 when its short name is taken. */
export async function installApp(client: OwuiClient, input: { manifest: AppManifest; url: string; apiKey: string; slug: string; grantedScopes: string[]; accessGrants: AccessGrant[] }): Promise<ServerApp> {
  return appFrom(
    await client.post<unknown>(base, { manifest: manifestBody(input.manifest), url: input.url.trim(), api_key: input.apiKey.trim(), slug: input.slug.trim(), granted_scopes: input.grantedScopes, access_grants: input.accessGrants }),
  );
}

/**
 * Changes an installed app: its name, the access granted, who may use it, or (after reading it
 * again) a newer manifest with the access granted from what it now asks for; or switches it off.
 * A newer manifest switches it off until it's connected again.
 */
export async function updateApp(client: OwuiClient, id: string, change: { name?: string; grantedScopes?: string[]; accessGrants?: AccessGrant[]; manifest?: AppManifest; off?: true }): Promise<ServerApp> {
  const body: Tree = {};
  if (change.off) body.is_active = false;
  if (change.name !== undefined) body.name = change.name.trim();
  if (change.grantedScopes !== undefined) body.granted_scopes = change.grantedScopes;
  if (change.accessGrants !== undefined) body.access_grants = change.accessGrants;
  if (change.manifest !== undefined) body.manifest = manifestBody(change.manifest);
  return appFrom(await client.patch<unknown>(`${base}/${encodeURIComponent(id)}`, body));
}

/** Connects an app (the server opens the connection; with a new key when given): on once it answers. */
export async function connectApp(client: OwuiClient, id: string, apiKey?: string): Promise<ServerApp> {
  return appFrom(await client.post<unknown>(`${base}/${encodeURIComponent(id)}/connect`, apiKey?.trim() ? { api_key: apiKey.trim() } : {}, { timeoutMs: 45_000 }));
}

/** Uninstalls an app: its key and channel memberships go, and it's switched off; it stays listed, and its messages stay. */
export async function uninstallApp(client: OwuiClient, id: string): Promise<ServerApp> {
  return appFrom(await client.delete<unknown>(`${base}/${encodeURIComponent(id)}`));
}

/** Whether two manifests differ in anything the server keeps. */
export const manifestChanged = (a: AppManifest, b: AppManifest): boolean => JSON.stringify(manifestBody(a)) !== JSON.stringify(manifestBody(b));

/** What's missing from a manifest typed by hand, in words; null when it's ready. */
export function manifestProblem(manifest: AppManifest): string | null {
  if (!manifest.id.trim()) return 'Enter the app’s id.';
  if (!manifest.name.trim()) return 'Enter its name.';
  if (!/-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----/.test(manifest.publicKey)) return 'Paste its public key (PEM, BEGIN PUBLIC KEY).';
  if (!manifest.requestedScopes.length) return 'Choose what it asks for.';
  return null;
}
