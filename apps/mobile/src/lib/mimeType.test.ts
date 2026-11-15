import { describe, expect, it } from 'vitest';
import { mimeTypeOf } from './mimeType';

describe('a shared file’s type, for Android’s share sheet', () => {
  it('comes from the file’s name', () => {
    expect(mimeTypeOf('file:///cache/Chat%20export.json')).toBe('application/json');
    expect(mimeTypeOf('file:///cache/note.PDF')).toBe('application/pdf');
    expect(mimeTypeOf('file:///cache/a.b/notes.md?x=1')).toBe('text/markdown');
    expect(mimeTypeOf('file:///cache/a.b/no-extension')).toBeUndefined();
    expect(mimeTypeOf('file:///cache/odd.xyz')).toBeUndefined();
  });
});
