import { describe, expect, it } from 'vitest';
import { parsePatch, splitPath } from './patch';

const patch = [
  'Index: src/app.ts',
  '===================================================================',
  '--- src/app.ts',
  '+++ src/app.ts',
  '@@ -1,3 +1,4 @@',
  ' import a',
  '-const b = 1',
  '+const b = 2',
  '+const c = 3',
  ' export {}',
  '@@ -10,2 +11,1 @@ function tail',
  '-old()',
  ' end',
  '\\ No newline at end of file',
  '',
].join('\n');

describe('patch view', () => {
  it('turns a unified diff into hunks and numbered lines, without file headers', () => {
    expect(parsePatch(patch)).toEqual([
      { kind: 'hunk', text: '@@ -1,3 +1,4 @@', number: null },
      { kind: 'ctx', text: 'import a', number: 1 },
      { kind: 'del', text: 'const b = 1', number: 2 },
      { kind: 'add', text: 'const b = 2', number: 2 },
      { kind: 'add', text: 'const c = 3', number: 3 },
      { kind: 'ctx', text: 'export {}', number: 4 },
      { kind: 'hunk', text: '@@ -10,2 +11,1 @@ function tail', number: null },
      { kind: 'del', text: 'old()', number: 10 },
      { kind: 'ctx', text: 'end', number: 11 },
      { kind: 'note', text: 'No newline at end of file', number: null },
    ]);
  });

  it('keeps empty lines and handles Windows line endings', () => {
    expect(parsePatch('@@ -1,2 +1,2 @@\r\n \r\n-x\r\n+y\r\n')).toEqual([
      { kind: 'hunk', text: '@@ -1,2 +1,2 @@', number: null },
      { kind: 'ctx', text: '', number: 1 },
      { kind: 'del', text: 'x', number: 2 },
      { kind: 'add', text: 'y', number: 2 },
    ]);
    expect(parsePatch('')).toEqual([]);
  });

  it('splits a path into name and folder', () => {
    expect(splitPath('src/features/app.ts')).toEqual({ name: 'app.ts', folder: 'src/features' });
    expect(splitPath('README.md')).toEqual({ name: 'README.md', folder: '' });
  });
});
