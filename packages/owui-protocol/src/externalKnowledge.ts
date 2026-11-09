import type { OwuiClient } from './http';
import { listWorkspaceKnowledge, type WorkspaceKnowledge } from './workspaceKnowledge';

/*
 * External knowledge (Open WebUI 0.11.3 and 0.12.5, admins; the web marks it experimental):
 * collections kept in another vector database, Qdrant, Milvus or pgvector, that show as
 * connected knowledge and are searched where they live. Each source is a knowledge base
 * (`meta.source` "external") plus a connection the server keeps in its own config: the
 * database's address, its key (never sent back, only whether one is saved), a timeout and, for
 * Milvus, the database. The server tests a source with a question before it saves it, and
 * refuses one that finds nothing.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const base = '/api/v1/knowledge/external';
/** Passages a test asks for, as the web asks. */
const TEST_COUNT = 5;

export type ExternalProvider = 'qdrant' | 'milvus' | 'pgvector';

export const EXTERNAL_PROVIDERS: readonly { value: ExternalProvider; label: string }[] = [
  { value: 'qdrant', label: 'Qdrant' },
  { value: 'milvus', label: 'Milvus' },
  { value: 'pgvector', label: 'pgvector' },
];

const isProvider = (value: string): value is ExternalProvider => EXTERNAL_PROVIDERS.some((provider) => provider.value === value);

export interface ExternalConnection {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  /** The server's settings for it (timeout; Milvus's database), sent back as they are. */
  config: Tree;
  capabilities: Tree;
  enabled: boolean;
  /** A key is saved for it; the server never sends the key itself. */
  keySaved: boolean;
}

function connectionOf(raw: unknown): ExternalConnection | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  return { id, name: text(row.name), provider: text(row.provider), endpoint: text(row.endpoint), config: record(row.config), capabilities: record(row.capabilities), enabled: row.enabled !== false, keySaved: row.auth_configured === true };
}

/** The connections the server keeps (admins). */
export async function listExternalConnections(client: OwuiClient): Promise<ExternalConnection[]> {
  return list(record(await client.get<unknown>(`${base}/connections`)).items).flatMap((raw) => connectionOf(raw) ?? []);
}

/** A connected collection: its knowledge base, the connection it reads through, and where its text is. */
export interface ExternalSource {
  knowledge: WorkspaceKnowledge;
  connectionId: string;
  /** The collection's name in the other database (for pgvector, its collection field's value). */
  collection: string;
  /** Where a row keeps its text, vector, details and id, by the server's names (`content_field`…). */
  fields: Tree;
}

export function externalSourceOf(knowledge: WorkspaceKnowledge): ExternalSource | null {
  if (!knowledge.external) return null;
  const external = record(knowledge.meta.external);
  const source = record(external.source);
  return { knowledge, connectionId: text(external.connection_id), collection: text(source.name), fields: record(source.config) };
}

/** Every connected collection (by name, every page), and the connections they use. */
export async function listExternalSources(client: OwuiClient): Promise<{ sources: ExternalSource[]; connections: ExternalConnection[] }> {
  const knowledge = async () => {
    const found: WorkspaceKnowledge[] = [];
    for (let page = 1; page <= 50; page += 1) {
      const { items, total } = await listWorkspaceKnowledge(client, { source: 'external', page, orderBy: 'name', direction: 'asc' });
      found.push(...items);
      if (!items.length || found.length >= total) break;
    }
    return found;
  };
  const [connections, items] = await Promise.all([listExternalConnections(client), knowledge()]);
  return { sources: items.flatMap((item) => externalSourceOf(item) ?? []), connections };
}

/** A source as the form edits it. */
export interface ExternalForm {
  name: string;
  description: string;
  provider: ExternalProvider;
  endpoint: string;
  /** Typed to set or change it; left empty, a saved one stays. pgvector has none: its address holds the sign-in. */
  key: string;
  /** Seconds. */
  timeout: string;
  /** Milvus only; empty for its default database. */
  database: string;
  collection: string;
  /** pgvector only: the table, and the field whose value is the collection. */
  table: string;
  collectionField: string;
  contentField: string;
  /** Required for Milvus and pgvector; Qdrant uses its default vector when empty. */
  vectorField: string;
  metadataField: string;
  documentIdField: string;
}

