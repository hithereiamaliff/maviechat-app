import type { HistoryMessage } from './history';
import { OwuiHttpError, type OwuiClient } from './http';

/** `POST /api/v1/files/` answer (`FileModelResponse`); unknown fields are kept. */
export interface UploadedFile {
  id: string;
  filename?: string;
  meta?: { name?: string; content_type?: string; size?: number; collection_name?: string; [key: string]: unknown } | null;
  [key: string]: unknown;
}

/**
 * An attachment as the web app stores it in a user message's `files`.
 * Uploaded photos and documents are both `type: 'file'` (photos are told apart by
 * `content_type`). Temporary chats upload nothing: photos stay inline as
 * `{type: 'image', url: <data URL>}` and documents travel as `{type: 'text', content}`.
 */
export interface FileItem {
  /**
   * A whole knowledge base (`collection`) or folder can ride along too, picked from the `@` or `#`
   * menu, and another chat (`chat`, Reference Chats) or a note (`note`): the server reads them.
   */
  type: 'file' | 'image' | 'text' | 'collection' | 'folder' | 'chat' | 'note';
  file?: UploadedFile | '';
  id: string | null;
  url: string;
  name: string;
  collection_name?: string;
  status?: 'uploading' | 'uploaded' | 'processed' | 'error';
  size?: number;
  error?: string;
  itemId?: string;
  content_type?: string;
  [key: string]: unknown;
}

/** Documents are processed for retrieval on upload; photos are stored as they are (`process=false`). */
export function uploadFile(client: OwuiClient, form: FormData, { process }: { process: boolean }): Promise<UploadedFile> {
  return client.postForm<UploadedFile>('/api/v1/files/', form, { query: { process }, timeoutMs: 120_000 });
}

export type ProcessingStatus = 'pending' | 'completed' | 'failed';

/** Text extraction state of an uploaded document (`process=true` uploads finish in the background). */
export async function fileProcessingStatus(client: OwuiClient, id: string): Promise<ProcessingStatus> {
  const response = await client.get<{ status?: string }>(`/api/v1/files/${encodeURIComponent(id)}/process/status`);
  return response.status === 'completed' || response.status === 'failed' ? response.status : 'pending';
}

/** Polls until the document is ready (or failed); the web app waits the same way before sending. */
export async function waitForProcessing(
  client: OwuiClient,
  id: string,
  { intervalMs = 1000, timeoutMs = 120_000, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } = {},
): Promise<ProcessingStatus> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await fileProcessingStatus(client, id);
    if (status !== 'pending' || Date.now() > deadline) return status;
    await sleep(intervalMs);
  }
}

/** A file of yours on the server (Settings → Data Controls → Manage Files). */
export interface StoredFile {
  id: string;
  filename: string;
  /** Bytes, when the server knows. */
  size: number | null;
  contentType: string | null;
  /** Unix seconds. */
  created_at: number;
  /** Whose it is (admins see everyone's). */
  userId: string;
}

/** Files per page of the search. */
export const FILES_PAGE_SIZE = 50;

function storedFileOf(raw: unknown): StoredFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const meta = typeof row.meta === 'object' && row.meta !== null ? (row.meta as Record<string, unknown>) : {};
  if (typeof row.id !== 'string') return null;
  return {
    id: row.id,
    filename: typeof row.filename === 'string' && row.filename ? row.filename : typeof meta.name === 'string' ? meta.name : 'File',
    size: typeof meta.size === 'number' ? meta.size : null,
    contentType: typeof meta.content_type === 'string' ? meta.content_type : null,
    created_at: typeof row.created_at === 'number' ? row.created_at : 0,
    userId: typeof row.user_id === 'string' ? row.user_id : '',
  };
}

/**
 * Your files whose names contain `query` (any case; `*` and `?` work as wildcards), a page at a
 * time, without their text. The server answers 404 when none match: an empty list here.
 */
