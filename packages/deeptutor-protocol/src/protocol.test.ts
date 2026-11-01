import { describe, expect, it } from 'vitest';
import { signIn, tokenExpiry, tokenFromHeaders } from './auth';
import { DtClient, DtHttpError, normalizeDtUrl } from './http';
import { sessionFileName, sessionMarkdown } from './markdown';
import { addChatRecord, ensureNotebook } from './notebooks';
import { listSessions, shownMessages, type DtSession } from './sessions';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that answers from a script and records each request. */
function fakeFetch(answers: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const answer = answers.shift() ?? { status: 500 };
    return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), { status: answer.status ?? 200, headers: answer.headers });
  };
  return { fetch, calls };
}

const jwt = (claims: Record<string, unknown>) => `e30.${btoa(JSON.stringify(claims)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.sig`;

describe('client', () => {
  it('normalises the address and sends the token as a Bearer header', async () => {
    expect(normalizeDtUrl(' https://learn.example.com/ ')).toBe('https://learn.example.com');
    expect(() => normalizeDtUrl('learn.example.com')).toThrow();
    const { fetch, calls } = fakeFetch([{ body: { sessions: [{ id: 's1', title: 'Fractions' }] } }]);
    const client = new DtClient({ baseUrl: 'https://learn.example.com/', token: 'abc', fetch });
    expect((await listSessions(client, { limit: 5 })).map((session) => session.id)).toEqual(['s1']);
    expect(calls[0]?.url).toBe('https://learn.example.com/api/sessions?limit=5&offset=0');
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer abc');
    expect(calls[0]?.init?.credentials).toBe('include');
  });

  it('turns error answers into DtHttpError with the server detail', async () => {
    const { fetch } = fakeFetch([{ status: 401, body: { detail: 'Not authenticated' } }, { status: 422, body: { detail: [{ msg: 'field required' }] } }]);
    const client = new DtClient({ baseUrl: 'https://learn.example.com', fetch });
    const first = await client.get('/api/sessions').catch((error: unknown) => error);
    expect(first).toBeInstanceOf(DtHttpError);
    expect((first as DtHttpError).isUnauthorized).toBe(true);
    expect((first as DtHttpError).detail).toBe('Not authenticated');
    await expect(client.get('/api/x')).rejects.toThrow('field required');
  });
});

describe('sign-in', () => {
  it('reads the token from the dt_token cookie', async () => {
    const token = jwt({ sub: 'probe', exp: 1_900_000_000 });
    const { fetch, calls } = fakeFetch([
      {
        body: { ok: true, user_id: 'u1', username: 'probe', role: 'user', is_admin: false },
        headers: { 'Set-Cookie': `dt_token=${token}; HttpOnly; Max-Age=2592000; Path=/; SameSite=none; Secure` },
      },
    ]);
    const result = await signIn(new DtClient({ baseUrl: 'https://learn.example.com', fetch }), ' probe ', 'secret')
    expect(result.token).toBe(token);
    expect(result.account.role).toBe('user');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ username: 'probe', password: 'secret' });
    expect(tokenExpiry(token)).toBe(1_900_000_000);
  });

  it('finds the token in a folded header and copes without one', () => {
    const folded = new Headers({ 'set-cookie': 'theme=dark; Path=/, dt_token=a.b.c; HttpOnly; Path=/' });
    expect(tokenFromHeaders(folded)).toBe('a.b.c');
    expect(tokenFromHeaders(new Headers())).toBeNull();
    expect(tokenExpiry('not-a-token')).toBeNull();
  });
});

describe('sessions', () => {
  const session: DtSession = {
    id: 's1',
    title: 'Photosynthesis',
    updated_at: 1_761_998_400,
    preferences: { selected_branches: { '1': 3 } },
    messages: [
      { id: 1, role: 'user', content: 'What is photosynthesis?', parent_message_id: null },
      { id: 2, role: 'assistant', content: 'First answer', parent_message_id: 1 },
      { id: 3, role: 'assistant', content: 'Chosen answer', parent_message_id: 1 },
      { id: 4, role: 'user', content: 'And chlorophyll?', parent_message_id: 3 },
      { id: 5, role: 'assistant', content: '', parent_message_id: 4 },
    ],
  };

  it('follows the chosen branch, else the newest reply', () => {
    expect(shownMessages(session).map((message) => message.id)).toEqual([1, 3, 4, 5]);
    const unchosen = { ...session, preferences: null };
    expect(shownMessages(unchosen).map((message) => message.id)).toEqual([1, 3, 4, 5]);
    const chooseFirst = { ...session, preferences: { selected_branches: { '1': 2 } } };
    expect(shownMessages(chooseFirst).map((message) => message.id)).toEqual([1, 2]);
  });

  it('keeps the order of sessions without parent links', () => {
    const flat: DtSession = { id: 'f', title: 'Flat', messages: [{ id: 'a', role: 'user', content: 'Hi' }, { id: 'b', role: 'assistant', content: 'Hello' }] };
    expect(shownMessages(flat).map((message) => message.id)).toEqual(['a', 'b']);
  });

  it('renders the shown branch as a Markdown document', () => {
    const markdown = sessionMarkdown(session, { source: 'learn.example.com' });
    expect(markdown).toContain('# Photosynthesis');
    expect(markdown).toContain('A chat from DeepTutor (learn.example.com), last updated 2025-11-01.');
    expect(markdown).toContain('## User\n\nWhat is photosynthesis?');
    expect(markdown).toContain('## DeepTutor\n\nChosen answer');
    expect(markdown).not.toContain('First answer');
    expect(markdown.endsWith('And chlorophyll?\n')).toBe(true);
    expect(sessionFileName({ ...session, title: 'Cells: a/b?' })).toBe('DeepTutor - Cells a b.md');
  });
});

describe('notebooks', () => {
  it('reuses the MavieChat notebook and adds chat records with a summary', async () => {
    const { fetch, calls } = fakeFetch([
      { body: { notebooks: [{ id: 'n1', name: 'From MavieChat' }], total: 1 } },
      { body: { success: true, record: { id: 'r1', type: 'chat', title: 'Trip', summary: 's', user_query: 'q', output: 'o' } } },
    ]);
    const client = new DtClient({ baseUrl: 'https://learn.example.com', fetch });
    const notebook = await ensureNotebook(client);
    expect(notebook.id).toBe('n1');
    const record = await addChatRecord(client, { notebookIds: ['n1'], title: 'Trip', summary: 'Planning', userQuery: 'Plan a trip', output: '# Trip' });
    expect(record.id).toBe('r1');
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({ notebook_ids: ['n1'], record_type: 'chat', summary: 'Planning' });
    await expect(addChatRecord(client, { notebookIds: ['n1'], title: 'x', summary: ' ', userQuery: 'q', output: 'o' })).rejects.toThrow('summary');
  });

  it('creates the notebook the first time', async () => {
    const { fetch, calls } = fakeFetch([{ body: { notebooks: [], total: 0 } }, { body: { success: true, notebook: { id: 'n2', name: 'From MavieChat' } } }]);
    const notebook = await ensureNotebook(new DtClient({ baseUrl: 'https://learn.example.com', fetch }));
    expect(notebook.id).toBe('n2');
    expect(calls[1]?.init?.method).toBe('POST');
  });
});
