import { describe, expect, it } from 'vitest';
import { contextUsage, contextUsageLabel, formatTokenCount, usageTokenCount } from './chatStatus';
import type { ChatHistory } from './history';

const history = (messages: Record<string, unknown>[]): ChatHistory => {
  const map: ChatHistory['messages'] = {};
  messages.forEach((message, index) => {
    map[`m${index}`] = { id: `m${index}`, parentId: index ? `m${index - 1}` : null, childrenIds: index < messages.length - 1 ? [`m${index + 1}`] : [], role: index % 2 ? 'assistant' : 'user', content: '', ...message } as ChatHistory['messages'][string];
  });
  return { messages: map, currentId: `m${messages.length - 1}` };
};

describe('/status', () => {
  it('counts the tokens providers report', () => {
    expect(usageTokenCount({ prompt_tokens: 100, completion_tokens: 20 })).toBe(120);
    expect(usageTokenCount({ input_tokens: 50, output_tokens: 5 })).toBe(55);
    expect(usageTokenCount({ prompt_n: 10, cache_n: 30, predicted_n: 2 })).toBe(42);
    expect(usageTokenCount(null)).toBe(0);
  });

  it('builds on the last reply’s usage, estimating what came after', () => {
    const chat = history([{ content: 'x'.repeat(400) }, { content: 'ok', usage: { prompt_tokens: 1000, completion_tokens: 50 } }, { content: 'y'.repeat(40) }]);
    // 1050 reported, then 4 + 40/4 for the last message.
    expect(contextUsage(chat, '')).toEqual({ tokens: 1064, threshold: null, estimated: true });
  });

  it('estimates the whole branch without usage, from a compaction summary on', () => {
    const chat = history([{ content: 'a'.repeat(4000) }, { content: 'b'.repeat(40), contextSummary: 's'.repeat(80) }, { content: 'c'.repeat(8) }]);
    // system 10, summary 20, then (4 + 10) and (4 + 2).
    expect(contextUsage(chat, 'p'.repeat(40))).toEqual({ tokens: 50, threshold: null, estimated: true });
  });

  it('takes the server’s figure when it sent one', () => {
    expect(contextUsage(undefined, '', { tokens: 41000, threshold: 120000, percent: 34 })).toEqual({ tokens: 41000, threshold: 120000, estimated: false });
    expect(contextUsage({ messages: {}, currentId: null }, '')).toBeNull();
  });

  it('writes the figures as people read them', () => {
    expect(formatTokenCount(840)).toBe('840');
    expect(formatTokenCount(1234)).toBe('1.2k');
    expect(formatTokenCount(41000)).toBe('41k');
    expect(formatTokenCount(1_500_000)).toBe('1.5m');
    expect(contextUsageLabel({ tokens: 1234, threshold: null, estimated: true })).toBe('≈ 1.2k tokens');
    expect(contextUsageLabel({ tokens: 41000, threshold: 120000, estimated: false })).toBe('34% · 41k of 120k tokens');
    expect(contextUsageLabel(null)).toBe('unknown');
  });
});
