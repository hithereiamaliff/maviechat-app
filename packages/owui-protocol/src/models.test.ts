import { describe, expect, it } from 'vitest';
import {
  withPinnedModelsOrder,
  defaultModelId,
  matchesModelFilter,
  modelAuthor,
  modelFilterOptions,
  modelImagePath,
  modelLink,
  modelName,
  modelSizeLabel,
  modelTags,
  pickerModels,
  pinnedModelIds,
  promptSuggestions,
  togglePinnedModel,
  visiblePinnedModels,
  type ModelItem,
} from './models';
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

  it('shows no suggestions for a model whose own list is empty', () => {
    const config = { default_prompt_suggestions: [{ content: 'Hello' }] };
    const quiet: ModelItem = { id: 'quiet', name: 'Quiet', info: { meta: { suggestion_prompts: [] } } };
    const unset: ModelItem = { id: 'unset', name: 'Unset', info: { meta: { suggestion_prompts: null } } };
    expect(promptSuggestions(quiet, config)).toEqual([]);
    expect(promptSuggestions(unset, config).map((s) => s.content)).toEqual(['Hello']);
  });

  it('names models by id', () => {
    expect(modelName(models, 'claude')).toBe('Claude');
    expect(modelName(models, 'unknown')).toBe('unknown');
    expect(modelName(models, undefined)).toBe('Assistant');
  });
});

describe('models kept in the sidebar', () => {
  it('follows the admin’s default list until you pin your own, and shows only models you can see', () => {
    expect(pinnedModelIds({ ui: {} }, { default_pinned_models: 'gpt,,claude' })).toEqual(['gpt', 'claude']);
    expect(pinnedModelIds({ ui: { pinnedModels: [] } }, { default_pinned_models: 'gpt' })).toEqual([]);
    expect(pinnedModelIds({ ui: { pinnedModels: ['claude', 3, ''] } }, undefined)).toEqual(['claude']);
    expect(pinnedModelIds(undefined, undefined)).toEqual([]);
    const hidden: ModelItem = { id: 'hidden', name: 'Hidden', info: { meta: { hidden: true } } };
    expect(visiblePinnedModels(['claude', 'gone', 'hidden', 'gpt'], [...models, hidden]).map((model) => model.id)).toEqual(['claude', 'gpt']);
  });

  it('pins at the end and unpins, and links a model as the web copies it', () => {
    expect(togglePinnedModel(['gpt'], 'claude')).toEqual(['gpt', 'claude']);
    expect(togglePinnedModel(['gpt', 'claude'], 'gpt')).toEqual(['claude']);
    expect(modelLink('https://chat.test/', 'org/model:7b')).toBe('https://chat.test/?model=org%2Fmodel%3A7b');
  });
});

describe('model picker', () => {
  const list: ModelItem[] = [
    { id: 'llama3:8b', name: 'Llama 3', owned_by: 'ollama', connection_type: 'local', ollama: { details: { parameter_size: '8.0B' } }, tags: [{ name: 'Fast' }] },
    { id: 'gpt-4o', name: 'GPT-4o', owned_by: 'openai', connection_type: 'external', tags: [{ name: 'vision' }, 'Fast'] },
    { id: 'secret', name: 'Secret', connection_type: 'external', info: { meta: { hidden: true } }, tags: [{ name: 'internal' }] },
    { id: 'qwen', name: 'Qwen', provider: 'lmstudio', quantization: { name: 'Q4_K_M' }, size_bytes: 4.5 * 1024 ** 3 },
  ];

  it('leaves hidden models out', () => {
    expect(pickerModels(list).map((model) => model.id)).toEqual(['llama3:8b', 'gpt-4o', 'qwen']);
  });

  it('reads tags given as objects or strings', () => {
    expect(modelTags(list[1] as ModelItem)).toEqual(['vision', 'Fast']);
    expect(modelTags({ id: 'x', name: 'X', tags: [null, { name: ' ' }, 3] })).toEqual([]);
  });

  it('offers Local, External and each tag once, in lower case', () => {
    const options = modelFilterOptions(pickerModels(list));
    expect(options.map((option) => option.value)).toEqual(['connection:local', 'connection:external', 'tag:fast', 'tag:vision']);
    expect(options[0]?.label).toBe('Local');
  });

  it('filters by connection type or tag', () => {
    const ids = (filter: string) => list.filter((model) => matchesModelFilter(model, filter)).map((model) => model.id);
    expect(ids('')).toHaveLength(4);
    expect(ids('connection:local')).toEqual(['llama3:8b']);
    expect(ids('tag:fast')).toEqual(['llama3:8b', 'gpt-4o']);
  });

  it('labels local model sizes', () => {
    expect(modelSizeLabel(list[0] as ModelItem)).toBe('8.0B');
    expect(modelSizeLabel(list[1] as ModelItem)).toBeNull();
    expect(modelSizeLabel(list[3] as ModelItem)).toBe('Q4_K_M');
    expect(modelSizeLabel({ id: 'z', name: 'Z', provider: 'llama.cpp', size: 2 * 1024 ** 3 })).toBe('(2.0GB)');
  });

  it('builds the picture path and the author line', () => {
    expect(modelImagePath('a/b c')).toBe('/api/v1/models/model/profile/image?id=a%2Fb%20c');
    const meta = (user: unknown): ModelItem => ({ id: 'm', name: 'M', info: { meta: { user } } });
    expect(modelAuthor(meta({ name: 'Ada' }))).toEqual({ label: 'Ada' });
    expect(modelAuthor(meta({ username: 'ada', community: true }))).toEqual({ label: '@ada', url: 'https://openwebui.com/m/ada' });
    expect(modelAuthor(meta({ username: 'ada' }))).toBeNull();
    expect(modelAuthor(undefined)).toBeNull();
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

describe('pinned models order', () => {
  it('puts the ones you see in their new order, keeping pins of models you can’t see after them', () => {
    expect(withPinnedModelsOrder(['a', 'gone', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b', 'gone']);
    expect(withPinnedModelsOrder([], ['x'])).toEqual(['x']);
  });
});
