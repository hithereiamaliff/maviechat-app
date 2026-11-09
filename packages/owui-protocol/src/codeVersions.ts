import type { OwuiClient } from './http';
import { diffText, textDiffFromUnified, type TextDiff } from './textDiff';

/*
 * Versions of tools, functions, skills and models (Open WebUI 0.12; 0.11 keeps none). Each save
 * that changes one keeps a version (with a note when one is given) and makes it live. An older
 * one can be made live again: a tool's or function's code is loaded again, as when it was saved;
 * a skill must still be at the version you saw; a model's base model, knowledge, tools and the
 * rest it uses are checked again. A version that isn't live can be deleted (the ones after it are
 * linked to the one before). The server compares two versions of code itself; two versions of a
 * model are compared here, setting by setting.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const ms = (value: unknown): number => (typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : 0);

export type VersionedKind = 'tools' | 'functions' | 'skills' | 'models';

/** Versions a page, newest first. */
export const CODE_VERSIONS_PAGE = 20;

type Route = { path: string; query: Record<string, string> };

/** Where each kind keeps its versions: a model's by `?id=`, the rest by their path. */
function routes(kind: VersionedKind, id: string) {
  if (kind === 'models') {
    const query = { id };
    return {
      item: { path: '/api/v1/models/model', query },
      history: { path: '/api/v1/models/model/history', query },
      version: (versionId: string): Route => ({ path: `/api/v1/models/model/history/${encodeURIComponent(versionId)}`, query }),
      makeLive: { path: '/api/v1/models/model/update/version', query },
    };
  }
  const base = `/api/v1/${kind}/id/${encodeURIComponent(id)}`;
  return {
    item: { path: base, query: {} },
    history: { path: `${base}/history`, query: {} },
    version: (versionId: string): Route => ({ path: `${base}/history/${encodeURIComponent(versionId)}`, query: {} }),
    makeLive: { path: `${base}/update/version`, query: {} },
  };
}

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
  const route = routes(kind, id).history;
  return list(await client.get<unknown>(route.path, { query: { ...route.query, page } })).flatMap((raw) => versionOf(raw) ?? []);
}

/** A model's setting, by its place in its saved settings (`params.temperature`, `meta.toolIds`…). */
export interface ModelSetting {
  path: string;
  value: unknown;
}

/** What a version holds. */
export interface CodeSnapshot {
  name: string;
  description: string;
  /** Its code: a skill's SKILL.md; a model's system prompt. */
  content: string;
  /** A skill's files. */
  files: { path: string; size: number; binary: boolean }[];
  /** A model's base model ('' for a connection's own). */
  baseModelId: string;
  /** A model's other settings that are set. */
  settings: ModelSetting[];
}

/** Every setting that's set, one by one; lists stay whole, and empty values count as not set. */
function settingsOf(prefix: string, value: unknown, out: ModelSetting[] = []): ModelSetting[] {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value as Tree)) settingsOf(prefix ? `${prefix}.${key}` : key, inner, out);
  } else if (value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && !value.length)) out.push({ path: prefix, value });
  return out;
}

function snapshotOf(kind: VersionedKind, raw: Tree): CodeSnapshot {
  const meta = record(raw.meta);
  if (kind === 'models') {
    const params = record(raw.params);
    const { system, ...otherParams } = params;
    const { description, ...otherMeta } = meta;
    return { name: text(raw.name), description: text(description), content: text(system), files: [], baseModelId: text(raw.base_model_id), settings: [...settingsOf('params', otherParams), ...settingsOf('meta', otherMeta)] };
  }
  const files = list(record(raw.data).files).flatMap((item) => {
    const file = record(item);
    const path = text(file.path);
    return path ? [{ path, size: typeof file.size === 'number' ? file.size : 0, binary: Boolean(file.encoding) }] : [];
  });
  return { name: text(raw.name), description: kind === 'skills' ? text(raw.description) : text(meta.description), content: text(raw.content), files, baseModelId: '', settings: [] };
}

/** One version with what it holds. */
export async function getCodeVersion(client: OwuiClient, kind: VersionedKind, id: string, versionId: string): Promise<CodeVersion & { snapshot: CodeSnapshot }> {
  const route = routes(kind, id).version(versionId);
  const raw = await client.get<unknown>(route.path, { query: route.query });
  const version = versionOf(raw);
  if (!version) throw new Error('The server didn’t send that version.');
  return { ...version, snapshot: snapshotOf(kind, record(record(raw).snapshot)) };
}

/** Which version is live now (null where the server keeps none). */
export async function liveCodeVersionId(client: OwuiClient, kind: VersionedKind, id: string): Promise<string | null> {
  const route = routes(kind, id).item;
  return text(record(await client.get<unknown>(route.path, { query: route.query })).version_id) || null;
}

/** Deletes a version that isn't live (the server refuses the live one). */
export async function deleteCodeVersion(client: OwuiClient, kind: VersionedKind, id: string, versionId: string): Promise<void> {
  const route = routes(kind, id).version(versionId);
  await client.delete<unknown>(route.path, { query: route.query });
}

/**
 * Makes a version live again. A tool's or function's code is loaded again (refused, with the
 * server's reason, if it no longer loads); a skill must still be at `liveId` (409 otherwise); a
 * model is refused, with the reason, when something it uses is gone or out of reach.
 */
export async function makeCodeVersionLive(client: OwuiClient, kind: VersionedKind, id: string, versionId: string, liveId: string | null): Promise<void> {
  const route = routes(kind, id).makeLive;
  await client.post<unknown>(route.path, { version_id: versionId, ...(kind === 'skills' ? { expected_version_id: liveId } : {}) }, { query: route.query });
}