export async function searchFiles(client: OwuiClient, query: string, skip = 0): Promise<StoredFile[]> {
  const words = query.trim();
  try {
    const raw = await client.get<unknown>('/api/v1/files/search', { query: { filename: words ? `*${words}*` : '*', skip, limit: FILES_PAGE_SIZE, content: false } });
    return (Array.isArray(raw) ? raw : []).map(storedFileOf).filter((file): file is StoredFile => file !== null);
  } catch (error) {
    if (error instanceof OwuiHttpError && error.status === 404) return [];
    throw error;
  }
}

/** One of your files, uploaded before, attached again (the + menu's Attach Files), as an upload would be. */
export function previousFileItem(file: StoredFile, itemId: string): FileItem {
  return {
    type: 'file',
    id: file.id,
    url: file.id,
    name: file.filename,
    collection_name: '',
    status: 'processed',
    size: file.size ?? 0,
    error: '',
    itemId,
    ...(file.contentType ? { content_type: file.contentType } : {}),
  };
}

/** Another chat for the model to read (the + menu's Reference Chats). */
export function chatReferenceItem(chat: { id: string; title?: string | null }, itemId: string): FileItem {
  return { type: 'chat', id: chat.id, url: '', name: chat.title || 'New Chat', status: 'processed', itemId };
}

/**
 * How big a photo may be before it's sent, as the web decides: your "Image Compression" size
 * (`ui.imageCompression` with `ui.imageCompressionSize`), capped by the admin's limits
 * (`file.image_compression`). Null when nothing limits it.
 */
export function imageLimits(ui: Record<string, unknown> | null | undefined, config: Record<string, unknown> | null | undefined): { width: number | null; height: number | null } | null {
  const positive = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);
  const server = (config?.file as { image_compression?: { width?: unknown; height?: unknown } } | undefined)?.image_compression;
  const mine = ui?.imageCompression === true ? (ui.imageCompressionSize as { width?: unknown; height?: unknown } | undefined) : undefined;
  const cap = (own: number | null, limit: number | null) => (limit !== null && (own === null || own > limit) ? limit : own);
  const width = cap(positive(mine?.width), positive(server?.width));
  const height = cap(positive(mine?.height), positive(server?.height));
  return width === null && height === null ? null : { width, height };
}

