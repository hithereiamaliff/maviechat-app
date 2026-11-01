import { describe, expect, it } from 'vitest';
import type { HistoryMessage } from './history';
import type { OutputItem } from './output';
import { applyMessageEvent, applyResponseStreamEvent, outputText, type ResponseStreamEvent } from './stream';

const run = (events: ResponseStreamEvent[], start: OutputItem[] = []) => events.reduce(applyResponseStreamEvent, start);

describe('applyResponseStreamEvent', () => {
  it('builds reasoning, a tool call and the answer from a realistic stream', () => {
    const output = run([
      { type: 'response.output_item.added', output_index: 0, item: { id: 'r1', type: 'reasoning', status: 'in_progress', content: [] } },
      { type: 'response.reasoning_text.delta', item_id: 'r1', content_index: 0, delta: 'Let me ' },
      { type: 'response.reasoning_text.delta', item_id: 'r1', content_index: 0, delta: 'think.' },
      { type: 'response.output_item.done', output_index: 0, item: { id: 'r1', type: 'reasoning', status: 'completed', content: [{ type: 'reasoning_text', text: 'Let me think.' }] } },
      { type: 'response.output_item.added', output_index: 1, item: { id: 'f1', call_id: 'c1', type: 'function_call', name: 'search', arguments: '' } },
      { type: 'response.function_call_arguments.delta', item_id: 'f1', delta: '{"q":' },
      { type: 'response.function_call_arguments.delta', item_id: 'f1', delta: '"x"}' },
      { type: 'response.output_item.added', output_index: 2, item: { id: 'm1', type: 'message', role: 'assistant', content: [] } },
      { type: 'response.content_part.added', item_id: 'm1', content_index: 0, part: { type: 'output_text', text: '' } },
      { type: 'response.output_text.delta', item_id: 'm1', content_index: 0, delta: 'Hello' },
      { type: 'response.output_text.delta', item_id: 'm1', content_index: 0, delta: ' world' },
    ]);
    expect(output.map((item) => item.type)).toEqual(['reasoning', 'function_call', 'message']);
    expect(output[0]?.content?.[0]?.text).toBe('Let me think.');
    expect(output[1]?.arguments).toBe('{"q":"x"}');
    expect(outputText(output)).toBe('Hello world');
  });

  it('finds items by call_id and creates missing ones', () => {
    const output = run([{ type: 'response.output_text.delta', item_id: 'new', output_index: 1, delta: 'hi' }]);
    expect(output).toHaveLength(2);
    expect(output[1]).toMatchObject({ id: 'new', type: 'message' });
    expect(outputText(output)).toBe('hi');

    const withCall = run([{ type: 'response.function_call_arguments.done', item_id: 'c9', arguments: '{}' }], [
      { id: 'f9', call_id: 'c9', type: 'function_call', arguments: '{' },
    ]);
    expect(withCall[0]?.arguments).toBe('{}');
  });

  it('inserts on added but replaces on done when the position is taken', () => {
    const start: OutputItem[] = [{ id: 'a', type: 'message', content: [] }];
    expect(run([{ type: 'response.output_item.added', output_index: 0, item: { id: 'b', type: 'reasoning' } }], start).map((i) => i.id)).toEqual(['b', 'a']);
    expect(run([{ type: 'response.output_item.done', output_index: 0, item: { id: 'b', type: 'reasoning' } }], start).map((i) => i.id)).toEqual(['b']);
  });

  it('handles reasoning summaries and final text', () => {
    const output = run([
      { type: 'response.reasoning_summary_part.added', item_id: 'r', output_index: 0, summary_index: 0, part: { type: 'summary_text', text: '' } },
      { type: 'response.reasoning_summary_text.delta', item_id: 'r', summary_index: 0, delta: 'Plan' },
      { type: 'response.output_text.done', output_index: 1, content_index: 0, text: 'Final' },
    ]);
    expect(output[0]).toMatchObject({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Plan' }] });
    expect(outputText(output)).toBe('Final');
  });

  it('replaces everything on response.completed and ignores other events', () => {
    const final: OutputItem[] = [{ id: 'm', type: 'message', content: [{ type: 'output_text', text: 'Done' }] }];
    expect(run([{ type: 'response.completed', response: { output: final } }])).toBe(final);
    const start: OutputItem[] = [{ id: 'x' }];
    expect(applyResponseStreamEvent(start, { type: 'status' })).toBe(start);
    expect(applyResponseStreamEvent(start, { type: 'response.in_progress' })).toBe(start);
  });

  it('never mutates its input', () => {
    const start: OutputItem[] = [{ id: 'm', type: 'message', content: [{ type: 'output_text', text: 'a' }] }];
    const snapshot = JSON.stringify(start);
    run([{ type: 'response.output_text.delta', item_id: 'm', content_index: 0, delta: 'b' }], start);
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});

describe('applyMessageEvent', () => {
  const base: HistoryMessage = { id: 'a', parentId: 'u', childrenIds: [], role: 'assistant', content: '', done: false };

  it('streams text from response:completion deltas, skipping a leading newline', () => {
    let message = applyMessageEvent(base, 'response:completion', { type: 'response.output_text.delta', output_index: 0, delta: '\n' });
    expect(message.content).toBe('');
    message = applyMessageEvent(message, 'response:completion', { type: 'response.output_text.delta', output_index: 0, delta: 'Hi' });
    expect(message.content).toBe('Hi');
    expect(outputText(message.output)).toBe('\nHi');
  });

  it('applies chat:completion output, usage, sources and done', () => {
    const output: OutputItem[] = [{ id: 'm', type: 'message', content: [{ type: 'output_text', text: 'Answer' }] }];
    const message = applyMessageEvent(base, 'chat:completion', { output, usage: { total_tokens: 9 }, sources: [{ source: { name: 's' } }], done: true });
    expect(message).toMatchObject({ content: 'Answer', usage: { total_tokens: 9 }, done: true });
    expect(message.sources).toHaveLength(1);
  });

  it('turns errors into { content }', () => {
    expect(applyMessageEvent(base, 'chat:completion', { error: { detail: 'Rate limited' }, done: true }).error).toEqual({ content: 'Rate limited' });
    expect(applyMessageEvent(base, 'chat:completion', { error: 'Boom' }).error).toEqual({ content: 'Boom' });
  });

  it('handles legacy streaming fields', () => {
    let message = applyMessageEvent(base, 'chat:completion', { choices: [{ delta: { content: 'a' } }] });
    message = applyMessageEvent(message, 'message', { content: 'b' });
    expect(message.content).toBe('ab');
    expect(applyMessageEvent(message, 'replace', { content: 'c' }).content).toBe('c');
  });

  it('records status, sources, code runs, follow-ups and cancel', () => {
    let message = applyMessageEvent(base, 'status', { description: 'Searching', done: false });
    message = applyMessageEvent(message, 'source', { source: { name: 'x' } });
    message = applyMessageEvent(message, 'citation', { type: 'code_execution', id: 'e1', code: '1' });
    message = applyMessageEvent(message, 'citation', { type: 'code_execution', id: 'e1', code: '2' });
    message = applyMessageEvent(message, 'chat:message:follow_ups', { follow_ups: ['More?'] });
    message = applyMessageEvent(message, 'chat:tasks:cancel', {});
    expect(message.statusHistory).toHaveLength(1);
    expect(message.sources).toHaveLength(1);
    expect(message.code_executions).toEqual([{ type: 'code_execution', id: 'e1', code: '2' }]);
    expect(message.followUps).toEqual(['More?']);
    expect(message.done).toBe(true);
  });

  it('leaves the message alone for unknown events', () => {
    expect(applyMessageEvent(base, 'chat:title', 'x')).toBe(base);
  });
});
