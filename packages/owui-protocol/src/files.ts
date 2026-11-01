import type { HistoryMessage } from './history';
import type { OwuiClient } from './http';

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
  type: 'file' | 'image' | 'text';
  file?: UploadedFile | '';
  id: string | null;
  url: string;
  name: string;
  collection_name?: string;
  status?: 'uploading' | 'uploaded' | 'error';
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

/**
 * The request's `files`: documents attached anywhere in the shown conversation plus the
 * new message's, without duplicates. Photos travel in `user_message.files` instead.
 */
export function requestFiles(branch: HistoryMessage[], userMessage: HistoryMessage): unknown[] {
  const seen = new Set<string>();
  const files: unknown[] = [];
  for (const message of [...branch, userMessage]) {
    for (const file of message.files ?? []) {
      if (!isContextFile(file)) continue;
      const key = (file as FileItem).id ?? JSON.stringify(file);
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(file);
    }
  }
  return files;
}
