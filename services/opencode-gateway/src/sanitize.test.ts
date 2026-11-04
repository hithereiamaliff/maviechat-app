import { describe, expect, it } from 'vitest';
import { cleanAgents, cleanProviders, eventAllowed, eventFilter } from './sanitize.ts';

describe('what the gateway forwards', () => {
  it('strips API keys and settings from the provider list', () => {
    const cleaned = cleanProviders({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          source: 'custom',
          key: 'sk-secret',
          env: ['OPENAI_API_KEY'],
          options: { apiKey: 'sk-secret', baseURL: 'https://x' },
          models: { m1: { id: 'm1', providerID: 'openai', name: 'M1', headers: { Authorization: 'Bearer sk-secret' }, options: { apiKey: 'sk-secret' }, api: { url: 'https://x', id: 'm1', npm: 'p' }, variants: { high: { reasoningEffort: 'high' } } } },
        },
      ],
      default: { openai: 'm1' },
    });
    expect(JSON.stringify(cleaned)).not.toContain('secret');
    expect(cleaned).toEqual({ providers: [{ id: 'openai', name: 'OpenAI', source: 'custom', models: { m1: { id: 'm1', providerID: 'openai', name: 'M1', variants: { high: {} } } } }], default: { openai: 'm1' } });
  });

  it('keeps agents to their names and kinds', () => {
    expect(cleanAgents([{ name: 'build', mode: 'primary', prompt: 'You are…', options: { apiKey: 'x' }, permission: [] }])).toEqual([{ name: 'build', mode: 'primary' }]);
    expect(cleanAgents({ not: 'a list' })).toEqual([]);
  });

  it('passes only the event kinds the app uses', async () => {
    expect(eventAllowed('data: {"type":"message.part.delta","properties":{}}')).toBe(true);
    expect(eventAllowed('data: {"type":"integration.updated","properties":{"secret":"x"}}')).toBe(false);
    expect(eventAllowed(': comment')).toBe(false);
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"type":"server.connected","properties":{}}\n\ndata: {"type":"catalog.upd'));
        controller.enqueue(encoder.encode('ated","properties":{"key":"x"}}\n\ndata: {"type":"session.idle","properties":{"sessionID":"s"}}\n\n'));
        controller.close();
      },
    });
    let text = '';
    const reader = source.pipeThrough(eventFilter()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    expect(text).toBe('data: {"type":"server.connected","properties":{}}\n\ndata: {"type":"session.idle","properties":{"sessionID":"s"}}\n\n');
  });
});
