import { describe, expect, it } from 'vitest';
import { DtClient, type FetchLike } from './http';
import {
  addPartnerAssets,
  archivePartnerSession,
  branchPartnerSession,
  createLinkCode,
  createPartner,
  currentWebSession,
  deletePartner,
  deletePartnerSession,
  getPartnerAssets,
  getPartnerSoul,
  getPartnerToolOptions,
  listPartnerCommands,
  listPartnerLinks,
  listPartnerWorkspaces,
  listPartners,
  listPartnerSessions,
  listSkillNames,
  newPartnerSessionKey,
  offeredPartnerCommands,
  parsePartnerFrame,
  parseSlashCommand,
  partnerMessage,
  partnerHistoryPage,
  partnerSocketUrl,
  partnerTime,
  recentPartnerConversations,
  recordReply,
  removePartnerAsset,
  removePartnerLink,
  resumePartnerSession,
  savePartnerSoul,
  sessionChannel,
  startPartner,
  stopPartner,
  updatePartner,
} from './partners';

function recordingClient(answer: unknown, status = 200) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer), { status });
  };
  return { client: new DtClient({ baseUrl: 'https://learn.test', token: 't', fetch }), calls };
}

describe('partners', () => {
  it('reads partners: yours in full, shared ones as a card, odd values cleaned', async () => {
    const { client, calls } = recordingClient([
      { partner_id: 'ada', name: 'Ada', description: 'Maths', emoji: '🦉', color: '#3d6b8a', avatar: '', running: true, can_manage: true, channels: ['telegram', 'send_progress'], llm_selection: { profile_id: 'p', model_id: 'm' } },
      { partner_id: 'bo', name: 'Bo', color: 'red', avatar: 'javascript:x', running: false, can_manage: false },
      { name: 'no id' },
    ]);
    const partners = await listPartners(client);
    expect(calls[0]?.url).toBe('https://learn.test/api/partners');
    expect(partners).toHaveLength(2);
    expect(partners[0]).toMatchObject({ id: 'ada', running: true, canManage: true, channels: ['telegram'], llmSelection: { profile_id: 'p', model_id: 'm' } });
    expect(partners[1]).toMatchObject({ id: 'bo', color: '', avatar: '', canManage: false, channels: [] });
  });

  it('creates one as the web’s wizard does by default, and starts, stops and deletes', async () => {
    const { client, calls } = recordingClient({ partner_id: 'ada', name: 'Ada', running: true, start_error: '' });
    const made = await createPartner(client, { name: ' Ada ', description: '', emoji: '🦉', color: '#3d6b8a', soul: { source: 'library', id: 'math-tutor' }, skills: ['notes'] });
    expect(made.partner.id).toBe('ada');
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://learn.test/api/partners' });
    expect(calls[0]?.body).toEqual({
      name: 'Ada',
      workspace_id: '',
      soul: { source: 'library', id: 'math-tutor' },
      llm_selection: null,
      enabled_tools: null,
      builtin_tools: null,
      mcp_tools: [],
      assets: { knowledge_bases: [], skills: ['notes'], notebooks: [] },
      start: true,
      emoji: '🦉',
      color: '#3d6b8a',
    });
    await startPartner(client, 'a/b');
    await stopPartner(client, 'a/b');
    await deletePartner(client, 'a/b');
    expect(calls.slice(1).map((call) => `${call.method} ${call.url.replace('https://learn.test', '')}`)).toEqual(['POST /api/partners/a%2Fb/start', 'POST /api/partners/a%2Fb/stop', 'DELETE /api/partners/a%2Fb']);
  });

  it('lists skills either way DeepTutor answers', async () => {
    expect(await listSkillNames(recordingClient({ skills: [{ name: 'notes' }, { name: '' }] }).client)).toEqual(['notes']);
    expect(await listSkillNames(recordingClient([{ name: 'a' }, 'b']).client)).toEqual(['a', 'b']);
  });

  it('reads recent conversations, in their own time format', async () => {
    const recent = await recentPartnerConversations(recordingClient({ sessions: [{ kind: 'partner', owner_id: 'ada', owner_name: 'Ada', session_key: 'web-1', title: 'Hi', updated_at: 1_762_236_000.5 }] }).client);
    expect(recent).toEqual([{ kind: 'partner', ownerId: 'ada', ownerName: 'Ada', sessionKey: 'web-1', title: 'Hi', updatedAt: 1_762_236_000_500 }]);
  });

  it('reads the server’s zoneless times as UTC, trimming microseconds', () => {
    expect(partnerTime('2026-11-04T06:20:42.229892')).toBe(Date.UTC(2026, 10, 4, 6, 20, 42, 229));
    expect(partnerTime('2026-11-04 06:20:42')).toBe(Date.UTC(2026, 10, 4, 6, 20, 42));
    expect(partnerTime('2026-11-04T06:20:42+08:00')).toBe(Date.UTC(2026, 10, 3, 22, 20, 42));
    expect(partnerTime(1_762_236_000)).toBe(1_762_236_000_000);
    expect(partnerTime('nonsense')).toBeNull();
    expect(partnerTime(null)).toBeNull();
  });
});

