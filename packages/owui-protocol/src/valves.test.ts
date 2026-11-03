import { describe, expect, it } from 'vitest';
import { customStart, valveFields, valvesFromForm, valvesToForm, type ValvesSpec } from './valves';

const spec: ValvesSpec = {
  required: ['api_key'],
  properties: {
    api_key: { title: 'API Key', type: 'string', input: { type: 'password' }, default: '' },
    level: { title: 'Level', type: 'string', enum: ['low', 'high'], default: 'low' },
    verbose: { title: 'Verbose', type: 'boolean', default: false },
    limit: { title: 'Limit', type: 'integer', default: 5 },
    ratio: { title: 'Ratio', anyOf: [{ type: 'number' }, { type: 'null' }], default: null },
    tags: { title: 'Tags', type: 'array', default: ['a', 'b'] },
    models: { title: 'Models', type: 'array', input: { type: 'multiselect', options: [{ value: 'm1', label: 'Model 1' }, 'm2'] }, default: [] },
    model: { title: 'Model', type: 'string', input: { type: 'select', options: 'get_models' } },
    note: { title: 'Note', type: 'string', description: 'Any text' },
  },
};

describe('user valves', () => {
  it('describes each valve with the input it needs', () => {
    const fields = valveFields(spec);
    expect(fields.map((field) => [field.key, field.kind])).toEqual([
      ['api_key', 'password'],
      ['level', 'select'],
      ['verbose', 'boolean'],
      ['limit', 'integer'],
      ['ratio', 'number'],
      ['tags', 'list'],
      ['models', 'multiselect'],
      // Options the server didn't resolve into a list: typed instead.
      ['model', 'text'],
      ['note', 'text'],
    ]);
    expect(fields[0]!.required).toBe(true);
    expect(fields[6]!.options).toEqual([
      { value: 'm1', label: 'Model 1' },
      { value: 'm2', label: 'm2' },
    ]);
    expect(valveFields(null)).toEqual([]);
  });

  it('starts a valve switched to Custom at its default', () => {
    const fields = valveFields(spec);
    const start = (key: string) => customStart(fields.find((field) => field.key === key)!);
    expect([start('tags'), start('limit'), start('verbose'), start('ratio'), start('models')]).toEqual(['a, b', '5', false, '', []]);
  });

  it('turns lists and numbers into form text and back, reporting numbers that are not', () => {
    const fields = valveFields(spec);
    const form = valvesToForm(fields, { tags: ['x', 'y'], limit: 3, verbose: true, api_key: null });
    expect(form).toMatchObject({ tags: 'x, y', limit: '3', verbose: true, api_key: null, note: null });
    expect(valvesFromForm(fields, { ...form, tags: 'x, , z', limit: '4' }).values).toMatchObject({ tags: ['x', 'z'], limit: 4, verbose: true, api_key: null });
    expect(valvesFromForm(fields, { ...form, limit: '2.5' }).invalid).toEqual(['Limit']);
  });
});
