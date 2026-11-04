import { describe, expect, it } from 'vitest';
import { modelSections, naturalCompare, searchModelChoices, type ModelChoice } from './models';

const model = (providerID: string, provider: string, modelID: string, name: string): ModelChoice => ({ providerID, provider, modelID, name });

const models = [
  model('opencode-go', 'OpenCode Go', 'glm-5.2', 'GLM-5.2'),
  model('deepseek', 'DeepSeek', 'deepseek-v4-pro', 'DeepSeek V4 Pro'),
  model('opencode-go', 'OpenCode Go', 'deepseek-v4.1-flash', 'DeepSeek V4.1 Flash'),
  model('openai', 'OpenAI', 'gpt-5.5', 'GPT-5.5'),
  model('opencode-go', 'OpenCode Go', 'deepseek-v4-flash', 'DeepSeek V4 Flash'),
  model('deepseek', 'DeepSeek', 'deepseek-v4.1-flash', 'DeepSeek V4.1 Flash'),
  model('openai', 'OpenAI', 'gpt-10', 'GPT-10'),
];

const listed = (query: string) => modelSections(models, query).map((section) => `${section.title}: ${section.data.map((item) => item.name).join(', ')}`);

describe('OpenCode model picker', () => {
  it('lists every model under its provider, providers and models A to Z', () => {
    expect(listed('')).toEqual(['DeepSeek: DeepSeek V4 Pro, DeepSeek V4.1 Flash', 'OpenAI: GPT-5.5, GPT-10', 'OpenCode Go: DeepSeek V4 Flash, DeepSeek V4.1 Flash, GLM-5.2']);
  });

  it('keeps search results under their provider', () => {
    expect(listed('flash')).toEqual(['DeepSeek: DeepSeek V4.1 Flash', 'OpenCode Go: DeepSeek V4 Flash, DeepSeek V4.1 Flash']);
  });

  it('needs every word typed, in the provider, the name or the id', () => {
    expect(listed('go flash')).toEqual(['OpenCode Go: DeepSeek V4 Flash, DeepSeek V4.1 Flash']);
    expect(listed('V4.1')).toEqual(['DeepSeek: DeepSeek V4.1 Flash', 'OpenCode Go: DeepSeek V4.1 Flash']);
    expect(listed('openai')).toEqual(['OpenAI: GPT-5.5, GPT-10']);
    expect(listed('deepseek-v4-pro')).toEqual(['DeepSeek: DeepSeek V4 Pro']);
  });

  it('still finds a model through a typo, and nothing for nonsense', () => {
    expect(searchModelChoices(models, 'deepsek').map((item) => item.modelID)).toContain('deepseek-v4-pro');
    expect(modelSections(models, 'zzzzqqq')).toEqual([]);
  });

  it('puts numbers in number order', () => {
    expect(['V10', 'V4.1', 'V4', 'v2'].sort(naturalCompare)).toEqual(['v2', 'V4', 'V4.1', 'V10']);
  });
});
