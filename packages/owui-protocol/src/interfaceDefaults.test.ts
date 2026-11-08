import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { hasSettingAt, interfaceDefaultsOf, otherDefaultKeys, saveInterfaceDefaults, withoutEmpty } from './interfaceDefaults';

function adminServer(config: Record<string, unknown>) {
  const sent: unknown[] = [];
  const fetch: FetchLike = async (_url, init) => {
    if ((init?.method ?? 'GET') === 'POST') {
      const body = JSON.parse(String(init?.body));
      sent.push(body);
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response(JSON.stringify(config), { status: 200 });
  };
  return { client: new OwuiClient({ baseUrl: 'https://x.test', token: 't', fetch }), sent };
}

describe('the Interface settings everyone starts with', () => {
  it('reads them from the admin config, and says which are set', () => {
    expect(interfaceDefaultsOf({ DEFAULT_INTERFACE_SETTINGS: ['no'] })).toEqual({});
    expect(interfaceDefaultsOf(undefined)).toEqual({});
    const defaults = { chatBubble: false, title: { auto: false }, webSearch: null };
    expect(hasSettingAt(defaults, 'chatBubble')).toBe(true);
    expect(hasSettingAt(defaults, 'title.auto')).toBe(true);
    expect(hasSettingAt(defaults, 'webSearch')).toBe(false);
    expect(hasSettingAt(defaults, 'autoTags')).toBe(false);
  });

  it('names what the web sets that the app doesn’t show', () => {
    expect(otherDefaultKeys({ chatBubble: true, title: { auto: false }, chatDirection: 'RTL', widescreenMode: true, textScale: 1.2, landingPageMode: 'chat', gone: null })).toEqual(['textScale', 'widescreenMode']);
  });

  it('drops the empty groups and nulls a removal leaves', () => {
    expect(withoutEmpty({ title: {}, a: null, b: { c: { d: undefined } }, e: false, f: { g: 1 } })).toEqual({ e: false, f: { g: 1 } });
  });

  it('saves only the changes, over the admin config as it is now; or clears first', async () => {
    const config = { ENABLE_SIGNUP: true, WEBUI_URL: 'https://chat.example.com', DEFAULT_INTERFACE_SETTINGS: { chatBubble: false, title: { auto: false }, widescreenMode: true } };
    const { client, sent } = adminServer(config);
    const kept = await saveInterfaceDefaults(client, { chatBubble: true, 'title.auto': undefined, copyFormatted: true });
    expect(sent[0]).toEqual({ ENABLE_SIGNUP: true, WEBUI_URL: 'https://chat.example.com', DEFAULT_INTERFACE_SETTINGS: { chatBubble: true, widescreenMode: true, copyFormatted: true } });
    expect(kept).toEqual({ chatBubble: true, widescreenMode: true, copyFormatted: true });
    await saveInterfaceDefaults(client, { copyFormatted: true }, { clear: true });
    expect((sent[1] as { DEFAULT_INTERFACE_SETTINGS: unknown }).DEFAULT_INTERFACE_SETTINGS).toEqual({ copyFormatted: true });
  });
});
