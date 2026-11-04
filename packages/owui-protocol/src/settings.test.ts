import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { interfaceChange, interfaceOn, saveUiSettings, uiValue, withUiChanges } from './settings';

describe('your settings', () => {
  it('reads and changes them by path, copying what it changes and dropping what is put back', () => {
    const ui = { audio: { tts: { playbackRate: 1.5, voice: 'Ava' }, stt: { engine: '' } }, chatBubble: true, models: ['m'] };
    expect(uiValue(ui, 'audio.tts.voice')).toBe('Ava');
    expect(uiValue(ui, 'audio.nope.voice')).toBeUndefined();
    expect(uiValue(null, 'chatBubble')).toBeUndefined();
    const changed = withUiChanges(ui, { 'audio.tts.playbackRate': 2, chatBubble: undefined, 'notifications.webhook_url': '' });
    expect(changed).toEqual({ audio: { tts: { playbackRate: 2, voice: 'Ava' }, stt: { engine: '' } }, models: ['m'], notifications: { webhook_url: '' } });
    // The original is untouched.
    expect(ui.audio.tts.playbackRate).toBe(1.5);
    expect(ui.chatBubble).toBe(true);
  });

  it('writes back everything else it read', async () => {
    const sent: unknown[] = [];
    const fetch: FetchLike = async (url, init) => {
      if (init?.method === 'POST') {
        sent.push(JSON.parse(String(init.body)));
        return new Response(String(init.body), { status: 200 });
      }
      return new Response(JSON.stringify({ ui: { models: ['a'], unknownKey: 1 }, other: { x: true } }), { status: 200 });
    };
    const client = new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch });
    await saveUiSettings(client, { system: 'Be brief.' });
    expect(sent).toEqual([{ ui: { models: ['a'], unknownKey: 1, system: 'Be brief.' }, other: { x: true } }]);
  });

  it('reads the Interface settings with the web’s defaults, and stores them as the web does', () => {
    expect(interfaceOn({}, 'enableMessageQueue')).toBe(true);
    expect(interfaceOn({ enableMessageQueue: false }, 'enableMessageQueue')).toBe(false);
    expect(interfaceOn({ title: { auto: false, other: 1 } }, 'titleAuto')).toBe(false);
    expect(interfaceOn({ webSearch: 'always' }, 'webSearch')).toBe(true);
    expect(interfaceOn({ webSearch: null }, 'webSearch')).toBe(false);
    expect(interfaceOn({ defaultUploadContext: 'focused' }, 'defaultUploadContext')).toBe(false);
    expect(interfaceChange('webSearch', false)).toEqual({ webSearch: null });
    expect(interfaceChange('defaultUploadContext', true)).toEqual({ defaultUploadContext: 'full' });
    expect(withUiChanges({ title: { auto: true, prompt: 'x' } }, interfaceChange('titleAuto', false))).toEqual({ title: { auto: false, prompt: 'x' } });
  });
});