describe('conversations', () => {
  it('lists them with where they were held, and picks the one to carry on', async () => {
    const { client, calls } = recordingClient([
      { session_key: 'telegram_42', title: 'From the phone', message_count: 4, updated_at: '2026-11-04T07:00:00', archived: false },
      { session_key: 'web-old', title: 'Old', message_count: 6, archived: true },
      { session_key: 'web_abc', title: 'Current', message_count: 2, archived: false },
    ]);
    const sessions = await listPartnerSessions(client, 'ada');
    expect(calls[0]?.url).toBe('https://learn.test/api/partners/ada/sessions');
    expect(sessions.map((session) => session.channel)).toEqual(['telegram', 'web', 'web']);
    expect(currentWebSession(sessions)?.key).toBe('web_abc');
    expect(sessionChannel('partner:ada')).toBe('web');
  });

  it('makes keys as the web does', () => {
    const key = newPartnerSessionKey(() => 0.5);
    expect(key).toBe('web-iiiiiiii');
    expect(newPartnerSessionKey()).toMatch(/^web-[0-9a-z]{8}$/);
  });

  it('archives, resumes and deletes over the web’s routes', async () => {
    const { client, calls } = recordingClient({ archived: true });
    await archivePartnerSession(client, 'ada', 'web-1');
    await resumePartnerSession(client, 'ada', 'web-1');
    await deletePartnerSession(client, 'ada', 'web-1');
    expect(calls.map((call) => `${call.method} ${call.url.replace('https://learn.test/api/partners/ada', '')}`)).toEqual(['POST /sessions/archive', 'POST /sessions/resume', 'POST /sessions/delete']);
    expect(calls.every((call) => (call.body as { session_key: string }).session_key === 'web-1')).toBe(true);
  });

  it('reads a page of history and rebuilds a saved reply from its events', async () => {
    const { client, calls } = recordingClient({
      messages: [
        { role: 'user', content: 'Hi', timestamp: '2026-11-04T06:00:00', channel: 'web', attachments: [{ filename: 'notes.pdf', path: '/srv/x' }] },
        { role: 'system', content: 'hidden' },
        {
          role: 'assistant',
          content: 'Hello!',
          events: [
            { type: 'thinking', content: 'Greeting', metadata: {}, seq: 1 },
            { type: 'tool_call', content: 'web_search', metadata: { call_id: 'c1', args: { q: 'x' } }, seq: 2 },
            { type: 'done', content: '', metadata: {}, seq: 3 },
          ],
        },
      ],
      next_before: 40,
      start: 40,
      total: 100,
    });
    const page = await partnerHistoryPage(client, 'ada', 'web-1', 100);
    expect(calls[0]?.url).toBe('https://learn.test/api/partners/ada/history/page?session_key=web-1&before=100&limit=60');
    expect(page.nextBefore).toBe(40);
    expect(page.records.map((record) => [record.index, record.role])).toEqual([
      [40, 'user'],
      [42, 'assistant'],
    ]);
    expect(page.records[0]?.attachments).toEqual(['notes.pdf']);
    const reply = recordReply(page.records[1]!);
    expect(reply).toMatchObject({ answer: 'Hello!', status: 'completed' });
    expect(reply.tools.length + reply.thoughts.length).toBeGreaterThan(0);
  });
});

