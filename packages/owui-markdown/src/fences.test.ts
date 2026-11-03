import { describe, expect, it } from 'vitest';
import { isClosedCodeBlock } from './fences';

describe('isClosedCodeBlock', () => {
  it('knows a finished fence', () => {
    expect(isClosedCodeBlock('```mermaid\ngraph TD; A-->B\n```')).toBe(true);
    expect(isClosedCodeBlock('~~~~json\n{}\n~~~~\n')).toBe(true);
    expect(isClosedCodeBlock('````\na\n`````')).toBe(true);
  });

  it('knows one still streaming', () => {
    expect(isClosedCodeBlock('```mermaid\ngraph TD; A-->')).toBe(false);
    expect(isClosedCodeBlock('```mermaid')).toBe(false);
    expect(isClosedCodeBlock('````\na\n```')).toBe(false);
    expect(isClosedCodeBlock('```\na\n~~~')).toBe(false);
  });

  it('treats indented code as finished', () => {
    expect(isClosedCodeBlock('    const a = 1;')).toBe(true);
  });
});
