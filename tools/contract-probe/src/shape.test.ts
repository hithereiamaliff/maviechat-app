import { describe, expect, it } from 'vitest';
import { isIdLike, mergeShapes, shapeDiff, shapeOf } from './shape';

describe('shapeOf', () => {
  it('replaces content with type names', () => {
    expect(shapeOf({ token: 'secret', email: 'a@b.c', n: 1, ok: true, nothing: null })).toEqual({
      email: 'string',
      n: 'number',
      nothing: 'null',
      ok: 'boolean',
      token: 'string',
    });
  });

  it('merges array items into one shape', () => {
    expect(shapeOf([{ id: 'a' }, { id: 'b', extra: 2 }, { id: 3 }])).toEqual([{ extra: 'number', id: 'number|string' }]);
    expect(shapeOf([])).toEqual([]);
  });

  it('collapses maps keyed by ids so no ids land in fixtures', () => {
    const messages = {
      '1b4e28ba-2fa1-11d2-883f-0016d3cca427': { role: 'user', content: 'hello' },
      'aa4e28ba-2fa1-11d2-883f-0016d3cca427': { role: 'assistant', content: 'hi', output: [] },
    };
    expect(shapeOf({ messages })).toEqual({
      messages: { '<id>': { content: 'string', output: [], role: 'string' } },
    });
  });

  it('stops at the depth limit', () => {
    expect(shapeOf({ a: { b: { c: 1 } } }, 2)).toEqual({ a: { b: 'object' } });
  });
});

describe('isIdLike', () => {
  it('matches uuids and long hex ids only', () => {
    expect(isIdLike('1b4e28ba-2fa1-11d2-883f-0016d3cca427')).toBe(true);
    expect(isIdLike('0123456789abcdef01234567')).toBe(true);
    expect(isIdLike('history')).toBe(false);
  });
});

describe('mergeShapes', () => {
  it('unions object keys and scalar types', () => {
    expect(mergeShapes({ a: 'string' }, { b: 'number' })).toEqual({ a: 'string', b: 'number' });
    expect(mergeShapes('string', 'null')).toBe('null|string');
    expect(mergeShapes('null|string', 'number')).toBe('null|number|string');
  });
});

describe('shapeDiff', () => {
  it('lists added, removed and retyped fields, ignoring empty lists', () => {
    const before = shapeOf({ id: 'x', role: 'user', tags: [], files: [{ name: 'a' }], expires: 1 });
    const after = shapeOf({ id: 'x', role: 'user', tags: [{ name: 't' }], files: [{ name: 'a', size: 2 }], expires: null, mfa: true });
    expect(shapeDiff(before, after)).toEqual(['~ expires: number → null', '+ files[].size: "number"', '+ mfa: "boolean"']);
    expect(shapeDiff(after, after)).toEqual([]);
  });
});
