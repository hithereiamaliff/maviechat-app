import type { OwuiClient } from './http';
import { grantsOf, listParams, tagNames, type AccessGrant, type WorkspaceListQuery } from './workspaceModels';

/*
 * Workspace skills (Open WebUI 0.11.3): Markdown playbooks a model reads when it needs one (or
 * whole, when a message mentions it). An id (lower case: letters, digits, `-`, `_`) and a name
 * unique across the server. The web's editor always saves a skill as on; the app sends it as it
 * is, and keeps its other settings.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const ms = (value: unknown): number => (typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : 0);
const base = '/api/v1/skills';
const idPath = (id: string) => `${base}/id/${encodeURIComponent(id)}`;

/** One file of a skill package (Open WebUI 0.12): its main text is `SKILL.md`. */
export interface SkillFile {
  path: string;
  content: string;
}

export interface WorkspaceSkill {
  id: string;
  name: string;
  description: string;
  /** Only when read one by one (lists leave it out). */
  content: string | null;
  meta: Tree;
  tags: string[];
  isActive: boolean;
  accessGrants: AccessGrant[];
  ownerName: string;
  writeAccess: boolean;
  updatedAt: number;
  /** A 0.12 package's files (`data.files`, `SKILL.md` among them), when read one by one. */
  files: SkillFile[];
}

function skillOf(raw: unknown): WorkspaceSkill | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const meta = record(row.meta);
  const user = record(row.user);
  return {
    id,
    name: text(row.name) || id,
    description: text(row.description),
    content: typeof row.content === 'string' ? row.content : null,
    meta,
    tags: tagNames(meta.tags),
    isActive: row.is_active !== false,
    accessGrants: grantsOf(row.access_grants),
    ownerName: text(user.name) || text(user.email),
    writeAccess: row.write_access === true,
    updatedAt: ms(row.updated_at),
    files: list(record(row.data).files).flatMap((item) => {
      const file = record(item);
      return text(file.path) ? [{ path: text(file.path), content: text(file.content) }] : [];
    }),
  };
}

function skillFrom(raw: unknown): WorkspaceSkill {
  const skill = skillOf(raw);
  if (!skill) throw new Error('Open WebUI did not describe the skill');
  return skill;
}

export async function listWorkspaceSkills(client: OwuiClient, query: Omit<WorkspaceListQuery, 'tag'> = {}): Promise<{ items: WorkspaceSkill[]; total: number }> {
  const body = record(await client.get<unknown>(`${base}/list`, { query: listParams(query) }));
  return { items: list(body.items).flatMap((row) => skillOf(row) ?? []), total: typeof body.total === 'number' ? body.total : 0 };
}

export async function getWorkspaceSkill(client: OwuiClient, id: string): Promise<WorkspaceSkill> {
  return skillFrom(await client.get<unknown>(idPath(id)));
}

/** An id from a name, as Open WebUI keeps them: lower case, spaces to `-`, letters, digits, `-`, `_`. */
export const skillIdFromName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');

export function skillIdProblem(id: string): string | null {
  if (!id) return 'Give it an id.';
  if (!/^[a-z0-9_-]+$/.test(id)) return 'Lower-case letters, digits, dashes and underscores only.';
  return null;
}

/** `name` and `description` from a Markdown file's header, when it has them (as the web fills an empty form). */
export function skillFrontMatter(markdown: string): { name: string; description: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  const read = (key: string) => (match ? (new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(match[1] ?? '')?.[1] ?? '').replace(/^["']|["']$/g, '') : '');
  return { name: read('name'), description: read('description') };
}

export interface SkillInput {
  id: string;
  name: string;
  description: string;
  content: string;
  tags: string[];
  isActive: boolean;
  meta?: Tree;
  accessGrants?: AccessGrant[];
  /** A 0.12 package's files, `SKILL.md` among them (0.11 servers ignore them). */
  files?: SkillFile[];
}

function skillBody(input: SkillInput): Tree {
  // Skills keep their tags as plain strings (0.11.3 refuses `{name}` objects here, unlike models).
  const body: Tree = { id: input.id, name: input.name.trim(), description: input.description.trim(), content: input.content, meta: { ...(input.meta ?? {}), tags: input.tags }, is_active: input.isActive };
  if (input.accessGrants !== undefined) body.access_grants = input.accessGrants;
  // A package's other files go along, its SKILL.md being the text given (0.11 ignores them).
  if (input.files?.some((file) => file.path !== 'SKILL.md')) body.files = [...input.files.filter((file) => file.path !== 'SKILL.md'), { path: 'SKILL.md', content: input.content }];
  return body;
}

/** A new skill, private unless grants are given. */
export async function createWorkspaceSkill(client: OwuiClient, input: SkillInput): Promise<WorkspaceSkill> {
  return skillFrom(await client.post<unknown>(`${base}/create`, skillBody({ ...input, accessGrants: input.accessGrants ?? [] })));
}

/** Saves a skill whole, as it is (on or off), its sharing left out. */
export async function updateWorkspaceSkill(client: OwuiClient, input: SkillInput): Promise<WorkspaceSkill> {
  return skillFrom(await client.post<unknown>(`${idPath(input.id)}/update`, skillBody({ ...input, accessGrants: undefined })));
}

export async function toggleWorkspaceSkill(client: OwuiClient, id: string): Promise<WorkspaceSkill> {
  return skillFrom(await client.post<unknown>(`${idPath(id)}/toggle`));
}

export async function deleteWorkspaceSkill(client: OwuiClient, id: string): Promise<void> {
  await client.delete<unknown>(`${idPath(id)}/delete`);
}

/** Every skill you can read, with its text (needs `workspace.skills_export`). */
export async function exportWorkspaceSkills(client: OwuiClient): Promise<unknown[]> {
  return list(await client.get<unknown>(`${base}/export`));
}

/** `essay-feedback` → `Essay Feedback`, as the web names a skill from its file's header. */
const titleCase = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/** A new skill from a Markdown file: its header's name (title-cased) and description, an id from that name, and the whole file as its text. */
export function skillDraftFromMarkdown(markdown: string, fileName = ''): { name: string; id: string; description: string; content: string } {
  const head = skillFrontMatter(markdown);
  const named = head.name || fileName.replace(/\.(md|markdown|txt)$/i, '');
  return { name: titleCase(named), id: skillIdFromName(named), description: head.description, content: markdown };
}

/**
 * Skills from an exported JSON file (one or a list), each to be made as a new skill: on or off as
 * it was, its settings kept, its sharing left behind (new skills are private). Entries without a
 * name, a usable id or text are skipped.
 */
export function skillsFromImport(json: unknown): { skills: SkillInput[]; skipped: number } {
  let skipped = 0;
  const skills = (Array.isArray(json) ? json : [json]).flatMap((raw) => {
    const row = record(raw);
    const name = text(row.name).trim();
    const id = skillIdFromName(text(row.id) || name);
    // 0.12 exports a package's files instead of `content`; its text is SKILL.md.
    const files = list(row.files).flatMap((item) => {
      const file = record(item);
      return text(file.path) ? [{ path: text(file.path), content: text(file.content) }] : [];
    });
    const content = text(row.content) || files.find((file) => file.path === 'SKILL.md')?.content || '';
    if (!name || skillIdProblem(id) || !content.trim()) {
      skipped += 1;
      return [];
    }
    const meta = record(row.meta);
    return [{ id, name, description: text(row.description), content, tags: tagNames(meta.tags), isActive: row.is_active !== false, meta, ...(files.length > 1 ? { files } : {}) }];
  });
  return { skills, skipped };
}