/** A skill's other file that differs between two versions. */
export interface ChangedFile {
  path: string;
  status: 'added' | 'deleted' | 'modified';
  binary: boolean;
}

/** One thing that differs, said for reading: what, and its value before and after. */
export interface VersionChange {
  what: string;
  before: string;
  after: string;
}

/** What differs between two versions: names, descriptions and settings where they changed, the code (a skill's SKILL.md, a model's system prompt) line by line, and a skill's other files. */
export interface VersionComparison {
  changes: VersionChange[];
  diff: TextDiff;
  files: ChangedFile[];
}

const MAX_SHOWN = 80;
const shortly = (value: string) => (value.length > MAX_SHOWN ? `${value.slice(0, MAX_SHOWN - 1)}…` : value);
const quoted = (value: string) => (value ? `“${shortly(value)}”` : 'none');

/** Names for a model's settings, as its editor groups them. */
const META_LABELS: Record<string, string> = {
  capabilities: 'Capabilities',
  toolIds: 'Tools',
  skillIds: 'Skills',
  filterIds: 'Filters',
  defaultFilterIds: 'Filters on by default',
  actionIds: 'Actions',
  knowledge: 'Knowledge',
  suggestion_prompts: 'Prompt suggestions',
  tags: 'Tags',
  builtinTools: 'Built-in tools',
  defaultFeatureIds: 'Features on by default',
  profile_image_url: 'Picture',
  background_image_url: 'Background',
  terminalId: 'Terminal',
};

/** A setting's place, for reading: `params.temperature` as "Parameters › temperature". */
export function settingLabel(path: string): string {
  const [root = '', key = '', ...rest] = path.split('.');
  if (root === 'params') return ['Parameters', key, ...rest].join(' › ');
  if (root === 'meta') return [META_LABELS[key] ?? key, ...rest].join(' › ');
  return path;
}

const PICTURES = new Set(['meta.profile_image_url', 'meta.background_image_url']);

/** A setting's value, for reading: lists by their items' names, pictures not spelled out. */
export function settingText(path: string, value: unknown): string {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return 'not set';
  if (PICTURES.has(path)) return 'a picture';
  if (typeof value === 'string') return quoted(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return shortly(value.map((item) => (typeof item === 'object' && item !== null ? text(record(item).name) || text(record(item).id) || JSON.stringify(item) : String(item))).join(', '));
  return shortly(JSON.stringify(value));
}

/** Two saved models compared here: name, base model, description, then each setting that differs; the system prompt line by line. */
export function compareModelSnapshots(before: CodeSnapshot, after: CodeSnapshot): VersionComparison {
  const changes: VersionChange[] = [];
  if (before.name !== after.name) changes.push({ what: 'Name', before: quoted(before.name), after: quoted(after.name) });
  if (before.baseModelId !== after.baseModelId) changes.push({ what: 'Base model', before: before.baseModelId || 'none', after: after.baseModelId || 'none' });
  if (before.description !== after.description) changes.push({ what: 'Description', before: quoted(before.description), after: quoted(after.description) });
  const was = new Map(before.settings.map((setting) => [setting.path, setting.value]));
  const now = new Map(after.settings.map((setting) => [setting.path, setting.value]));
  for (const path of [...new Set([...was.keys(), ...now.keys()])].sort()) {
    const a = was.get(path);
    const b = now.get(path);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const picture = PICTURES.has(path) && a !== undefined && b !== undefined;
    changes.push({ what: settingLabel(path), before: settingText(path, a), after: picture ? 'another picture' : settingText(path, b) });
  }
  return { changes, diff: diffText(before.content, after.content), files: [] };
}

const changesOf = (metadata: Tree, kind: VersionedKind): VersionChange[] => {
  const changes: VersionChange[] = [];
  const name = record(metadata.name);
  if ('name' in metadata) changes.push({ what: 'Name', before: quoted(text(name.before)), after: quoted(text(name.after)) });
  const description = kind === 'skills' ? record(metadata.description) : { before: record(record(metadata.meta).before).description, after: record(record(metadata.meta).after).description };
  if (text(description.before) !== text(description.after)) changes.push({ what: 'Description', before: quoted(text(description.before)), after: quoted(text(description.after)) });
  return changes;
};

/** One file of a skill compared between two versions (a binary file isn't compared line by line). */
export async function compareSkillFile(client: OwuiClient, id: string, fromId: string, toId: string, path: string): Promise<{ binary: boolean; diff: TextDiff }> {
  const answer = record(await client.get<unknown>(`${routes('skills', id).history.path}/diff/file`, { query: { from_id: fromId, to_id: toId, path } }));
  return { binary: answer.binary === true, diff: textDiffFromUnified(text(answer.diff), answer.line_endings_only === true) };
}

/** What differs from one version to another: as the server compares code; a model's two versions read and compared here. */
export async function compareCodeVersions(client: OwuiClient, kind: VersionedKind, id: string, fromId: string, toId: string): Promise<VersionComparison> {
  if (kind === 'models') {
    const [before, after] = await Promise.all([getCodeVersion(client, kind, id, fromId), getCodeVersion(client, kind, id, toId)]);
    return compareModelSnapshots(before.snapshot, after.snapshot);
  }
  const answer = record(await client.get<unknown>(`${routes(kind, id).history.path}/diff`, { query: { from_id: fromId, to_id: toId } }));
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