type FieldNames = Pick<ExternalForm, 'contentField' | 'vectorField' | 'metadataField' | 'documentIdField' | 'table' | 'collectionField'>;

/** Where each database keeps a row's text, vector, details and id by default: as Open WebUI's own vector stores lay them out. */
export function externalFieldDefaults(provider: ExternalProvider): FieldNames {
  if (provider === 'milvus') return { contentField: 'data.text', vectorField: 'vector', metadataField: 'metadata', documentIdField: 'id', table: 'document_chunk', collectionField: 'collection_name' };
  if (provider === 'pgvector') return { contentField: 'text', vectorField: 'vector', metadataField: 'vmetadata', documentIdField: 'id', table: 'document_chunk', collectionField: 'collection_name' };
  return { contentField: 'payload.text', vectorField: '', metadataField: 'payload.metadata', documentIdField: 'id', table: 'document_chunk', collectionField: 'collection_name' };
}

export const newExternalForm = (): ExternalForm => ({ name: '', description: '', provider: 'qdrant', endpoint: '', key: '', timeout: '30', database: '', collection: '', ...externalFieldDefaults('qdrant') });

/** Another database: its default field names come with it. */
export const withExternalProvider = (form: ExternalForm, provider: ExternalProvider): ExternalForm => ({ ...form, provider, ...externalFieldDefaults(provider) });

/** A saved source as the form shows it; the key is left empty, so the saved one stays unless another is typed. */
export function externalFormOf(source: ExternalSource, connection: ExternalConnection): ExternalForm {
  const provider = isProvider(connection.provider) ? connection.provider : 'qdrant';
  const defaults = externalFieldDefaults(provider);
  const field = (key: string, fallback: string) => (typeof source.fields[key] === 'string' ? (source.fields[key] as string) : fallback);
  return {
    name: source.knowledge.name,
    description: source.knowledge.description,
    provider,
    endpoint: connection.endpoint,
    key: '',
    timeout: String(typeof connection.config.timeout === 'number' ? connection.config.timeout : 30),
    database: text(connection.config.db_name),
    collection: source.collection,
    contentField: field('content_field', defaults.contentField),
    vectorField: field('vector_field', defaults.vectorField),
    metadataField: field('metadata_field', defaults.metadataField),
    documentIdField: field('document_id_field', defaults.documentIdField),
    table: field('table_name', defaults.table),
    collectionField: field('collection_field', defaults.collectionField),
  };
}

/** What's missing before a test (and, with `forSave`, before a save), in words; null when it's ready. */
export function externalFormProblem(form: ExternalForm, question: string, forSave = false): string | null {
  if (forSave && !form.name.trim()) return 'Give it a name.';
  if (!form.endpoint.trim()) return 'Enter the database’s address.';
  if (form.timeout.trim() && !(Number(form.timeout) > 0)) return 'The timeout is a number of seconds.';
  if (!form.collection.trim()) return 'Enter the collection.';
  if (form.provider === 'pgvector' && (!form.table.trim() || !form.collectionField.trim())) return 'Enter the table and the collection field.';
  if (!form.contentField.trim()) return 'Enter the field that holds the text.';
  if (form.provider !== 'qdrant' && !form.vectorField.trim()) return 'Enter the field that holds the vectors.';
  if (!question.trim()) return 'Enter a test question.';
  return null;
}

/** The connection's part of a request: for a saved one, no typed key keeps its key (`null`). */
function connectionBody(form: ExternalForm, saved: ExternalConnection | null): Tree {
  const key = form.key.trim();
  const timeout = Number(form.timeout);
  return {
    name: form.name.trim() || form.collection.trim() || 'External knowledge',
    provider: form.provider,
    endpoint: form.endpoint.trim(),
    auth_config: form.provider === 'pgvector' ? {} : key ? { type: 'bearer', api_key: key } : saved ? null : {},
    config: { timeout: timeout > 0 ? timeout : 30, ...(form.provider === 'milvus' && form.database.trim() ? { db_name: form.database.trim() } : {}) },
    capabilities: { retrieve: true },
    enabled: saved ? saved.enabled : true,
  };
}

