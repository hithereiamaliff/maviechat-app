import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { chatBackgroundUrl, chatDirection, imageCompressionSize, interfaceChange, interfaceOn, saveUiSettings, speechRate, speechRateLabel, stepSpeechRate, uiValue, withUiChanges } from './settings';

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
    // Taking a setting away sends null for it: 0.12 keeps a key that's left out.
    await saveUiSettings(client, { unknownKey: undefined });
    expect(sent[1]).toEqual({ ui: { models: ['a'], unknownKey: null }, other: { x: true } });
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

  it('reads the landing page mode as the web stores it', () => {
    expect(interfaceOn({}, 'landingPageMode')).toBe(false);
    expect(interfaceOn({ landingPageMode: '' }, 'landingPageMode')).toBe(false);
    expect(interfaceOn({ landingPageMode: 'chat' }, 'landingPageMode')).toBe(true);
    expect(interfaceChange('landingPageMode', true)).toEqual({ landingPageMode: 'chat' });
    expect(interfaceChange('landingPageMode', false)).toEqual({ landingPageMode: '' });
  });
});

describe('Read Aloud speed', () => {
  it('reads the saved speed, else normal', () => {
    expect(speechRate({ audio: { tts: { playbackRate: 1.5 } } })).toBe(1.5);
    expect(speechRate({ audio: { tts: { playbackRate: '1.25' } } })).toBe(1.25);
    expect(speechRate({ audio: { tts: { playbackRate: 0 } } })).toBe(1);
    expect(speechRate(null)).toBe(1);
  });

  it('steps through the offered speeds, from a speed set on the web too', () => {
    expect(stepSpeechRate(1, 1)).toBe(1.25);
    expect(stepSpeechRate(1, -1)).toBe(0.75);
    expect(stepSpeechRate(2, 1)).toBe(2);
    expect(stepSpeechRate(0.5, -1)).toBe(0.5);
    expect(stepSpeechRate(1.1, 1)).toBe(1.25);
    expect(stepSpeechRate(1.1, -1)).toBe(1);
    expect(speechRateLabel(1)).toBe('1×');
    expect(speechRateLabel(1.25)).toBe('1.25×');
  });
});

describe('chat appearance settings', () => {
  it('follows the web’s defaults for bubbles, names, fading and quick actions', () => {
    expect(interfaceOn({}, 'chatBubble')).toBe(true);
    expect(interfaceOn({}, 'showUsername')).toBe(false);
    expect(interfaceOn({}, 'chatFadeStreamingText')).toBe(true);
    expect(interfaceOn({}, 'showFloatingActionButtons')).toBe(true);
    expect(interfaceOn({}, 'imageCompression')).toBe(false);
    expect(interfaceOn({ chatBubble: false, chatFadeStreamingText: false }, 'chatBubble')).toBe(false);
    expect(interfaceChange('chatBubble', false)).toEqual({ chatBubble: false });
  });

  it('reads the chat direction, the background and the photo size as the web saves them', () => {
    expect(chatDirection({})).toBe('auto');
    expect(chatDirection({ chatDirection: 'RTL' })).toBe('RTL');
    expect(chatDirection({ chatDirection: 'sideways' })).toBe('auto');
    expect(chatBackgroundUrl({ backgroundImageUrl: 'data:image/jpeg;base64,/9j/4AAQ' })).toBe('data:image/jpeg;base64,/9j/4AAQ');
    expect(chatBackgroundUrl({ backgroundImageUrl: null })).toBeNull();
    expect(chatBackgroundUrl({ backgroundImageUrl: 'javascript:alert(1)' })).toBeNull();
    expect(imageCompressionSize({ imageCompressionSize: { width: 1024, height: '' } })).toEqual({ width: 1024, height: null });
    expect(imageCompressionSize({ imageCompressionSize: { width: '800', height: 600.4 } })).toEqual({ width: 800, height: 600 });
    expect(imageCompressionSize({})).toEqual({ width: null, height: null });
  });
});
