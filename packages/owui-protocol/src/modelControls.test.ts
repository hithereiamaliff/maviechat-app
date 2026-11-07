import { describe, expect, it } from 'vitest';
import { controlChoice, modelControls, withControlChoice } from './modelControls';
import type { ModelItem } from './models';

const model = (params: unknown, extra: Record<string, unknown> = {}): ModelItem => ({ id: 'm.1', name: 'M', info: { params } as ModelItem['info'], ...extra }) as ModelItem;
const effort = { label: 'Reasoning', description: 'How hard it thinks', default: 'medium', options: { low: { label: 'Low', params: {} }, medium: { label: 'Medium' }, high: {} } };

describe('model knobs (0.12)', () => {
  it('lists a model’s knobs with their options and default', () => {
    expect(modelControls(model({ model_controls: { effort, broken: { options: {} }, junk: 3 } }))).toEqual([
      { key: 'effort', label: 'Reasoning', description: 'How hard it thinks', defaultValue: 'medium', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'high' }] },
    ]);
  });

  it('has none for 0.11 models, direct connections and pipes', () => {
    expect(modelControls(model(undefined))).toEqual([]);
    expect(modelControls(model({ model_controls: { effort } }, { direct: true }))).toEqual([]);
    expect(modelControls(model({ model_controls: { effort } }, { pipe: { type: 'pipe' } }))).toEqual([]);
    expect(modelControls(undefined)).toEqual([]);
  });

  it('reads and changes your choices, keeping other models’ and dropping a choice put back to default', () => {
    const ui = { params: { temperature: 0.2, model_controls: { 'm.1': { effort: 'high' }, other: { size: 'big' } } } };
    expect(controlChoice(ui, 'm.1', 'effort')).toBe('high');
    expect(controlChoice({}, 'm.1', 'effort')).toBeNull();
    expect(withControlChoice(ui, 'm.1', 'effort', 'low')).toEqual({ 'm.1': { effort: 'low' }, other: { size: 'big' } });
    expect(withControlChoice(ui, 'm.1', 'effort', null)).toEqual({ 'm.1': {}, other: { size: 'big' } });
  });
});
