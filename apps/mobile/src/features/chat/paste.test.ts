import { describe, expect, it } from 'vitest';
import { pastedText } from './paste';

describe('a long paste into the message box', () => {
  const long = 'x'.repeat(1001);

  it('finds the pasted part wherever the cursor was', () => {
    expect(pastedText('', long)).toBe(long);
    expect(pastedText('Before after', `Before ${long}after`)).toBe(long);
    expect(pastedText('ab', `a${long}b`)).toBe(long);
  });

  it('ignores short pastes, typing and replacements', () => {
    expect(pastedText('', 'x'.repeat(1000))).toBeNull();
    expect(pastedText('hello', 'hello!')).toBeNull();
    expect(pastedText('a'.repeat(50), `b${long}`)).toBeNull();
  });
});
