import type { ModelItem, PromptSuggestion } from '@maviechat/owui-protocol';
import { describe, expect, it } from 'vitest';
import { filterSuggestions, searchModels, shuffled } from './search';

const suggestions: PromptSuggestion[] = [
  { title: ['Plan a weekend', 'in Penang on a budget'], content: 'Plan a two-day weekend in Penang for under RM300' },
  { title: ['Explain a concept', 'like I am twelve'], content: 'Explain how vaccines train the immune system' },
  { title: ['Draft an email', 'asking for a deadline extension'], content: 'Write a polite email asking my manager for two more days' },
  { content: 'Summarise the main causes of the 1997 Asian financial crisis' },
];

describe('shuffled', () => {
  it('keeps every item and the same order for the same seed', () => {
    const first = shuffled(suggestions, 42, (item) => item.content);
    expect(first).toHaveLength(suggestions.length);
    expect(new Set(first)).toEqual(new Set(suggestions));
    expect(shuffled(suggestions, 42, (item) => item.content)).toEqual(first);
  });

  it('changes the order with the seed', () => {
    const orders = new Set([1, 2, 3, 4, 5, 6].map((seed) => shuffled(suggestions, seed, (item) => item.content).map((item) => item.content).join('|')));
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('filterSuggestions', () => {
  it('shows everything for empty input and nothing for very long input', () => {
    expect(filterSuggestions(suggestions, '  ')).toHaveLength(4);
    expect(filterSuggestions(suggestions, 'x'.repeat(501))).toEqual([]);
  });

  it('matches titles and text loosely, best first', () => {
    expect(filterSuggestions(suggestions, 'penang')[0]?.content).toContain('Penang');
    expect(filterSuggestions(suggestions, 'deadline')[0]?.content).toContain('email');
    expect(filterSuggestions(suggestions, 'financial crisis')[0]?.content).toContain('1997');
    expect(filterSuggestions(suggestions, 'qqqqzzzz')).toEqual([]);
  });
});

describe('searchModels', () => {
  const models: ModelItem[] = [
    { id: 'gpt-4o', name: 'GPT-4o', tags: [{ name: 'vision' }] },
    { id: 'claude-sonnet', name: 'Claude Sonnet', tags: [{ name: 'writing' }] },
    { id: 'llama3:8b', name: 'Llama 3' },
  ];

  it('finds models by name, id or tag', () => {
    expect(searchModels(models, '')).toEqual(models);
    expect(searchModels(models, 'sonet')[0]?.id).toBe('claude-sonnet');
    expect(searchModels(models, 'llama3')[0]?.id).toBe('llama3:8b');
    expect(searchModels(models, 'vision').map((model) => model.id)).toEqual(['gpt-4o']);
  });
});
