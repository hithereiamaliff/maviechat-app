import type { OwuiClient } from './http';
import { textDiffFromUnified, type TextDiff } from './textDiff';

/*
 * Versions of tools, functions and skills (Open WebUI 0.12; 0.11 keeps none). Each save that
 * changes one keeps a version (with a note when one is given) and makes it live. An older one
 * can be made live again: a tool's or function's code is loaded again, as when it was saved; a
 * skill must still be at the version you saw. A version that isn't live can be deleted (the
 * ones after it are linked to the one before). The server compares two versions itself.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const ms = (value: unknown): number => (typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : 0);

export type VersionedKind = 'tools' | 'functions' | 'skills';

/** Versions a page, newest first. */
export const CODE_VERSIONS_PAGE = 20;

const idPath = (kind: VersionedKind, id: string) => `/api/v1/${kind}/id/${encodeURIComponent(id)}`;

export interface CodeVersion {
  id: string;
  /** The version it was saved over (null for the first); what "the one before" means. */
  parentId: string | null;
  /** What the saver wrote about it; empty when nothing. */
  note: string;
  author: string;
  createdAt: number;
}

function versionOf(raw: unknown): CodeVersion | null {
  const row = record(raw);
  const id = text(row.id);
  return id ? { id, parentId: text(row.parent_id) || null, note: text(row.commit_message), author: text(record(row.user).name), createdAt: ms(row.created_at) } : null;
}

/** One page of versions (from 1), newest first (saves in the same second come in no set order: `parentId` links them). */
export async function listCodeVersions(client: OwuiClient, kind: VersionedKind, id: string, page = 1): Promise<CodeVersion[]> {
  return list(await client.get<unknown>(`${idPath(kind, id)}/history`, { query: { page } })).flatMap((raw) => versionOf(raw) ?? []);
}

/** What a version holds: its name, what it's for, its code (a skill's SKILL.md), and a skill's files. */
export interface CodeSnapshot {
  name: string;
  description: string;
  content: string;
  files: { path: string; size: number; binary: boolean }[];
}

/** One version with what it holds. */
export async function getCodeVersion(client: OwuiClient, kind: VersionedKind, id: string, versionId: string): Promise<CodeVersion & { snapshot: CodeSnapshot }> {
  const raw = await client.get<unknown>(`${idPath(kind, id)}/history/${encodeURIComponent(versionId)}`);
  const version = versionOf(raw);
  if (!version) throw new Error('The server didn’t send that version.');
  const snapshot = record(record(raw).snapshot);
  const files = list(record(snapshot.data).files).flatMap((item) => {
    const file = record(item);
    const path = text(file.path);
    return path ? [{ path, size: typeof file.size === 'number' ? file.size : 0, binary: Boolean(file.encoding) }] : [];
  });
  const description = kind === 'skills' ? text(snapshot.description) : text(record(snapshot.meta).description);
  return { ...version, snapshot: { name: text(snapshot.name), description, content: text(snapshot.content), files } };
}

/** Which version is live now (null where the server keeps none). */
export async function liveCodeVersionId(client: OwuiClient, kind: VersionedKind, id: string): Promise<string | null> {
  return text(record(await client.get<unknown>(idPath(kind, id))).version_id) || null;
}

/** Deletes a version that isn't live (the server refuses the live one). */
export async function deleteCodeVersion(client: OwuiClient, kind: VersionedKind, id: string, versionId: string): Promise<void> {
  await client.delete<unknown>(`${idPath(kind, id)}/history/${encodeURIComponent(versionId)}`);
}

/**
 * Makes a version live again. A tool's or function's code is loaded again (refused, with the
 * server's reason, if it no longer loads); a skill must still be at `liveId` (409 otherwise).
 */
export async function makeCodeVersionLive(client: OwuiClient, kind: VersionedKind, id: string, versionId: string, liveId: string | null): Promise<void> {
  await client.post<unknown>(`${idPath(kind, id)}/update/version`, { version_id: versionId, ...(kind === 'skills' ? { expected_version_id: liveId } : {}) });
}

/** A skill's other file that differs between two versions. */
export interface ChangedFile {
  path: string;
  status: 'added' | 'deleted' | 'modified';
  binary: boolean;
}

/** What differs between two versions: name and description where they changed, the code (a skill's SKILL.md) line by line, and a skill's other files. */
export interface VersionComparison {
  changes: { what: 'Name' | 'Description'; before: string; after: string }[];
  diff: TextDiff;
  files: ChangedFile[];
}

const changesOf = (metadata: Tree, kind: VersionedKind): VersionComparison['changes'] => {
  const changes: VersionComparison['changes'] = [];
  const name = record(metadata.name);
  if ('name' in metadata) changes.push({ what: 'Name', before: text(name.before), after: text(name.after) });
  const description = kind === 'skills' ? record(metadata.description) : { before: record(record(metadata.meta).before).description, after: record(record(metadata.meta).after).description };
  if (text(description.before) !== text(description.after)) changes.push({ what: 'Description', before: text(description.before), after: text(description.after) });
  return changes;
};

/** One file of a skill compared between two versions (a binary file isn't compared line by line). */
export async function compareSkillFile(client: OwuiClient, id: string, fromId: string, toId: string, path: string): Promise<{ binary: boolean; diff: TextDiff }> {
  const answer = record(await client.get<unknown>(`${idPath('skills', id)}/history/diff/file`, { query: { from_id: fromId, to_id: toId, path } }));
  return { binary: answer.binary === true, diff: textDiffFromUnified(text(answer.diff), answer.line_endings_only === true) };
}

/** What differs from one version to another, as the server compares them. */
export async function compareCodeVersions(client: OwuiClient, kind: VersionedKind, id: string, fromId: string, toId: string): Promise<VersionComparison> {
  const answer = record(await client.get<unknown>(`${idPath(kind, id)}/history/diff`, { query: { from_id: fromId, to_id: toId } }));
  const changes = changesOf(record(answer.metadata), kind);
  if (kind !== 'skills') return { changes, diff: textDiffFromUnified(text(answer.content_diff), answer.line_endings_only === true), files: [] };
  const files = list(answer.files).flatMap((item): ChangedFile[] => {
    const file = record(item);
    const status = text(file.status);
    return text(file.path) && (status === 'added' || status === 'deleted' || status === 'modified') ? [{ path: text(file.path), status, binary: file.binary === true }] : [];
  });
  const skillMd = files.find((file) => file.path === 'SKILL.md');
  const diff = skillMd ? (await compareSkillFile(client, id, fromId, toId, 'SKILL.md')).diff : { hunks: [], removed: 0, added: 0, lineEndingsOnly: false };
  return { changes, diff, files: files.filter((file) => file.path !== 'SKILL.md') };
}
