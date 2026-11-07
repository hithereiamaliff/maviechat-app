import { describe, expect, it } from 'vitest';
import { chatLinkFrom, linkFillsInput } from './chatLink';

describe('links into a new chat', () => {
  it('reads the web’s parameters', () => {
    const link = chatLinkFrom({ q: 'Hello there', models: 'gpt, claude', 'web-search': 'true', 'image-generation': 'false', 'code-interpreter': 'true', tools: 'a,b', 'temporary-chat': 'true' });
    expect(link).toMatchObject({ models: ['gpt', 'claude'], text: 'Hello there', toggles: { webSearch: true, codeInterpreter: true }, toolIds: ['a', 'b'], temporary: true });
    expect(linkFillsInput(link)).toBe(true);
  });

  it('falls back to `model` and `tool-ids`, and takes the first of a repeated parameter', () => {
    const link = chatLinkFrom({ model: ['gpt', 'other'], 'tool-ids': 'x' });
    expect(link).toMatchObject({ models: ['gpt'], text: null, toggles: {}, toolIds: ['x'], temporary: false });
  });

  it('is empty for no parameters, and keys the same link the same way', () => {
    const empty = chatLinkFrom({});
    expect(empty).toMatchObject({ models: [], text: null, toggles: {}, toolIds: [], temporary: false });
    expect(linkFillsInput(empty)).toBe(false);
    expect(chatLinkFrom({ model: 'gpt' }).key).toBe(chatLinkFrom({ models: 'gpt' }).key);
    expect(chatLinkFrom({ q: 'a' }).key).not.toBe(chatLinkFrom({ q: 'b' }).key);
  });

  it('attaches the pages of `youtube` and `load-url`, web addresses only', () => {
    const link = chatLinkFrom({ youtube: 'dQw4w9WgXcQ', 'load-url': 'https://example.com/post?id=7' });
    expect(link.pages).toEqual(['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://example.com/post?id=7']);
    expect(linkFillsInput(chatLinkFrom({ 'load-url': 'https://example.com' }))).toBe(true);
    expect(chatLinkFrom({ youtube: 'https://youtu.be/dQw4w9WgXcQ' }).pages).toEqual(['https://youtu.be/dQw4w9WgXcQ']);
    expect(chatLinkFrom({ youtube: 'https://evil.example/x', 'load-url': 'javascript:alert(1)' }).pages).toEqual([]);
    expect(chatLinkFrom({ 'load-url': 'file:///etc/passwd' }).pages).toEqual([]);
  });
});
