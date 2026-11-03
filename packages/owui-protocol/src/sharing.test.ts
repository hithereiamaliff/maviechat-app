import { describe, expect, it } from 'vitest';
import type { ChatRecord } from './chats';
import { OwuiClient, type FetchLike } from './http';
import {
  addChatTag,
  chatJson,
  chatPlainText,
  cleanTagName,
  cloneChat,
  cloneSharedChat,
  exportFileName,
  forkChat,
  getShareAccess,
  listShareGroups,
  listTags,
  removeChatTag,
  searchUsers,
  setShareAccess,
  sharedChatUrl,
  sharedWith,
  shareVisibility,
  tagId,
  typedTag,
  withShareVisibility,
  withSharedWith,
  withTagSearch,
  type ShareGrant,
} from './sharing';

function recordingClient(answer: unknown = []) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch }), calls };
}

describe('tags', () => {
  it('keys and cleans names as the server does', () => {
    expect(tagId('Tax Return 2026')).toBe('tax_return_2026');
    expect(cleanTagName('  tax   return ')).toBe('tax return');
    expect(cleanTagName(' None ')).toBe('');
  });

  it('adds, removes and lists over the web’s endpoints', async () => {
    const { client, calls } = recordingClient([{ id: 'tax', name: 'Tax' }, { name: 'nameless' }]);
    expect(await addChatTag(client, 'c/1', 'Tax')).toEqual([{ id: 'tax', name: 'Tax' }]);
    await removeChatTag(client, 'c/1', 'Tax');
    await listTags(client);
    expect(calls.map((call) => `${call.method} ${call.url} ${JSON.stringify(call.body ?? null)}`)).toEqual([
      'POST https://x.test/api/v1/chats/c%2F1/tags {"name":"Tax"}',
      'DELETE https://x.test/api/v1/chats/c%2F1/tags {"name":"Tax"}',
      'GET https://x.test/api/v1/chats/all/tags null',
    ]);
  });

  it('finds the tag being typed in a search and swaps it for the chosen one', () => {
    expect(typedTag('budget tag:ta')).toBe('ta');
    expect(typedTag('tag:')).toBe('');
    expect(typedTag('budget')).toBeNull();
    expect(withTagSearch('budget tag:ta', { id: 'tax_return' })).toBe('budget tag:tax_return');
    expect(withTagSearch('', { id: 'tax' })).toBe('tag:tax');
  });
});

describe('share links', () => {
  const people: ShareGrant[] = [
    { principal_type: 'user', principal_id: 'u1', permission: 'read' },
    { principal_type: 'group', principal_id: 'g1', permission: 'read' },
  ];

  it('reads and sets who may open the link, keeping the people added', () => {
    expect(shareVisibility(people)).toBe('private');
    const open = withShareVisibility(people, 'open');
    expect(shareVisibility(open)).toBe('open');
    const everyone = withShareVisibility(open, 'public');
    expect(shareVisibility(everyone)).toBe('public');
    expect(everyone.filter((grant) => grant.principal_id === '*')).toEqual([{ principal_type: 'user', principal_id: '*', permission: 'read' }]);
    expect(withShareVisibility(everyone, 'private')).toEqual(people);
    expect(sharedWith(everyone)).toEqual({ users: ['u1'], groups: ['g1'] });
    expect(sharedWith(withSharedWith(withSharedWith(people, 'user', 'u2', true), 'group', 'g1', false))).toEqual({ users: ['u1', 'u2'], groups: [] });
  });

  it('talks to the share endpoints', async () => {
    const { client, calls } = recordingClient([{ principal_type: 'user', principal_id: 'u1', permission: 'read' }, { principal_type: 'robot', principal_id: 'x', permission: 'read' }]);
    expect(await getShareAccess(client, 'c1')).toEqual([{ principal_type: 'user', principal_id: 'u1', permission: 'read' }]);
    await setShareAccess(client, 'c1', people);
    await cloneSharedChat(client, 's1');
    await cloneChat(client, 'c1', 'Clone of Taxes');
    await forkChat(client, 'c1');
    expect(calls.map((call) => `${call.method} ${call.url} ${JSON.stringify(call.body ?? null)}`)).toEqual([
      'GET https://x.test/api/v1/chats/shared/c1/access null',
      `POST https://x.test/api/v1/chats/shared/c1/access/update ${JSON.stringify({ access_grants: people })}`,
      'POST https://x.test/api/v1/chats/s1/clone/shared null',
      'POST https://x.test/api/v1/chats/c1/clone {"title":"Clone of Taxes"}',
      'POST https://x.test/api/v1/chats/c1/fork {"message_id":null}',
    ]);
    expect(sharedChatUrl('https://chat.example/', 'abc')).toBe('https://chat.example/s/abc');
  });

  it('finds people and groups to share with', async () => {
    const users = recordingClient({ users: [{ id: 'u1', name: 'Aisyah', email: 'a@x' }, { id: '', name: 'ghost' }], total: 1 });
    expect(await searchUsers(users.client, 'ais')).toEqual([{ id: 'u1', name: 'Aisyah', email: 'a@x' }]);
    expect(users.calls[0]?.url).toBe('https://x.test/api/v1/users/search?query=ais&page=1');
    const groups = recordingClient([{ id: 'g1', name: 'Tutors', member_count: 3 }]);
    expect(await listShareGroups(groups.client)).toEqual([{ id: 'g1', name: 'Tutors', members: 3 }]);
    expect(groups.calls[0]?.url).toBe('https://x.test/api/v1/groups/?share=true');
  });
});

describe('downloads', () => {
  const chat: ChatRecord = {
    id: 'c1',
    title: 'Taxes: 2026/27?',
    updated_at: 1,
    created_at: 1,
    chat: {
      history: {
        currentId: 'a2',
        messages: {
          u1: { id: 'u1', parentId: null, childrenIds: ['a1', 'a2'], role: 'user', content: 'How much?' },
          a1: { id: 'a1', parentId: 'u1', childrenIds: [], role: 'assistant', content: 'Older answer' },
          a2: { id: 'a2', parentId: 'u1', childrenIds: [], role: 'assistant', content: '', output: [{ type: 'message', id: 'o', role: 'assistant', content: [{ type: 'output_text', text: 'About 10%.' }] }] },
        },
      },
    },
  } as unknown as ChatRecord;

  it('writes the shown branch as the web’s plain text', () => {
    expect(chatPlainText(chat)).toBe('### USER\nHow much?\n\n### ASSISTANT\nAbout 10%.');
  });

  it('exports the whole record and names files safely', () => {
    expect(JSON.parse(chatJson(chat))).toEqual([chat]);
    expect(exportFileName(chat.title, 'txt')).toBe('chat-Taxes 2026 27.txt');
    expect(exportFileName('', 'json')).toBe('chat-export-chat.json');
  });
});
