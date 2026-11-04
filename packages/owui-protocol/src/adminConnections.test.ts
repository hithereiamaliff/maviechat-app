import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { connectionsOf, headersFromText, idsFromText, saveConnectionConfig, tagsFromText, withConnectionAdded, withConnectionChange, withConnectionRemoved, withKindOn } from './adminConnections';

const OPENAI = {
  ENABLE_OPENAI_API: true,
  OPENAI_API_BASE_URLS: ['https://a.test/v1', 'https://b.test/v1', 'https://c.test/v1'],
  OPENAI_API_KEYS: ['ka', 'kb'],
  OPENAI_API_CONFIGS: { '0': { prefix_id: 'a', extra_params: { x: 1 } }, '2': { enable: false, tags: [{ name: 'c' }] } },
};

describe('admin connections', () => {
  it('reads each connection with its key and settings', () => {
    const [a, b, c] = connectionsOf(OPENAI, 'openai');
    expect(a).toMatchObject({ index: 0, url: 'https://a.test/v1', key: 'ka', enabled: true });
    expect(b).toMatchObject({ key: 'kb', config: {} });
    expect(c).toMatchObject({ key: '', enabled: false });
    expect(connectionsOf({ OLLAMA_BASE_URLS: ['http://o.test'], OLLAMA_API_CONFIGS: { '0': { key: 'ok' } } }, 'ollama')[0]).toMatchObject({ key: 'ok' });
  });

  it('changes only what was edited, keeping unknown settings', () => {
    const next = withConnectionChange(OPENAI, 'openai', 0, { settings: { prefix_id: 'z', enable: false } });
    expect(next.OPENAI_API_CONFIGS).toEqual({ '0': { prefix_id: 'z', extra_params: { x: 1 }, enable: false }, '2': OPENAI.OPENAI_API_CONFIGS['2'] });
    expect(next.OPENAI_API_BASE_URLS).toBe(OPENAI.OPENAI_API_BASE_URLS);
    expect(next.OPENAI_API_KEYS).toBe(OPENAI.OPENAI_API_KEYS);
    const keyed = withConnectionChange(OPENAI, 'openai', 2, { key: 'kc' });
    expect(keyed.OPENAI_API_KEYS).toEqual(['ka', 'kb', 'kc']);
    expect(keyed.OPENAI_API_CONFIGS).toBe(OPENAI.OPENAI_API_CONFIGS);
    expect(withConnectionChange(OPENAI, 'openai', 0, { settings: { prefix_id: undefined } }).OPENAI_API_CONFIGS).toMatchObject({ '0': { extra_params: { x: 1 } } });
    expect(() => withConnectionChange(OPENAI, 'openai', 5, { url: 'x' })).toThrow();
  });

  it('takes one out, moving the later ones up with their keys and settings', () => {
    const next = withConnectionRemoved(OPENAI, 'openai', 1);
    expect(next.OPENAI_API_BASE_URLS).toEqual(['https://a.test/v1', 'https://c.test/v1']);
    expect(next.OPENAI_API_KEYS).toEqual(['ka']);
    expect(next.OPENAI_API_CONFIGS).toEqual({ '0': OPENAI.OPENAI_API_CONFIGS['0'], '1': OPENAI.OPENAI_API_CONFIGS['2'] });
    expect(next.ENABLE_OPENAI_API).toBe(true);
  });

  it('adds one at the end, its key beside it', () => {
    const next = withConnectionAdded(OPENAI, 'openai', { url: ' https://d.test/v1 ', key: 'kd', settings: { model_ids: ['m'], tags: undefined } });
    expect(next.OPENAI_API_BASE_URLS).toHaveLength(4);
    expect(next.OPENAI_API_KEYS).toEqual(['ka', 'kb', '', 'kd']);
    expect((next.OPENAI_API_CONFIGS as Record<string, unknown>)['3']).toEqual({ model_ids: ['m'] });
    const ollama = withConnectionAdded({ ENABLE_OLLAMA_API: false, OLLAMA_BASE_URLS: [], OLLAMA_API_CONFIGS: {} }, 'ollama', { url: 'http://o.test', key: 'ok', settings: {} });
    expect(ollama.OLLAMA_API_CONFIGS).toEqual({ '0': { key: 'ok' } });
  });

  it('always sends the kind’s on/off switch, so a save never switches it off by leaving it out', async () => {
    const bodies: unknown[] = [];
    const fetch: FetchLike = async (_url, init) => {
      bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
      return new Response('{}', { status: 200 });
    };
    await saveConnectionConfig(new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), 'openai', withKindOn(OPENAI, 'openai', false));
    expect(bodies[0]).toEqual({ ENABLE_OPENAI_API: false, OPENAI_API_BASE_URLS: OPENAI.OPENAI_API_BASE_URLS, OPENAI_API_CONFIGS: OPENAI.OPENAI_API_CONFIGS, OPENAI_API_KEYS: OPENAI.OPENAI_API_KEYS });
  });

  it('reads lists and headers as stored', () => {
    expect(tagsFromText('a, b ,,')).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(idsFromText('gpt-a, gpt-b\ngpt-c')).toEqual(['gpt-a', 'gpt-b', 'gpt-c']);
    expect(headersFromText('{"X-Team":"a"}')).toEqual({ headers: { 'X-Team': 'a' }, problem: null });
    expect(headersFromText('[1]').problem).toBeTruthy();
    expect(headersFromText('').headers).toBeNull();
  });
});