/** The collection's part: its name, and where its rows keep their text (empty fields left out). */
function sourceBody(form: ExternalForm): Tree {
  const config: Tree = { content_field: form.contentField.trim() };
  if (form.vectorField.trim()) config.vector_field = form.vectorField.trim();
  if (form.metadataField.trim()) config.metadata_field = form.metadataField.trim();
  if (form.documentIdField.trim()) config.document_id_field = form.documentIdField.trim();
  if (form.provider === 'pgvector') {
    config.table_name = form.table.trim();
    config.collection_field = form.collectionField.trim();
  }
  return { type: 'collection', name: form.collection.trim(), config };
}

/** What a test found: up to five passages, each with its distance where the database gave one. */
export interface ExternalTestResult {
  passages: { text: string; distance: number | null }[];
}

/** Asks the database a question as the server would, without saving anything (a saved source's key is used unless another is typed). */
export async function testExternalSource(client: OwuiClient, form: ExternalForm, question: string, saved: ExternalConnection | null = null): Promise<ExternalTestResult> {
  const body = record(
    await client.post<unknown>(`${base}/source/test`, { ...(saved ? { connection_id: saved.id } : {}), connection: connectionBody(form, saved), source: sourceBody(form), query: question.trim(), count: TEST_COUNT }),
  );
  const distances = list(body.distances);
  return { passages: list(body.documents).map((document, index) => ({ text: text(document), distance: typeof distances[index] === 'number' ? distances[index] : null })) };
}

/** A new source, saved once the server's own test finds something; private until shared (Share… in Workspace). Its knowledge base's id. */
export async function createExternalSource(client: OwuiClient, form: ExternalForm, question: string): Promise<string> {
  const answer = record(
    await client.post<unknown>(`${base}/source/create`, {
      name: form.name.trim(),
      description: form.description.trim(),
      connection: connectionBody(form, null),
      source: sourceBody(form),
      access_grants: [],
      test_query: question.trim(),
      test_count: TEST_COUNT,
    }),
  );
  return text(answer.id);
}

/** Changes to a saved source, kept once the server's own test finds something; its sharing stays as it is. */
export async function updateExternalSource(client: OwuiClient, knowledgeId: string, form: ExternalForm, question: string, saved: ExternalConnection): Promise<void> {
  await client.patch<unknown>(`${base}/source/${encodeURIComponent(knowledgeId)}`, {
    name: form.name.trim(),
    description: form.description.trim(),
    connection: connectionBody(form, saved),
    source: sourceBody(form),
    test_query: question.trim(),
    test_count: TEST_COUNT,
  });
}

/** On or off: an off source isn't searched. Everything else, its key too, stays. */
export async function setExternalConnectionEnabled(client: OwuiClient, connection: ExternalConnection, enabled: boolean): Promise<ExternalConnection> {
  const answer = await client.patch<unknown>(`${base}/connections/${encodeURIComponent(connection.id)}`, {
    name: connection.name,
    provider: connection.provider,
    endpoint: connection.endpoint,
    auth_config: null,
    config: connection.config,
    capabilities: Object.keys(connection.capabilities).length ? connection.capabilities : { retrieve: true },
    enabled,
  });
  return connectionOf(answer) ?? { ...connection, enabled };
}

/** Whether an address holds a password (a pgvector address holds its sign-in). */
export const addressHasPassword = (address: string): boolean => /\/\/[^/@:\s]*:[^/@\s]+@/.test(address);

/** An address with any password in it hidden. */
export const maskedAddress = (address: string): string => address.replace(/(\/\/[^/@:\s]*:)[^/@\s]+@/, '$1•••@');
