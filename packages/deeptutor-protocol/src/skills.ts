import type { DtClient } from './http';

/*
 * Skills (DeepTutor 1.7.1): playbooks the model reads when a chat needs them, each a Markdown file
 * whose header holds its name, description, tags and settings (`always` puts it in every turn,
 * `requires` names what it needs on the server). Yours are editable; built-in ones and those an
 * admin assigned you are read-only. Saving a body replaces the whole file, so an edit sends the
 * header it came with. Tags come from the library's own list.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export type DtSkillSource = 'user' | 'builtin' | 'admin';

export interface DtSkill {
  name: string;
  description: string;
  tags: string[];
  source: DtSkillSource;
  readOnly: boolean;
  /** An admin's skill given to you. */
  assigned: boolean;
}

export interface DtSkillFile extends DtSkill {
  /** The whole file, header included. */
  content: string;
}

const skillPath = (name: string) => `/api/skills/${encodeURIComponent(name)}`;
const tagPath = (tag: string) => `/api/skills/tags/${encodeURIComponent(tag)}`;

function skillOf(raw: unknown): DtSkill | null {
  const row = record(raw);
  const name = text(row.name);
  if (!name) return null;
  const source: DtSkillSource = row.source === 'builtin' || row.source === 'admin' ? row.source : 'user';
  return {
    name,
    description: text(row.description),
    tags: list(row.tags).map(text).filter(Boolean),
    source,
    readOnly: row.read_only === true || source !== 'user',
    assigned: row.assigned === true,
  };
}

function skillFrom(raw: unknown): DtSkill {
  const skill = skillOf(raw);
  if (!skill) throw new Error('DeepTutor did not describe the skill');
  return skill;
}

/** Yours, then those assigned to you, then the built-in ones. */
export async function listSkills(client: DtClient): Promise<DtSkill[]> {
  const raw = await client.get<unknown>('/api/skills/list');
  return (Array.isArray(raw) ? raw : list(record(raw).skills)).flatMap((row) => (typeof row === 'string' ? [{ name: row, description: '', tags: [], source: 'user' as const, readOnly: false, assigned: false }] : (skillOf(row) ?? [])));
}

export async function getSkill(client: DtClient, name: string): Promise<DtSkillFile> {
  const raw = await client.get<unknown>(skillPath(name));
  return { ...skillFrom(raw), content: text(record(raw).content) };
}

/** A new skill of yours; `content` without a header gets one from DeepTutor. */
export async function createSkill(client: DtClient, input: { name: string; description: string; content: string; tags: string[] }): Promise<DtSkill> {
  return skillFrom(await client.post<unknown>('/api/skills/create', { name: input.name, description: input.description, content: input.content, tags: input.tags }));
}

/**
 * Changes one of yours. `content` replaces the whole file (send the header it came with; see
 * `joinFrontMatter`), then DeepTutor writes the description, tags and new name into it. Leave
 * `content` out when only those changed.
 */
export async function updateSkill(client: DtClient, name: string, change: { description?: string; content?: string; tags?: string[]; renameTo?: string }): Promise<DtSkill> {
  const body: Tree = {};
  if (change.description !== undefined) body.description = change.description;
  if (change.content !== undefined) body.content = change.content;
  if (change.tags !== undefined) body.tags = change.tags;
  if (change.renameTo && change.renameTo !== name) body.rename_to = change.renameTo;
  return skillFrom((await client.send<unknown>('PUT', skillPath(name), { body })).data);
}

export async function deleteSkill(client: DtClient, name: string): Promise<void> {
  await client.delete<unknown>(skillPath(name));
}

// ── Tags ─────────────────────────────────────────────────────────────────────

/** Tags DeepTutor accepts: lowercase letters and digits, then also dashes, spaces and underscores, 32 at most. */
export const SKILL_TAG_PATTERN = /^[a-z0-9][a-z0-9\- _]{0,31}$/;

/** A tag as typed, the way DeepTutor stores it. */
export const cleanTag = (input: string): string => input.trim().toLowerCase();

export function tagProblem(tag: string): string | null {
  if (!tag) return 'Type a tag.';
  if (!SKILL_TAG_PATTERN.test(tag)) return 'Letters, digits, dashes, spaces and underscores, starting with a letter or digit (32 at most).';
  return null;
}

export async function listSkillTags(client: DtClient): Promise<string[]> {
  return list(record(await client.get<unknown>('/api/skills/tags/list')).tags).map(text).filter(Boolean);
}

export async function createSkillTag(client: DtClient, tag: string): Promise<string> {
  return text(record(await client.post<unknown>('/api/skills/tags/create', { name: tag })).name) || tag;
}

/** Renames a tag, in every skill of yours that has it. */
export async function renameSkillTag(client: DtClient, tag: string, renameTo: string): Promise<string> {
  return text(record((await client.send<unknown>('PUT', tagPath(tag), { body: { rename_to: renameTo } })).data).name) || renameTo;
}

/** Deletes a tag, taking it off every skill of yours that has it. */
export async function deleteSkillTag(client: DtClient, tag: string): Promise<void> {
  await client.delete<unknown>(tagPath(tag));
}

/** How many skills have each tag, and how many have none. */
export function tagCounts(skills: DtSkill[]): { all: number; untagged: number; byTag: Record<string, number> } {
  const byTag: Record<string, number> = {};
  let untagged = 0;
  for (const skill of skills) {
    if (!skill.tags.length) untagged += 1;
    for (const tag of new Set(skill.tags)) byTag[tag] = (byTag[tag] ?? 0) + 1;
  }
  return { all: skills.length, untagged, byTag };
}

export type DtSkillFilter = { kind: 'all' } | { kind: 'untagged' } | { kind: 'tag'; tag: string };

export function filterSkills(skills: DtSkill[], filter: DtSkillFilter): DtSkill[] {
  if (filter.kind === 'untagged') return skills.filter((skill) => !skill.tags.length);
  if (filter.kind === 'tag') return skills.filter((skill) => skill.tags.includes(filter.tag));
  return skills;
}

/** Workspaces whose settings give their chats this skill (worth saying before it's deleted). */
export async function skillUsage(client: DtClient, name: string): Promise<{ id: string; name: string }[]> {
  const body = record(await client.get<unknown>('/api/settings/workspace/resource-usage', { query: { kind: 'skills', resource_id: name } }));
  return list(body.workspaces).flatMap((raw) => {
    const row = record(raw);
    const id = text(row.workspace_id);
    return id ? [{ id, name: text(row.display_name) || id }] : [];
  });
}
