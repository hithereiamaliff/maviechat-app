import { describe, expect, it } from 'vitest';
import { contentToBlocks, embedAddress, embedList, groupSteps, messageBlocks, outputToBlocks, plainText, type OutputItem } from './output';

const output: OutputItem[] = [
  { type: 'reasoning', id: 'r1', status: 'completed', duration: 4.2, content: [{ type: 'reasoning_text', text: 'Thinking it over.' }] },
  { type: 'function_call', id: 'f1', call_id: 'c1', name: 'web_search', arguments: '{"query":"weather"}', status: 'completed' },
  { type: 'function_call_output', id: 'o1', call_id: 'c1', output: [{ type: 'input_text', text: 'Sunny' }] },
  { type: 'message', id: 'm1', role: 'assistant', content: [{ type: 'output_text', text: 'It is sunny.' }] },
  { type: 'future_thing', id: 'x1' },
];

describe('outputToBlocks', () => {
  it('turns output items into text and steps, pairing tool results by call_id', () => {
    expect(outputToBlocks(output)).toEqual([
      { kind: 'reasoning', id: 'r1', text: 'Thinking it over.', durationSec: 4, done: true },
      {
        kind: 'tool',
        id: 'f1',
        name: 'web_search',
        argumentsText: '{\n  "query": "weather"\n}',
        resultText: 'Sunny',
        done: true,
      },
      { kind: 'text', id: 'm1', text: 'It is sunny.' },
      { kind: 'other', id: 'x1', label: 'future_thing', done: true },
    ]);
  });

  it('marks unfinished steps while a reply streams', () => {
    const blocks = outputToBlocks([{ type: 'reasoning', id: 'r', status: 'in_progress', content: [] }], false);
    expect(blocks[0]).toMatchObject({ kind: 'reasoning', done: false });
  });

  it('falls back to content when output is missing or empty', () => {
    expect(messageBlocks({ id: 'm', content: 'Hello', output: [] })).toEqual([{ kind: 'text', id: 'm-0', text: 'Hello' }]);
  });
});

describe('contentToBlocks (older chats)', () => {
  it('splits <details> steps out of the text', () => {
    const content = [
      '<details type="reasoning" done="true" duration="3">',
      '<summary>Thought for 3 seconds</summary>',
      '> line one',
      '> line two',
      '</details>',
      'The answer.',
      '<details type="tool_calls" done="true" id="t1" name="calc" arguments="{&quot;x&quot;:1}" result="&quot;2&quot;">',
      '<summary>Tool Executed</summary>',
      '</details>',
    ].join('\n');

    expect(contentToBlocks(content, 'm')).toEqual([
      { kind: 'reasoning', id: 'm-0', text: 'line one\nline two', durationSec: 3, done: true },
      { kind: 'text', id: 'm-1', text: 'The answer.' },
      { kind: 'tool', id: 't1', name: 'calc', argumentsText: '{\n  "x": 1\n}', resultText: '"2"', done: true },
    ]);
  });

  it('keeps unknown details blocks as text', () => {
    expect(contentToBlocks('<details><summary>More</summary>Hidden</details>', 'm')).toEqual([
      { kind: 'text', id: 'm-0', text: '<details><summary>More</summary>Hidden</details>' },
    ]);
  });
});

describe('groupSteps', () => {
  it('groups runs of two or more steps and leaves single steps alone', () => {
    const items = groupSteps(outputToBlocks(output));
    expect(items.map((item) => item.kind)).toEqual(['group', 'text', 'other']);
    const group = items[0];
    expect(group?.kind === 'group' ? group.steps.map((s) => s.id) : []).toEqual(['r1', 'f1']);
  });

  it('plainText keeps only the visible text', () => {
    expect(plainText(outputToBlocks(output))).toBe('It is sunny.');
  });
});

describe('tool embeds', () => {
  it("shows the web content a tool returned with its call", () => {
    const blocks = outputToBlocks([
      { type: 'function_call', id: 'f1', call_id: 'c1', name: 'chart', arguments: '{"n":3}', status: 'completed' },
      { type: 'function_call_output', id: 'o1', call_id: 'c1', output: [{ type: 'input_text', text: 'Embedded UI result is active' }], embeds: ['<p>chart</p>', 7, ''] },
      { type: 'function_call', id: 'f2', call_id: 'c2', name: 'plain', arguments: '{}', status: 'completed' },
      { type: 'function_call_output', id: 'o2', call_id: 'c2', output: [] },
    ]);
    expect(blocks[0]).toMatchObject({ kind: 'tool', name: 'chart', embeds: ['<p>chart</p>'] });
    expect(blocks[1]).not.toHaveProperty('embeds');
  });

  it("reads older chats' embeds from the details block", () => {
    const content = '<details type="tool_calls" done="true" id="c1" name="map" arguments="{}" result="&quot;ok&quot;" embeds="[&quot;https://maps.example.com/embed?q=1&quot;]">\n<summary>Tool Executed</summary>\n</details>';
    expect(contentToBlocks(content)[0]).toMatchObject({ kind: 'tool', name: 'map', embeds: ['https://maps.example.com/embed?q=1'] });
  });

  it('takes lists or their JSON, and knows addresses from HTML', () => {
    expect(embedList(['<b>x</b>', null])).toEqual(['<b>x</b>']);
    expect(embedList('["a"]')).toEqual(['a']);
    expect(embedList('not json')).toEqual([]);
    expect(embedList(undefined)).toEqual([]);
    expect(embedAddress(' https://example.com/x ')).toBe('https://example.com/x');
    expect(embedAddress('//cdn.example.com/w')).toBe('https://cdn.example.com/w');
    expect(embedAddress('<html><body>hi</body></html>')).toBeNull();
    expect(embedAddress('/api/v1/files/1/content')).toBeNull();
  });
});
