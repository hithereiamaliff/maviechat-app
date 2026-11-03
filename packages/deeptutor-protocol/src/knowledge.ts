import type { DtClient } from './http';

/*
 * DeepTutor's Knowledge Center (1.7.1): knowledge bases built from your documents, searched by
 * chats that pick them. Each uses a retrieval engine ("RAG provider"); some need an embedding
 * model, PageIndex OSS uses the chat model and takes PDFs.
 */

/** Indexing progress (`GET /api/knowledge-bases/{name}/progress`). */
export interface DtKbProgress {
  /** e.g. "processing_documents", "completed", "error". */
  stage: string;
  message: string;
  percent: number;
  current: number;
  total: number;
  fileName: string;
}

/** A knowledge base as the Knowledge Center shows it. */
export interface DtKnowledgeBaseInfo {
  name: string;
  isDefault: boolean;
  /** "ready" once indexed; "initializing", "processing", "error"… otherwise. */
  status: string;
  /** The engine's id ("llamaindex", "pageindex-oss", …). */
  provider: string;
  documents: number;
  description: string;
  lastIndexedAt: string | null;
  needsReindex: boolean;
  readOnly: boolean;
  progress: DtKbProgress | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const kbPath = (name: string) => `/api/knowledge-bases/${encodeURIComponent(name)}`;

function progressOf(raw: unknown): DtKbProgress | null {
  const progress = record(raw);
  const stage = text(progress.stage) || text(progress.status);
  if (!stage || stage === 'not_started') return null;
  return {
    stage,
    message: text(progress.message),
    percent: number(progress.progress_percent ?? progress.percent),
    current: number(progress.current),
    total: number(progress.total),
    fileName: text(progress.file_name),
  };
}

function infoOf(raw: unknown): DtKnowledgeBaseInfo | null {
  const kb = record(raw);
  if (!text(kb.name) || kb.available === false) return null;
  const statistics = record(kb.statistics);
  const metadata = record(kb.metadata);
  return {
    name: text(kb.name),
    isDefault: kb.is_default === true,
    status: text(kb.status) || text(statistics.status),
    provider: text(statistics.rag_provider) || text(metadata.rag_provider),
    documents: number(statistics.raw_documents),
    description: text(metadata.description),
    lastIndexedAt: text(metadata.last_indexed_at) || null,
    needsReindex: statistics.needs_reindex === true || metadata.needs_reindex === true,
    readOnly: kb.read_only === true,
    progress: progressOf(kb.progress ?? statistics.progress),
  };
}

/** The account's knowledge bases, with their state. */
export async function listKnowledgeCenter(client: DtClient): Promise<DtKnowledgeBaseInfo[]> {
  const response = await client.get<unknown>('/api/knowledge-bases');
  return (Array.isArray(response) ? response : []).flatMap((item) => infoOf(item) ?? []);
}

export async function getKnowledgeBase(client: DtClient, name: string): Promise<DtKnowledgeBaseInfo> {
  const info = infoOf(await client.get<unknown>(kbPath(name)));
  if (!info) throw new Error('DeepTutor did not describe the knowledge base');
  return info;
}

export async function getKbProgress(client: DtClient, name: string): Promise<DtKbProgress | null> {
  return progressOf(await client.get<unknown>(`${kbPath(name)}/progress`));
}

/** A document (or folder) in a knowledge base; `name` is its path inside it. */
export interface DtKbFile {
  name: string;
  folder: boolean;
  size: number;
  /** Unix seconds. */
  modified: number | null;
}

export async function listKbFiles(client: DtClient, name: string): Promise<DtKbFile[]> {
  const response = record(await client.get<unknown>(`${kbPath(name)}/files`));
  return (Array.isArray(response.files) ? response.files : []).flatMap((item): DtKbFile[] => {
    const file = record(item);
    if (!text(file.name)) return [];
    return [{ name: text(file.name), folder: file.type === 'folder', size: number(file.size), modified: typeof file.modified === 'number' ? file.modified : null }];
  });
}

/** A retrieval engine DeepTutor offers for new knowledge bases. */
export interface DtRagProvider {
  id: string;
  name: string;
  description: string;
  /** Installed and set up on the server. */
  configured: boolean;
  /** Needs an external server or account first (set up on the web). */
  needsSetup: boolean;
}

export async function listRagProviders(client: DtClient): Promise<DtRagProvider[]> {
  const response = record(await client.get<unknown>('/api/knowledge-bases/rag-providers'));
  return (Array.isArray(response.providers) ? response.providers : []).flatMap((item): DtRagProvider[] => {
    const provider = record(item);
    if (!text(provider.id)) return [];
    return [
      {
        id: text(provider.id),
        name: text(provider.name) || text(provider.id),
        description: text(provider.description),
        configured: provider.configured === true,
        needsSetup: provider.setup_required === true || provider.requires_api_key === true,
      },
    ];
  });
}

/** Whether an engine can build a knowledge base now, and if not, what's missing (DeepTutor's words). */
export async function ragPreflight(client: DtClient, provider: string): Promise<{ ok: boolean; missing: string[] }> {
  const response = record(await client.get<unknown>(`/api/knowledge-bases/rag-pipelines/${encodeURIComponent(provider)}/preflight`));
  const checks = Array.isArray(response.checks) ? response.checks.map(record) : [];
  const missing = checks.filter((check) => check.ok !== true && check.optional !== true).map((check) => [text(check.label), text(check.detail)].filter(Boolean).join(': '));
  return { ok: response.ok === true, missing };
}

/** The engine's own limit on file types, if it has one (PageIndex OSS takes PDFs only). */
export function providerAccepts(provider: string, filename: string): boolean {
  const extension = filename.toLowerCase().replace(/^.*(\.[^.]+)$/, '$1');
  if (provider === 'pageindex-oss') return extension === '.pdf';
  if (provider === 'pageindex') return ['.pdf', '.md', '.markdown', '.txt', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.zip'].includes(extension);
  return true;
}

const FORBIDDEN_NAME_CHARS = '<>:"/\\|?*#%';

/** Why DeepTutor would refuse this name, or null (1.7.1's rules). */
export function kbNameProblem(name: string): string | null {
  const trimmed = name.normalize('NFC').trim();
  if (!trimmed) return 'Give it a name.';
  if (trimmed === '.' || trimmed === '..') return 'That name is not allowed.';
  if (trimmed.length > 120) return 'Use at most 120 characters.';
  const forbidden = [...FORBIDDEN_NAME_CHARS].filter((char) => trimmed.includes(char));
  return forbidden.length ? `Leave out ${forbidden.join(' ')}` : null;
}

/** A file to upload: a `File`/`Blob` with a name, or (in React Native) `{ uri, name, type }`. */
export type DtUploadFile = unknown;

/** Creates a knowledge base, with documents to index (or none). Indexing runs on; follow `getKbProgress`. */
export async function createKnowledgeBase(
  client: DtClient,
  input: { name: string; provider: string; pageindexMode?: 'flash' | 'standard'; files: DtUploadFile[] },
): Promise<{ taskId: string | null }> {
  const form = new FormData();
  form.append('name', input.name.trim());
  form.append('rag_provider', input.provider);
  if (input.pageindexMode) form.append('pageindex_mode', input.pageindexMode);
  for (const file of input.files) form.append('files', file as Blob);
  const response = record((await client.send<unknown>('POST', '/api/knowledge-bases', { body: form, timeoutMs: 300_000 })).data);
  return { taskId: text(response.task_id) || null };
}

/** Adds documents to a knowledge base; they're indexed in the background. */
export async function uploadKbFiles(client: DtClient, name: string, files: DtUploadFile[]): Promise<{ taskId: string | null }> {
  const form = new FormData();
  for (const file of files) form.append('files', file as Blob);
  const response = record((await client.send<unknown>('POST', `${kbPath(name)}/upload`, { body: form, timeoutMs: 300_000 })).data);
  return { taskId: text(response.task_id) || null };
}

/**
 * Removes a document (its path inside the knowledge base). PageIndex drops it from its index too;
 * other engines keep finding its text until a re-index (`wasIndexed`).
 */
export async function deleteKbFile(client: DtClient, name: string, filename: string): Promise<{ wasIndexed: boolean }> {
  const response = record(await client.delete<unknown>(`${kbPath(name)}/files/${filename.split('/').map(encodeURIComponent).join('/')}`));
  return { wasIndexed: response.was_indexed === true };
}

/** Rebuilds the index from the documents; also how a knowledge base that failed is tried again. */
export async function reindexKnowledgeBase(client: DtClient, name: string): Promise<{ taskId: string | null }> {
  const response = record((await client.send<unknown>('POST', `${kbPath(name)}/reindex`, { body: new FormData(), timeoutMs: 120_000 })).data);
  return { taskId: text(response.task_id) || null };
}

export async function deleteKnowledgeBase(client: DtClient, name: string): Promise<void> {
  await client.delete(kbPath(name));
}

/** The knowledge base chats search when none is picked. */
export async function setDefaultKnowledgeBase(client: DtClient, name: string): Promise<void> {
  await client.send('PUT', `/api/knowledge-bases/default/${encodeURIComponent(name)}`);
}