/** The size a photo is shrunk to, keeping its shape, or null when it already fits. */
export function fitWithin(width: number, height: number, limits: { width: number | null; height: number | null }): { width: number; height: number } | null {
  const scale = Math.min(limits.width ? limits.width / width : Infinity, limits.height ? limits.height / height : Infinity);
  if (!(scale < 1)) return null;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** How many files you have (admins: everyone's). */
export function countFiles(client: OwuiClient): Promise<number> {
  return client.get<number>('/api/v1/files/count');
}

/** Where a file's content is fetched from (with your token). */
export function fileContentUrl(baseUrl: string, id: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/v1/files/${encodeURIComponent(id)}/content`;
}

/** A size as people read it: "820 B", "14 KB", "3.2 MB". */
export function fileSizeLabel(bytes: number | null): string {
  if (bytes === null || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function deleteFile(client: OwuiClient, id: string): Promise<unknown> {
  return client.delete<unknown>(`/api/v1/files/${encodeURIComponent(id)}`);
}

/** The message attachment for a finished upload, shaped like the web client's. */
export function fileItemFromUpload(upload: UploadedFile, source: { name: string; size?: number; itemId: string }): FileItem {
  return {
    type: 'file',
    file: upload,
    id: upload.id,
    url: upload.id,
    name: source.name,
    collection_name: upload.meta?.collection_name ?? (typeof upload.collection_name === 'string' ? upload.collection_name : ''),
    status: 'uploaded',
    size: source.size ?? upload.meta?.size ?? 0,
    error: '',
    itemId: source.itemId,
    content_type: upload.meta?.content_type ?? (typeof upload.content_type === 'string' ? upload.content_type : undefined),
  };
}

const TEXT_EXTENSIONS = new Set(
  'txt md markdown csv tsv json jsonl yaml yml xml html htm css js mjs cjs ts tsx jsx py rb go rs java kt swift c h cpp hpp cs php sh sql toml ini log rst tex'.split(' '),
);

/** Documents a temporary chat can attach: the app reads them as text, since nothing is uploaded. */
export function readableAsText(name: string, mimeType?: string | null): boolean {
  const type = (mimeType ?? '').toLowerCase();
  if (type.startsWith('text/') || /^application\/(json|xml|x-yaml|yaml|javascript|x-sh|sql)\b/.test(type)) return true;
  const extension = name.toLowerCase().split('.').pop() ?? '';
  return name.includes('.') && TEXT_EXTENSIONS.has(extension);
}

/** A document attached to a temporary chat: its text travels in the request, nothing is stored. */
export function textFileItem(source: { name: string; size?: number; content: string; itemId: string; id: string }): FileItem {
  return {
    type: 'text',
    file: '',
    id: source.id,
    url: '',
    name: source.name,
    collection_name: '',
    status: 'uploaded',
    size: source.size ?? source.content.length,
    error: '',
    itemId: source.itemId,
    content: source.content,
  };
}

/** A photo in a temporary chat, kept inline as a data URL. */
export function inlineImageItem(dataUrl: string): FileItem {
  return { type: 'image', url: dataUrl } as FileItem;
}

export function isImageItem(item: Pick<FileItem, 'type' | 'content_type'>): boolean {
  return item.type === 'image' || (item.content_type ?? '').startsWith('image/');
}

/** Where to load an attachment's preview from: inline data, an absolute or server path, or the stored file's content. */
export function attachmentUrl(item: Pick<FileItem, 'id' | 'url'>, baseUrl: string): string | null {
  const url = typeof item.url === 'string' ? item.url : '';
  if (/^(data:|https?:)/i.test(url)) return url;
  if (url.startsWith('/')) return `${baseUrl}${url}`;
  const id = item.id ?? url;
  return id ? `${baseUrl}/api/v1/files/${encodeURIComponent(id)}/content` : null;
}

const CONTEXT_TYPES = new Set(['doc', 'text', 'note', 'chat', 'collection', 'folder']);

/** True for attachments the request's `files` carries (documents, knowledge) rather than photos. */
export function isContextFile(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const file = item as FileItem;
  return CONTEXT_TYPES.has(file.type) || (file.type === 'file' && !(file.content_type ?? '').startsWith('image/'));
}

/** A file item's name as people see it: its own name, its upload's, or what kind of item it is. */
export function attachmentName(item: unknown): string {
  if (!item || typeof item !== 'object') return 'File';
  const file = item as Partial<FileItem>;
  const upload = file.file && typeof file.file === 'object' ? (file.file as { filename?: unknown; meta?: { name?: unknown } | null }) : null;
  const named = [file.name, upload?.meta?.name, upload?.filename].find((name): name is string => typeof name === 'string' && name.trim().length > 0);
  return named ?? ((item as { type?: unknown }).type === 'collection' ? 'Knowledge' : 'File');
}

const fileKey = (file: unknown) => (file as FileItem).id ?? JSON.stringify(file);

/**
 * The request's `files`, as the web picks them: the chat's documents (`chat.files`) that are
 * still in the shown conversation, plus the new message's, without duplicates. The server then
 * keeps this list as the chat's files, so one removed in Controls stays out. A chat without the
 * list (a temporary one) sends every document in the shown conversation. Photos travel in
 * `user_message.files` instead.
 */
export function requestFiles(branch: HistoryMessage[], userMessage: HistoryMessage, chatFiles?: unknown[]): unknown[] {
  const inBranch = branch.flatMap((message) => (message.files ?? []).filter(isContextFile));
  const branchKeys = new Set(inBranch.map(fileKey));
  const carried = chatFiles ? chatFiles.filter((file) => branchKeys.has(fileKey(file))) : inBranch;
  const seen = new Set<string>();
  const files: unknown[] = [];
  for (const file of [...carried, ...(userMessage.files ?? []).filter(isContextFile)]) {
    const key = fileKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    files.push(file);
  }
  return files;
}
