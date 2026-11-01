import type { DtClient } from './http';

/** A row of `GET /api/sessions` or its search. Times are as the server sends them. Unknown fields are kept. */
export interface DtSessionSummary {
  id: string;
  title: string;
  created_at?: number | string;
  updated_at?: number | string;
  message_count?: number;
  [key: string]: unknown;
}

export interface DtMessage {
  id: number | string;
  role: string;
  content: string;
  capability?: string;
  created_at?: number | string;
  parent_message_id?: number | string | null;
  [key: string]: unknown;
}

/** `GET /api/sessions/{id}`: the session with every message, branches included. */
export interface DtSession extends DtSessionSummary {
  messages: DtMessage[];
  /** `selected_branches` maps a parent message id to the reply shown under it. */
  preferences?: { selected_branches?: Record<string, number | string> | null; [key: string]: unknown } | null;
}

export interface DtPage {
  limit?: number;
  offset?: number;
}

/** Your sessions, newest first (50 a page by default, at most 200). */
export async function listSessions(client: DtClient, { limit = 50, offset = 0 }: DtPage = {}): Promise<DtSessionSummary[]> {
  const response = await client.get<{ sessions?: DtSessionSummary[] }>('/api/sessions', { query: { limit, offset } });
  return response.sessions ?? [];
}

/** Sessions whose title or messages contain `query` (a literal match, at most 100 a page). */
export async function searchSessions(
  client: DtClient,
  query: string,
  { limit = 50, offset = 0 }: DtPage = {},
): Promise<{ sessions: DtSessionSummary[]; total: number }> {
  const response = await client.get<{ sessions?: DtSessionSummary[]; total?: number }>('/api/sessions/search', {
    query: { q: query.trim(), limit, offset },
  });
  return { sessions: response.sessions ?? [], total: response.total ?? 0 };
}

export function getSession(client: DtClient, id: string): Promise<DtSession> {
  return client.get<DtSession>(`/api/sessions/${encodeURIComponent(id)}`);
}

/**
 * The conversation as DeepTutor shows it: from the first message down, taking the chosen
 * reply wherever there are several (else the newest). Messages without parent links
 * (older sessions) are taken in order.
 */
export function shownMessages(session: DtSession): DtMessage[] {
  const messages = session.messages.filter((message) => message.role !== 'system');
  if (!messages.some((message) => message.parent_message_id != null)) return messages;

  const children = new Map<string, DtMessage[]>();
  for (const message of messages) {
    const parent = message.parent_message_id == null ? '' : String(message.parent_message_id);
    children.set(parent, [...(children.get(parent) ?? []), message]);
  }
  const chosen = session.preferences?.selected_branches ?? {};
  const path: DtMessage[] = [];
  const seen = new Set<string>();
  let parent = '';
  for (;;) {
    const options = children.get(parent);
    if (!options?.length) break;
    const pick = options.find((message) => String(message.id) === String(chosen[parent] ?? '')) ?? options[options.length - 1];
    if (!pick || seen.has(String(pick.id))) break;
    seen.add(String(pick.id));
    path.push(pick);
    parent = String(pick.id);
  }
  return path;
}

/** Moves a session to DeepTutor's recycle bin (with its threads). */
export async function deleteSession(client: DtClient, id: string): Promise<void> {
  await client.delete(`/api/sessions/${encodeURIComponent(id)}`);
}

export async function renameSession(client: DtClient, id: string, title: string): Promise<void> {
  await client.send('PATCH', `/api/sessions/${encodeURIComponent(id)}`, { body: { title: title.trim() } });
}

/**
 * Every event of the turn that wrote a reply, reasoning included (a saved message keeps only
 * its tool calls and result). `complete` is false while the turn still runs.
 */
export async function getMessageEvents(client: DtClient, sessionId: string, messageId: number | string): Promise<{ events: unknown[]; complete: boolean }> {
  const response = await client.get<{ events?: unknown[]; complete?: boolean }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(String(messageId))}/events`,
  );
  return { events: Array.isArray(response.events) ? response.events : [], complete: response.complete !== false };
}
