import { describe, expect, it } from 'vitest';
import { getCliCatalog } from './cliApps';
import { DtClient, DtHttpError, type FetchLike } from './http';
import { getMcpCatalog, getMcpState, isSecretRef, mcpConfigOf, mcpDraftOf, mcpNameProblem, mcpRefusal, pickText, setMcpServerEnabled } from './mcp';

function recordingClient(...answers: unknown[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
  };
  return { client: new DtClient({ baseUrl: 'https://learn.test', token: 't', fetch }), calls };
}

const STATE = {
  servers: {
    notes: { url: 'https://notes.example/mcp', headers: { Authorization: '${secret:notes/header.Authorization}' }, tool_timeout: 30, enabled_tools: ['*'], disabled_tools: ['mcp_notes_wipe'], catalog_entry: 'notes', enabled: true },
    off: { url: 'https://off.example/sse', type: 'sse', enabled: false },
    fresh: { url: 'https://fresh.example/mcp' },
    calendar: { url: 'https://cal.example/mcp', auth: 'oauth' },
  },
  status: [
    { name: 'notes', transport: 'streamableHttp', status: 'connected', tools: [{ name: 'mcp_notes_search', description: '[notes] Search' }] },
    { name: 'calendar', status: 'needs_auth', error: 'Sign-in needed' },
  ],
  configured_secrets: { notes: ['header.Authorization'] },
  oauth: { calendar: { required: true, authorized: false } },
  rejected: [{ name: 'local', reason: 'private address' }],
  deployment: { servers: ['search'], status: [{ name: 'search', status: 'connected', tools: [{}, {}] }] },
  limits: { max_servers: 8 },
};

describe('MCP servers', () => {
  it('reads each server with its state, credentials (names only) and sign-in', async () => {
    const state = await getMcpState(recordingClient(STATE).client);
    expect(state.servers.map((server) => [server.name, server.status, server.tools.length, server.credentials, server.oauth, server.authorized])).toEqual([
      ['calendar', 'needs_auth', 0, [], true, false],
      ['fresh', 'connecting', 0, [], false, null],
      ['notes', 'connected', 1, ['header.Authorization'], false, null],
      ['off', 'disabled', 0, [], false, null],
    ]);
    expect(state.rejected).toEqual([{ name: 'local', reason: 'private address' }]);
    expect(state.deployment).toEqual([{ name: 'search', status: 'connected', tools: 2 }]);
    expect(state.maxServers).toBe(8);
  });

  it('saves a server whole, keeping what the form doesn’t edit and stored credentials as they came', async () => {
    const state = await getMcpState(recordingClient(STATE).client);
    const notes = state.servers.find((server) => server.name === 'notes')!;
    const draft = mcpDraftOf(notes);
    expect(draft).toEqual({ url: 'https://notes.example/mcp', transport: '', headers: [{ key: 'Authorization', value: '${secret:notes/header.Authorization}' }], timeout: 30, enabledTools: [] });
    expect(isSecretRef(draft.headers[0]!.value)).toBe(true);
    const config = mcpConfigOf({ ...draft, timeout: 900, enabledTools: ['mcp_notes_search'] }, notes.config);
    expect(config).toMatchObject({ disabled_tools: ['mcp_notes_wipe'], catalog_entry: 'notes', tool_timeout: 600, enabled_tools: ['mcp_notes_search'], headers: { Authorization: '${secret:notes/header.Authorization}' }, type: null, enabled: true });
    const { client, calls } = recordingClient(STATE);
    await setMcpServerEnabled(client, notes, false);
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'https://learn.test/api/space/mcp/servers/notes', body: { config: { ...notes.config, enabled: false }, secrets: {} } });
  });

  it('checks names and says what a refusal means', () => {
    expect(mcpNameProblem('')).toBe('Give it a name.');
    expect(mcpNameProblem('bad name')).not.toBeNull();
    expect(mcpNameProblem('mcp_x')).toBe('It can’t start with mcp_ or cli_.');
    expect(mcpNameProblem('notes', ['notes'])).toBe('You have a server by that name.');
    expect(mcpNameProblem('my-notes_2')).toBeNull();
    expect(mcpRefusal(new DtHttpError(400, 'x', '/x', 'mcp.too_many_servers'))).toContain('as many servers');
    expect(mcpRefusal(new DtHttpError(400, 'the host resolves to a private address', '/x', 'mcp.blocked_url'))).toBe('That address can’t be used: the host resolves to a private address');
    expect(mcpRefusal(new DtHttpError(500, 'x', '/x'))).toBeNull();
  });
});

describe('the stores', () => {
  it('pages the MCP store and picks text in the phone’s language', async () => {
    const { client, calls } = recordingClient({
      entries: [{ id: 'notes', display_name: 'Notes', description_i18n: { en: 'Your notes', zh: '笔记' }, category: 'docs', tier: 'curated', trust: 'unverified', installed: false, fields: [{ key: 'token', label_i18n: { en: 'Token' }, secret: true, required: true }] }],
      next_cursor: '30',
      total: 31,
      categories: { docs: 4 },
    });
    const page = await getMcpCatalog(client, { q: 'notes', category: 'docs', language: 'zh-Hans' });
    expect(calls[0]?.url).toBe('https://learn.test/api/space/mcp/catalog?limit=30&q=notes&category=docs');
    expect(page.entries[0]).toMatchObject({ id: 'notes', description: '笔记', verified: false, fields: [{ key: 'token', label: 'Token', secret: true, required: true }] });
    expect(page).toMatchObject({ next: '30', total: 31, categories: { docs: 4 } });
    expect(pickText({ fr: 'Bonjour' }, 'de')).toBe('Bonjour');
  });

  it('reads the CLI store, installable ones only unless asked', async () => {
    const { client, calls } = recordingClient({ entries: [{ id: 'pandoc', display_name: 'Pandoc', trust: 'first-party', installable: true, requires: 'python', installed: false, pinned: true }], next_cursor: '', total: 1, categories: { docs: 1 } });
    const page = await getCliCatalog(client, { q: 'doc' });
    expect(calls[0]?.url).toBe('https://learn.test/api/space/cli-apps/catalog?limit=24&installable_only=true&q=doc');
    expect(page.entries[0]).toMatchObject({ id: 'pandoc', name: 'Pandoc', firstParty: true, installable: true, requires: 'python', pinned: true });
  });
});
