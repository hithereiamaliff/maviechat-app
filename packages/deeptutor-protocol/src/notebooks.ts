import type { DtClient } from './http';

export interface DtRecord {
  id: string;
  type: string;
  title: string;
  summary: string;
  user_query: string;
  output: string;
  metadata?: Record<string, unknown>;
  created_at?: number;
  [key: string]: unknown;
}

export interface DtNotebook {
  id: string;
  name: string;
  description?: string;
  created_at?: number;
  updated_at?: number;
  records?: DtRecord[];
  [key: string]: unknown;
}

/** Where MavieChat files the Open WebUI chats you send to DeepTutor. */
export const MAVIECHAT_NOTEBOOK = 'From MavieChat';

export async function listNotebooks(client: DtClient): Promise<DtNotebook[]> {
  const response = await client.get<{ notebooks?: DtNotebook[] }>('/api/notebooks');
  return response.notebooks ?? [];
}

export async function createNotebook(client: DtClient, name: string, description = ''): Promise<DtNotebook> {
  const response = await client.post<{ notebook: DtNotebook }>('/api/notebooks', { name, description });
  return response.notebook;
}

export function getNotebook(client: DtClient, id: string): Promise<DtNotebook> {
  return client.get<DtNotebook>(`/api/notebooks/${encodeURIComponent(id)}`);
}

export async function deleteNotebook(client: DtClient, id: string): Promise<void> {
  await client.delete(`/api/notebooks/${encodeURIComponent(id)}`);
}

/** The named notebook, created the first time it's needed. */
export async function ensureNotebook(client: DtClient, name = MAVIECHAT_NOTEBOOK, description = ''): Promise<DtNotebook> {
  const existing = (await listNotebooks(client)).find((notebook) => notebook.name === name);
  return existing ?? createNotebook(client, name, description);
}

export interface ChatRecordInput {
  notebookIds: string[];
  title: string;
  /** Always give one: with an empty summary the server asks its own model to write it. */
  summary: string;
  /** The question that opened the chat. */
  userQuery: string;
  /** The conversation itself, as Markdown. */
  output: string;
  metadata?: Record<string, unknown>;
}

/** Adds a chat to notebooks (`record_type: "chat"`), where any DeepTutor chat can reference it. */
export async function addChatRecord(client: DtClient, input: ChatRecordInput): Promise<DtRecord> {
  if (!input.summary.trim()) throw new Error('A notebook record needs a summary');
  const response = await client.post<{ record: DtRecord }>('/api/notebooks/actions/add-record', {
    notebook_ids: input.notebookIds,
    record_type: 'chat',
    title: input.title,
    summary: input.summary,
    user_query: input.userQuery,
    output: input.output,
    metadata: input.metadata ?? {},
  });
  return response.record;
}