describe('the partner socket', () => {
  it('has its own address (no token in it)', () => {
    expect(partnerSocketUrl('https://learn.test/', 'ada lovelace')).toBe('wss://learn.test/ws/partners/ada%20lovelace');
  });

  it('reads frames, leaving out other apps’ activity and unknown ones', () => {
    expect(parsePartnerFrame('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parsePartnerFrame({ type: 'stale_session', content: 'x', active_session_key: 'web-2' })).toEqual({ type: 'stale_session', content: 'x', activeSessionKey: 'web-2' });
    expect(parsePartnerFrame({ type: 'stream_event', event: { type: 'content', content: 'Hi', metadata: {}, seq: 1 } })).toMatchObject({ type: 'stream_event', event: { type: 'content', content: 'Hi' } });
    expect(parsePartnerFrame({ type: 'content', content: 'x', external: true })).toBeNull();
    expect(parsePartnerFrame({ type: 'mystery' })).toBeNull();
    expect(parsePartnerFrame('not json')).toBeNull();
  });
});

describe('setting a partner up', () => {
  it('sends only the settings changed, null meaning DeepTutor’s default', async () => {
    const { client, calls } = recordingClient({ partner_id: 'ada', name: 'Ada', backup_llm_selection: { profile_id: 'p', model_id: 'b' }, enabled_tools: ['web_search'], builtin_tools: null, mcp_tools: null, workspace_id: 'w1' });
    const partner = await updatePartner(client, 'ada', { name: 'Ada 2', avatar: '', llmSelection: null, enabledTools: ['web_search'], workspaceId: '' });
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: 'https://learn.test/api/partners/ada' });
    expect(calls[0]?.body).toEqual({ name: 'Ada 2', avatar: '', llm_selection: null, enabled_tools: ['web_search'], workspace_id: '' });
    expect(partner).toMatchObject({ backupLlmSelection: { profile_id: 'p', model_id: 'b' }, enabledTools: ['web_search'], builtinTools: null, mcpTools: null, workspaceId: 'w1' });
  });

  it('reads and saves the soul', async () => {
    const { client, calls } = recordingClient({ partner_id: 'ada', content: '# Ada' });
    expect(await getPartnerSoul(client, 'ada')).toBe('# Ada');
    await savePartnerSoul(client, 'ada', '# Ada, kinder');
    expect(calls[1]).toMatchObject({ method: 'PUT', url: 'https://learn.test/api/partners/ada/soul', body: { content: '# Ada, kinder' } });
  });

  it('reads tool options in English, and workspaces it can be bound to', async () => {
    const tools = await getPartnerToolOptions(
      recordingClient({ tools: [{ name: 'web_search', description: 'x', description_i18n: { en: 'Search the web', zh: '搜索' } }], builtin_tools: [{ name: 'rag', description: 'Knowledge' }], mcp_tools: [{ name: 'mcp__a', server: 'Files', description: 'Read files' }, { description: 'nameless' }] }).client,
    );
    expect(tools).toEqual({ tools: [{ name: 'web_search', description: 'Search the web' }], builtin: [{ name: 'rag', description: 'Knowledge' }], mcp: [{ name: 'mcp__a', description: 'Read files', server: 'Files' }] });
    const workspaces = await listPartnerWorkspaces(
      recordingClient({ workspaces: [{ workspace_id: 'sys', kind: 'system', status: 'ready' }, { workspace_id: 'old', kind: 'general', archived: true }, { workspace_id: 'bad', kind: 'workspace', status: 'invalid' }, { workspace_id: 'w1', kind: 'workspace', display_name: 'Thesis', status: 'ready' }] }).client,
      'ada',
    );
    expect(workspaces).toEqual([{ id: 'w1', name: 'Thesis' }]);
  });

  it('reads, adds and removes library assets, reporting what wasn’t copied', async () => {
    const assets = { knowledge_bases: [{ name: 'Physics', documents: 3 }], skills: [{ name: 'notes' }], notebooks: [{ id: 'n1', name: 'Ideas', record_count: 2 }] };
    expect(await getPartnerAssets(recordingClient(assets).client, 'ada')).toEqual({ knowledgeBases: [{ name: 'Physics', documents: 3 }], skills: ['notes'], notebooks: [{ id: 'n1', name: 'Ideas', records: 2 }] });
    const { client, calls } = recordingClient({ copied: {}, errors: [{ type: 'knowledge_base', name: 'Vault', error: 'connected bases can’t be copied' }], assets });
    const added = await addPartnerAssets(client, 'ada', { knowledgeBases: ['Vault'] });
    expect(calls[0]?.body).toEqual({ knowledge_bases: ['Vault'], skills: [], notebooks: [] });
    expect(added.errors).toEqual(['Vault: connected bases can’t be copied']);
    await removePartnerAsset(client, 'ada', 'notebook', 'n/1');
    expect(calls[1]).toMatchObject({ method: 'DELETE', url: 'https://learn.test/api/partners/ada/assets/notebook/n%2F1' });
  });
});

