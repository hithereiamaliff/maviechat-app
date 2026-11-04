import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { addMemory, cleanMemoryPath, clearMemories, deleteMemory, filterMemories, listMemories, memoryOn, updateMemory, type Memory } from './memories';

function recordingClient(answer: unknown) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch }), calls };
}

const memory = (id: string, updated: number, extra: Partial<Memory> = {}): Memory => ({ id, type: 'user', path: null, content: id, updated_at: updated, created_at: 1, ...extra });

describe('memories', () => {
  it('lists newest change first, reading types and empty paths as the server means them', async () => {
    const { client, calls } = recordingClient([
      { id: 'a', type: 'user', path: '', content: 'Old', updated_at: 10, created_at: 1, user_id: 'u' },
      { id: 'b', type: 'context', path: 'work/projects', content: 'New', updated_at: 20, created_at: 2 },
      { id: 'c', type: 'odd', content: 'Typeless', updated_at: 15 },
      { content: 'no id' },
    ]);
    const list = await listMemories(client);
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'https://x.test/api/v1/memories/' });
    expect(list.map((item) => item.id)).toEqual(['b', 'c', 'a']);
    expect(list[1]?.type).toBe('context');
    expect(list[2]).toMatchObject({ path: null, user_id: 'u' });
  });

  it('adds, edits (an empty path clears it), removes and clears over the web’s routes', async () => {
    const { client, calls } = recordingClient({ id: 'm/1', type: 'user', path: null, content: 'Likes tea', updated_at: 3, created_at: 3 });
    expect((await addMemory(client, { content: '  Likes tea ', type: 'user', path: ' ' })).id).toBe('m/1');
    await updateMemory(client, 'm/1', { content: 'Likes green tea', type: 'context', path: '' });
    await deleteMemory(client, 'm/1');
    await clearMemories(client);
    expect(calls.map((call) => `${call.method} ${call.url.replace('https://x.test', '')}`)).toEqual([
      'POST /api/v1/memories/add',
      'POST /api/v1/memories/m%2F1/update',
      'DELETE /api/v1/memories/m%2F1',
      'DELETE /api/v1/memories/delete/user',
    ]);
    expect(calls[0]?.body).toEqual({ content: 'Likes tea', type: 'user', path: null });
    expect(calls[1]?.body).toEqual({ content: 'Likes green tea', type: 'context', path: '' });
  });

  it('cleans paths as the server does and says why it would refuse one', () => {
    expect(cleanMemoryPath(' /work//projects/ ')).toEqual({ path: 'work/projects' });
    expect(cleanMemoryPath('  ')).toEqual({ path: null });
    expect(cleanMemoryPath('work/../secrets').error).toBeTruthy();
    expect(cleanMemoryPath('./x').error).toBeTruthy();
    expect(cleanMemoryPath('a\u0007b').error).toBeTruthy();
  });

  it('searches words, paths and types', () => {
    const list = [memory('Likes tea', 2), memory('Works at home', 1, { path: 'work/where', type: 'context' })];
    expect(filterMemories(list, '  TEA ').map((item) => item.id)).toEqual(['Likes tea']);
    expect(filterMemories(list, 'work/').map((item) => item.id)).toEqual(['Works at home']);
    expect(filterMemories(list, 'context')).toHaveLength(1);
    expect(filterMemories(list, '')).toHaveLength(2);
  });

  it('reads the Memory switch as the web does: yours, else the admin’s switch', () => {
    expect(memoryOn({ memory: false }, { features: { enable_memories: true } })).toBe(false);
    expect(memoryOn({}, { features: { enable_memories: true } })).toBe(true);
    expect(memoryOn(null, { features: {} })).toBe(false);
    expect(memoryOn({ memory: true }, undefined)).toBe(true);
  });
});
