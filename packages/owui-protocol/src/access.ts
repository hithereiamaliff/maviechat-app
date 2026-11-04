import type { Capabilities } from './capabilities';
import type { OwuiClient } from './http';
import { grantsOf, type AccessGrant } from './workspaceModels';

/*
 * Who may use or change a Workspace item (Open WebUI 0.11.3): everyone signed in, people and
 * groups, each to read (use) or also write (change). Grants replace each other whole. The server
 * quietly drops what this account may not grant (everyone without `sharing.public_<area>`, people
 * without `access_grants.allow_users`, groups without `access_grants.allow_groups`), so the app
 * says so when the answer keeps less than it sent. Write needs read beside it, as the web sends.
 */

export type AccessArea = 'models' | 'knowledge' | 'prompts' | 'skills' | 'tools';

export interface AccessEntry {
  type: 'user' | 'group';
  id: string;
  write: boolean;
}

export interface AccessState {
  /** Everyone signed in: no, to use it, or to change it too. */
  everyone: 'none' | 'read' | 'write';
  entries: AccessEntry[];
}

export function accessStateOf(grants: AccessGrant[]): AccessState {
  const everyone = grants.some((grant) => grant.principal_type === 'user' && grant.principal_id === '*' && grant.permission === 'write')
    ? 'write'
    : grants.some((grant) => grant.principal_type === 'user' && grant.principal_id === '*')
      ? 'read'
      : 'none';
  const entries = new Map<string, AccessEntry>();
  for (const grant of grants) {
    if (grant.principal_type === 'anyone' || grant.principal_id === '*' || !grant.principal_id) continue;
    const key = `${grant.principal_type}:${grant.principal_id}`;
    const entry = entries.get(key) ?? { type: grant.principal_type, id: grant.principal_id, write: false };
    if (grant.permission === 'write') entry.write = true;
    entries.set(key, entry);
  }
  return { everyone, entries: [...entries.values()] };
}

/** The grants to send: read for each, and write beside it where asked. */
export function grantsFromState(state: AccessState): AccessGrant[] {
  const grants: AccessGrant[] = [];
  if (state.everyone !== 'none') grants.push({ principal_type: 'user', principal_id: '*', permission: 'read' });
  if (state.everyone === 'write') grants.push({ principal_type: 'user', principal_id: '*', permission: 'write' });
  for (const entry of state.entries) {
    grants.push({ principal_type: entry.type, principal_id: entry.id, permission: 'read' });
    if (entry.write) grants.push({ principal_type: entry.type, principal_id: entry.id, permission: 'write' });
  }
  return grants;
}

export interface AccessRights {
  /** The list of people and groups shows (the web hides it without `sharing.<area>`). */
  list: boolean;
  everyone: boolean;
  people: boolean;
  groups: boolean;
}

export function accessRights(capabilities: Capabilities, area: AccessArea): AccessRights {
  if (capabilities.isAdmin) return { list: true, everyone: true, people: true, groups: true };
  return {
    list: capabilities.can(`sharing.${area}`),
    everyone: capabilities.can(`sharing.public_${area}`),
    people: capabilities.can('access_grants.allow_users', true),
    groups: capabilities.can('access_grants.allow_groups', true),
  };
}

function accessRequest(area: AccessArea, id: string, grants: AccessGrant[]): { path: string; body: Record<string, unknown> } {
  const key = encodeURIComponent(id);
  switch (area) {
    case 'models':
      return { path: '/api/v1/models/model/access/update', body: { id, access_grants: grants } };
    case 'knowledge':
      return { path: `/api/v1/knowledge/${key}/access/update`, body: { access_grants: grants } };
    case 'prompts':
      return { path: `/api/v1/prompts/id/${key}/access/update`, body: { access_grants: grants } };
    case 'skills':
      return { path: `/api/v1/skills/id/${key}/access/update`, body: { access_grants: grants } };
    case 'tools':
      return { path: `/api/v1/tools/id/${key}/access/update`, body: { access_grants: grants } };
  }
}

/** Saves who may use an item; answers with the grants the server kept. */
export async function updateAccess(client: OwuiClient, area: AccessArea, id: string, grants: AccessGrant[]): Promise<AccessGrant[]> {
  const { path, body } = accessRequest(area, id, grants);
  const answer = await client.post<unknown>(path, body);
  const kept = typeof answer === 'object' && answer !== null && !Array.isArray(answer) ? (answer as Record<string, unknown>).access_grants : undefined;
  return kept === undefined ? grants : grantsOf(kept);
}

const key = (grant: AccessGrant) => `${grant.principal_type}:${grant.principal_id}:${grant.permission}`;

/** Grants sent that the server didn't keep (this account may not grant them). */
export function droppedGrants(sent: AccessGrant[], kept: AccessGrant[]): AccessGrant[] {
  const keptKeys = new Set(kept.map(key));
  return sent.filter((grant) => !keptKeys.has(key(grant)));
}
