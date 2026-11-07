import { describe, expect, it } from 'vitest';
import { diffLineKind, isDiffBlock } from './diff';

describe('diff blocks', () => {
  it('knows a diff by its label, or by how it reads', () => {
    expect(isDiffBlock('diff', 'anything')).toBe(true);
    expect(isDiffBlock('Patch', 'anything')).toBe(true);
    expect(isDiffBlock('', 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n+b')).toBe(true);
    expect(isDiffBlock(undefined, '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')).toBe(true);
    expect(isDiffBlock('', '- a list\n- of things')).toBe(false);
    expect(isDiffBlock('python', '--- a/x\n+++ b/x\n@@ -1 +1 @@')).toBe(false);
  });

  it('reads each line', () => {
    expect(['--- a/x', '+++ b/x', '@@ -1 +1 @@ fn', '+new', '-old', ' same', 'index 1..2'].map(diffLineKind)).toEqual(['file', 'file', 'hunk', 'added', 'removed', null, 'file']);
  });
});
