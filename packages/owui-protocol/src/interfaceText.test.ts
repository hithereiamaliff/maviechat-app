import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { dictionaryOf, interfaceTextOf, interfaceTextProblem, languageName, placeholdersIn, saveInterfaceText, WEB_LANGUAGES } from './interfaceText';

describe('interface text', () => {
  it('reads the dictionary as rows, one per text across languages; none on a server without it', () => {
    expect(interfaceTextOf({ I18N: { 'de-DE': { 'New Chat': 'Neuer Chat', Hi: 'Hallo' }, 'fr-FR': { 'New Chat': 'Nouveau chat' } } })).toEqual([
      { original: 'New Chat', replacements: { 'de-DE': 'Neuer Chat', 'fr-FR': 'Nouveau chat' } },
      { original: 'Hi', replacements: { 'de-DE': 'Hallo' } },
    ]);
    expect(interfaceTextOf({ I18N: {} })).toEqual([]);
    expect(interfaceTextOf({ ENABLE_SIGNUP: true })).toBeNull();
  });

  it('finds placeholders as the server does', () => {
    expect(placeholdersIn('Hello {{ name }}, {{count, number}} new; {{- html}} {{name}}')).toEqual(['count', 'html', 'name']);
    expect(placeholdersIn('No placeholders')).toEqual([]);
  });

  it('says what’s wrong before a save', () => {
    expect(interfaceTextProblem([{ original: 'Hi {{name}}', replacements: { 'de-DE': 'Hallo {{name}}', 'fr-FR': '' } }])).toBeNull();
    expect(interfaceTextProblem([{ original: '', replacements: {} }])).toBeNull();
    expect(interfaceTextProblem([{ original: ' ', replacements: { 'de-DE': 'Hallo' } }])).toMatch(/Row 1: write/);
    expect(interfaceTextProblem([{ original: 'Hi', replacements: {} }, { original: 'Hi', replacements: { 'de-DE': 'Hallo' } }])).toMatch(/Row 2: that text/);
    expect(interfaceTextProblem([{ original: 'Hi {{name}}', replacements: { 'de-DE': 'Hallo' } }])).toMatch(/Row 1 \(de-DE\): keep the same placeholders as the original \(\{\{name\}\}\)/);
    expect(interfaceTextProblem([{ original: 'Hi', replacements: { 'de-DE': 'Hallo {{name}}' } }])).toMatch(/it has none/);
    expect(interfaceTextProblem([{ original: '__proto__', replacements: { 'de-DE': 'x' } }])).toMatch(/won’t take/);
  });

  it('keeps only what’s filled in', () => {
    expect(dictionaryOf([{ original: 'Hi', replacements: { 'de-DE': 'Hallo', 'fr-FR': ' ' } }, { original: '', replacements: {} }, { original: 'Bye', replacements: { 'de-DE': 'Tschüss' } }])).toEqual({ 'de-DE': { Hi: 'Hallo', Bye: 'Tschüss' } });
  });

  it('saves over the admin config as it is now, and refuses where the server has none', async () => {
    const calls: { method: string; body: unknown }[] = [];
    const config = { ENABLE_SIGNUP: false, I18N: { 'de-DE': { Old: 'Alt' } } };
    const fetch: FetchLike = async (_url, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method: init?.method ?? 'GET', body });
      return new Response(JSON.stringify(init?.method === 'POST' ? body : config), { status: 200 });
    };
    const client = new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch });
    expect(await saveInterfaceText(client, [{ original: 'Hi', replacements: { 'de-DE': 'Hallo' } }])).toEqual([{ original: 'Hi', replacements: { 'de-DE': 'Hallo' } }]);
    expect(calls[1]).toEqual({ method: 'POST', body: { ENABLE_SIGNUP: false, I18N: { 'de-DE': { Hi: 'Hallo' } } } });
    await expect(saveInterfaceText(client, [{ original: 'Hi {{n}}', replacements: { 'de-DE': 'Hallo' } }])).rejects.toThrow(/placeholders/);
    const old: FetchLike = async () => new Response(JSON.stringify({ ENABLE_SIGNUP: false }), { status: 200 });
    await expect(saveInterfaceText(new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch: old }), [])).rejects.toThrow(/0\.12/);
  });

  it('names languages, falling back to their codes', () => {
    expect(WEB_LANGUAGES).toContain('en-US');
    expect(languageName('de-DE')).toContain('de-DE');
    expect(languageName('dg-DG')).toContain('dg-DG');
  });
});
