import { describe, expect, it } from 'vitest';
import { acceptable } from './spdx.mjs';

describe('acceptable (SPDX licence expressions)', () => {
  it.each([
    ['MIT', true],
    ['Apache-2.0', true],
    ['MIT AND OFL-1.1', true],
    ['GPL-3.0', false],
    ['AGPL-3.0-only', false],
    ['LGPL-2.1', false],
    ['Open WebUI License', false],
  ])('single and combined licences: %s → %s', (expression, expected) => {
    expect(acceptable(expression)).toBe(expected);
  });

  it.each([
    ['BSD-3-Clause OR GPL-2.0', true],
    ['(BSD-3-Clause OR GPL-2.0)', true],
    ['LGPL-3.0 OR MIT', true],
    ['GPL-2.0 OR LGPL-2.1', false],
  ])('OR passes when any option is permissive: %s → %s', (expression, expected) => {
    expect(acceptable(expression)).toBe(expected);
  });

  it.each([
    ['MIT AND GPL-2.0', false],
    ['(MIT OR GPL-3.0) AND LGPL-2.1', false],
    ['(MIT OR GPL-3.0) AND Apache-2.0', true],
    ['MIT OR GPL-3.0 AND LGPL-2.1', true],
    ['GPL-2.0 WITH Classpath-exception-2.0', false],
  ])('AND binds tighter than OR and parentheses group: %s → %s', (expression, expected) => {
    expect(acceptable(expression)).toBe(expected);
  });
});
