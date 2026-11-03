import type { FileItem } from './files';
import type { OwuiClient } from './http';

/*
 * What the input's `@` and `#` menus offer to attach (Open WebUI 0.11.3): knowledge bases and
 * the files in them, your folders, and a web page by its address.
 */

export interface KnowledgeChoice {
  kind: 'collection' | 'file' | 'folder';
  id: string;
  name: string;
  /** A knowledge base's description, or the knowledge base a file is in. */
  description: string;
  /** The item as the server sent it; it travels with the message as the web sends it. */
  raw: Record<string, unknown>;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const items = (body: unknown) => (Array.isArray(record(body).items) ? (record(body).items as unknown[]).map(record) : []);

/** Knowledge bases you can read whose name matches. */
export async function searchKnowledgeBases(client: OwuiClient, query: string): Promise<KnowledgeChoice[]> {
  const body = await client.get<unknown>('/api/v1/knowledge/search', { query: { query: query || undefined } });
  return items(body).flatMap((item) => (text(item.id) ? [{ kind: 'collection' as const, id: text(item.id), name: text(item.name) || 'Knowledge', description: text(item.description), raw: item }] : []));
}

/** Files in your knowledge bases whose name matches. */
export async function searchKnowledgeFiles(client: OwuiClient, query: string): Promise<KnowledgeChoice[]> {
  const body = await client.get<unknown>('/api/v1/knowledge/search/files', { query: { query: query || undefined } });
  return items(body).flatMap((item) => {
    const name = text(item.filename) || text(record(item.meta).name);
    return text(item.id) ? [{ kind: 'file' as const, id: text(item.id), name: name || 'File', description: text(record(item.collection).name), raw: item }] : [];
  });
}

/** The attachment a picked knowledge base, file or folder becomes, as the web adds it. */
export function knowledgeAttachment(choice: KnowledgeChoice): FileItem {
  return { ...choice.raw, type: choice.kind, id: choice.id, name: choice.name, url: '', status: 'processed' } as FileItem;
}

/** A plain web address, as the menus accept one (`http://` or `https://`). */
export function isWebAddress(value: string): boolean {
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(value.trim());
}

/**
 * A web page (or a picture or file at that address) fetched by the server and attached:
 * `POST /api/v1/retrieval/process/url`. A page comes back as its text.
 */
export async function attachWebAddress(client: OwuiClient, url: string): Promise<FileItem> {
  const result = record(await client.post<unknown>('/api/v1/retrieval/process/url', { url: url.trim(), collection_name: null }, { timeoutMs: 120_000 }));
  const file = record(result.file);
  const meta = record(file.meta);
  const name = text(result.name) || url;
  if ((result.type === 'image' || result.type === 'file') && text(file.id)) {
    return {
      type: result.type,
      file: file as unknown as FileItem['file'],
      id: text(file.id),
      url: text(file.id),
      name,
      collection_name: text(result.collection_name) || text(meta.collection_name),
      content_type: text(meta.content_type),
      size: typeof meta.size === 'number' ? meta.size : undefined,
      status: 'uploaded',
      error: '',
    };
  }
  return {
    type: 'text',
    file: { data: { content: text(result.content) }, meta: { name, source: text(result.url) || url } } as unknown as FileItem['file'],
    id: null,
    url: text(result.url) || url,
    name,
    collection_name: text(result.collection_name),
    context: 'full',
    status: 'uploaded',
    error: '',
  };
}
