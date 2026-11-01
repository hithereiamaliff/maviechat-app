import { describe, expect, it } from 'vitest';
import { defaultModelId, modelName, promptSuggestions, type ModelItem } from './models';
import { errorText, latestStatus, normalizeSources } from './sources';

const models: ModelItem[] = [
  { id: 'gpt', name: 'GPT', info: { meta: { suggestion_prompts: [{ title: ['Plan', 'a trip'], content: 'Plan a trip' }] } } },
  { id: 'claude', name: 'Claude' },
];

describe('models', () => {
  it('picks the user default, then the server default, then the first model', () => {
    expect(defaultModelId(models, { ui: { models: ['claude'] } }, { default_models: 'gpt' })).toBe('claude');
    expect(defaultModelId(models, { ui: { models: ['gone'] } }, { default_models: 'x, gpt' })).toBe('gpt');
    expect(defaultModelId(models, {}, {})).toBe('gpt');
    expect(defaultModelId([], {}, {})).toBeNull();
  });

  it("uses the model's suggestions before the server's", () => {
    const config = { default_prompt_suggestions: [{ title: ['Hi'], content: 'Hello' }, { title: ['bad'] }] };
    expect(promptSuggestions(models[0], config).map((s) => s.content)).toEqual(['Plan a trip']);
    expect(promptSuggestions(models[1], config).map((s) => s.content)).toEqual(['Hello']);
  });

  it('names models by id', () => {
    expect(modelName(models, 'claude')).toBe('Claude');
    expect(modelName(models, 'unknown')).toBe('unknown');
    expect(modelName(models, undefined)).toBe('Assistant');
  });
});

describe('sources, status and errors', () => {
  it('numbers unique sources with titles and URLs', () => {
    const sources = [
      { source: { name: 'Weather', url: 'https://w.test/a' }, document: ['x'], metadata: [{ source: 'https://w.test/a' }] },
      { source: { name: 'Weather again', url: 'https://w.test/a' } },
      { source: { id: 'file-1', name: 'report.pdf' }, metadata: [{ name: 'report.pdf' }] },
      'junk',
    ];
    expect(normalizeSources(sources)).toEqual([
      { index: 1, title: 'Weather', url: 'https://w.test/a' },
      { index: 2, title: 'report.pdf' },
    ]);
    expect(normalizeSources(undefined)).toEqual([]);
  });

  it('shows the latest visible status', () => {
    const history = [
      { description: 'Searching the web', done: false },
      { description: 'Searched 5 sites', done: true },
      { description: 'internal', hidden: true },
    ];
    expect(latestStatus(history)).toEqual({ description: 'Searched 5 sites', done: true });
    expect(latestStatus([])).toBeNull();
  });

  it('reads error content', () => {
    expect(errorText({ content: 'Rate limited' })).toBe('Rate limited');
    expect(errorText(true)).toMatch(/Something went wrong/);
    expect(errorText(null)).toBeNull();
  });
});