describe('links, branches and commands', () => {
  it('makes a link code, lists links and unlinks one (its key holds a colon)', async () => {
    const code = await createLinkCode(recordingClient({ partner_id: 'ada', code: 'AB2CD3', expires_at: '2026-11-04T08:00:00+00:00', command: '/link AB2CD3' }).client, 'ada');
    expect(code).toEqual({ code: 'AB2CD3', command: '/link AB2CD3', expiresAt: Date.UTC(2026, 10, 4, 8) });
    const { client, calls } = recordingClient({ links: [{ key: 'telegram:42', user_id: 'u', channel: 'telegram', sender_id: '42', linked_at: '2026-11-04T07:00:00+00:00' }] });
    expect(await listPartnerLinks(client, 'ada')).toEqual([{ key: 'telegram:42', channel: 'telegram', senderId: '42', linkedAt: Date.UTC(2026, 10, 4, 7) }]);
    await removePartnerLink(client, 'ada', 'telegram:42');
    expect(calls[1]).toMatchObject({ method: 'DELETE', url: 'https://learn.test/api/partners/ada/links/telegram%3A42' });
  });

  it('branches a conversation', async () => {
    const { client, calls } = recordingClient({ branched: true });
    await branchPartnerSession(client, 'ada', 'web-1', 'web-2');
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://learn.test/api/partners/ada/sessions/branch', body: { source_key: 'web-1', new_key: 'web-2' } });
  });

  it('lists commands, offering only what fits, and reads typed ones', async () => {
    const commands = await listPartnerCommands(
      recordingClient({ commands: [{ command: '/help', description: 'Help' }, { command: '/model', description: 'Model', arg_hint: '[name]' }, { command: '/tool', description: 'Tools' }, { command: '/link', description: 'Link' }, { command: 'oops' }] }).client,
    );
    expect(commands.map((row) => row.command)).toEqual(['/help', '/model', '/tool', '/link']);
    expect(offeredPartnerCommands(commands, true).map((row) => row.command)).toEqual(['/help', '/model', '/tool']);
    expect(offeredPartnerCommands(commands, false).map((row) => row.command)).toEqual(['/help']);
    expect(parseSlashCommand('/Resume  web-1 ')).toEqual({ command: '/resume', argument: 'web-1' });
    expect(parseSlashCommand('/new')).toEqual({ command: '/new', argument: '' });
    expect(parseSlashCommand('not a command')).toBeNull();
    expect(parseSlashCommand('/ path')).toBeNull();
  });

  it('puts files in a message under DeepTutor’s names', () => {
    expect(JSON.parse(partnerMessage('web-1', 'Look', [{ type: 'image', filename: 'a.png', mimeType: 'image/png', base64: 'AA' }]))).toEqual({
      content: 'Look',
      session_key: 'web-1',
      attachments: [{ type: 'image', filename: 'a.png', mime_type: 'image/png', base64: 'AA' }],
    });
    expect(JSON.parse(partnerMessage('web-1', 'Hi'))).toEqual({ content: 'Hi', session_key: 'web-1' });
  });
});
