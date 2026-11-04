import { describe, expect, it } from 'vitest';
import {
  builtinToolsMeta,
  builtinToolsOf,
  capabilitiesOf,
  customParamsOf,
  defaultFeaturesOf,
  functionChoices,
  knowledgeMeta,
  knowledgeRefFrom,
  knowledgeRefsOf,
  modelParamsToSave,
  suggestionsMeta,
  suggestionsOf,
} from './workspaceModelEditor';

describe('the rest of a workspace model', () => {
  it('starts capabilities as the web does: all on but usage, then the admin’s defaults, then the model’s', () => {
    const capabilities = capabilitiesOf({ capabilities: { vision: false } }, { capabilities: { usage: true, memory: false } });
    expect(capabilities).toMatchObject({ vision: false, usage: true, memory: false, web_search: true, file_upload: true });
    expect(defaultFeaturesOf({ defaultFeatureIds: ['web_search', 'image_generation', 'bogus'] }, { ...capabilities, image_generation: false })).toEqual(['web_search']);
  });

  it('keeps only the built-in tools switched off', () => {
    const state = builtinToolsOf({ builtinTools: { calendar: false } });
    expect(state.calendar).toBe(false);
    expect(state.time).toBe(true);
    expect(builtinToolsMeta({ ...state, web_search: false })).toEqual({ calendar: false, web_search: false });
  });

  it('keeps knowledge as the web keeps it, with whole documents asked for', () => {
    const refs = knowledgeRefsOf({ knowledge: [{ id: 'kb1', name: 'Biology', type: 'collection', description: 'Cells', extra: 'x', context: 'full' }, { name: 'no id' }] });
    expect(refs).toMatchObject([{ id: 'kb1', name: 'Biology', full: true }]);
    const picked = knowledgeRefFrom({ kind: 'file', id: 'f1', name: 'notes.pdf', description: 'Biology', raw: { id: 'f1', filename: 'notes.pdf', collection_name: 'kb1', meta: { size: 3 } } });
    expect(knowledgeMeta([...refs, picked])).toEqual([
      { id: 'kb1', name: 'Biology', type: 'collection', description: 'Cells', context: 'full' },
      { id: 'f1', name: 'notes.pdf', type: 'file', description: 'Biology', collection_name: 'kb1' },
    ]);
  });

  it('offers active filters and actions, global ones locked on', () => {
    const choices = functionChoices(
      [
        { id: 'f1', name: 'Tidy', type: 'filter', is_active: true, is_global: true, meta: { toggle: true } },
        { id: 'f2', name: 'Off', type: 'filter', is_active: false },
        { id: 'a1', name: 'Share', type: 'action', is_active: true },
      ],
      'filter',
    );
    expect(choices).toEqual([{ id: 'f1', name: 'Tidy', global: true, toggle: true }]);
  });

  it('reads and writes suggested prompts, null meaning the server’s', () => {
    expect(suggestionsOf({})).toBeNull();
    const prompts = suggestionsOf({ suggestion_prompts: [{ title: ['Plan', 'a trip'], content: 'Plan a trip to Penang' }] });
    expect(prompts).toEqual([{ title: 'Plan', subtitle: 'a trip', content: 'Plan a trip to Penang' }]);
    expect(suggestionsMeta([...(prompts ?? []), { title: 'Empty', subtitle: '', content: ' ' }])).toEqual([{ content: 'Plan a trip to Penang', title: ['Plan', 'a trip'] }]);
    expect(suggestionsMeta(null)).toBeNull();
  });

  it('saves parameters with stop sequences as a list and custom ones by name', () => {
    expect(customParamsOf({ custom_params: { top_k_x: '5', obj: { a: 1 } } })).toEqual([
      { name: 'top_k_x', value: '5' },
      { name: 'obj', value: '{"a":1}' },
    ]);
    expect(modelParamsToSave({ temperature: 0.2, stop: '</s>, END', seed: null, system: 'x' }, [{ name: ' mirostat_x ', value: '1' }, { name: '', value: 'ignored' }])).toEqual({ temperature: 0.2, stop: ['</s>', 'END'], system: 'x', custom_params: { mirostat_x: '1' } });
  });
});
