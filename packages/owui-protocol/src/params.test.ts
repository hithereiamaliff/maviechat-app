import { describe, expect, it } from 'vitest';
import { choiceIndex, isCustom, paramsFor, PARAM_SPECS, parseParamNumber, requestParams, stepParam, stopTokens, streamResponse, withParam, withSystemPrompt } from './params';

const spec = (key: string) => PARAM_SPECS.find((item) => item.key === key)!;

describe('chat parameters', () => {
  it('shows admins everything and others the rest', () => {
    expect(paramsFor(true)).toHaveLength(PARAM_SPECS.length);
    expect(paramsFor(false).some((item) => item.key === 'num_gpu')).toBe(false);
    expect(paramsFor(false).some((item) => item.key === 'temperature')).toBe(true);
  });

  it('treats null and missing as Default, and drops a value set back to Default', () => {
    expect(isCustom({ temperature: null }, 'temperature')).toBe(false);
    expect(isCustom({ temperature: 0 }, 'temperature')).toBe(true);
    expect(withParam({ temperature: 0.5, seed: 1 }, 'temperature', undefined)).toEqual({ seed: 1 });
    expect(withSystemPrompt({ system: 'Be brief.' }, '   ')).toEqual({});
    expect(withSystemPrompt({}, 'Be brief.')).toEqual({ system: 'Be brief.' });
  });

  it('reads numbers within range and steps cleanly', () => {
    expect(parseParamNumber(spec('temperature'), '3')).toBe(2);
    expect(parseParamNumber(spec('temperature'), 'abc')).toBeNull();
    expect(parseParamNumber(spec('max_tokens'), '12.5')).toBeNull();
    expect(stepParam(spec('temperature'), 0.8, 1)).toBe(0.85);
    expect(stepParam(spec('top_p'), 1, 1)).toBe(1);
    expect(stepParam(spec('num_batch'), 512, -1)).toBe(256);
  });

  it('matches choice values, including a typed level and custom tags', () => {
    expect(choiceIndex(spec('think'), true)).toBe(0);
    expect(choiceIndex(spec('think'), 'high')).toBe(1);
    expect(choiceIndex(spec('think'), false)).toBe(2);
    expect(choiceIndex(spec('reasoning_tags'), ['<t>', '</t>'])).toBe(2);
    expect(choiceIndex(spec('function_calling'), 'legacy')).toBe(1);
  });

  it('sends stop sequences as a list, with escapes read', () => {
    expect(stopTokens('###, \\n\\n,')).toEqual(['###', '\n\n']);
    expect(stopTokens(['END'])).toEqual(['END']);
    expect(stopTokens('')).toBeUndefined();
    expect(stopTokens('%E2%9C%93')).toEqual(['✓']);
  });

  it("merges the user's defaults with the chat's own; the web's nulls mean unset", () => {
    expect(requestParams({ temperature: 0.2, seed: 7, stop: 'a,b' }, { temperature: null, top_p: 0.5, system: 'S' })).toEqual({ seed: 7, stop: ['a', 'b'], top_p: 0.5, system: 'S' });
    expect(requestParams(undefined, undefined)).toEqual({});
  });

  it("streams unless the model, then the user's, then the chat's settings say not to", () => {
    const model = (stream?: boolean) => ({ id: 'm', name: 'm', info: stream === undefined ? {} : { params: { stream_response: stream } } });
    expect(streamResponse(model(), {}, {})).toBe(true);
    expect(streamResponse(model(), {}, { stream_response: false })).toBe(false);
    expect(streamResponse(model(), { stream_response: true }, { stream_response: false })).toBe(true);
    expect(streamResponse(model(false), { stream_response: true }, {})).toBe(false);
  });
});
