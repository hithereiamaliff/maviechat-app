import { describe, expect, it } from 'vitest';
import { OwuiClient, type FetchLike } from './http';
import { toolsToConnect } from './input';
import type { ModelItem } from './models';
import { disconnectOAuthTool, needsConnect, oauthAuthorizePath, oauthCallbackPath, oauthReturn, oauthToolOf } from './tools';

describe('tools that sign in to their own service', () => {
  it('reads the sign-in client as the web does, and only for tools that report it', () => {
    expect(oauthToolOf({ id: 'server:mcp:notion', name: 'Notion', authenticated: false })).toEqual({
      id: 'server:mcp:notion',
      name: 'Notion',
      clientId: 'mcp:notion',
      connected: false,
      canDisconnect: false,
    });
    expect(oauthToolOf({ id: 'server:mcp:gh', name: '', authenticated: true })).toMatchObject({ name: 'server:mcp:gh', clientId: 'mcp:gh', connected: true, canDisconnect: true });
    expect(oauthToolOf({ id: 'web_search_tool', name: 'Search' })).toBeNull();
    expect(needsConnect({ id: 'a', name: 'A', authenticated: false })).toBe(true);
    expect(needsConnect({ id: 'a', name: 'A' })).toBe(false);
    expect(needsConnect(undefined)).toBe(false);
  });

  it('builds the server’s sign-in pages for the client', () => {
    expect(oauthAuthorizePath('mcp:notion')).toBe('/oauth/clients/mcp:notion/authorize');
    expect(oauthCallbackPath('mcp:my tools')).toBe('/oauth/clients/mcp:my%20tools/callback');
  });

  it('ends at the page the server sends you to after the callback, with its error if any', () => {
    const client = 'mcp:notion';
    expect(oauthReturn('https://chat.example.com/oauth/clients/mcp:notion/authorize', client, false)).toEqual({ kind: 'waiting', sawCallback: false });
    expect(oauthReturn('https://login.notion.com/authorize?client_id=x', client, false)).toEqual({ kind: 'waiting', sawCallback: false });
    expect(oauthReturn('https://chat.example.com/oauth/clients/mcp%3Anotion/callback?code=1&state=2', client, false)).toEqual({ kind: 'waiting', sawCallback: true });
    expect(oauthReturn('https://chat.example.com', client, true)).toEqual({ kind: 'done', error: null });
    expect(oauthReturn('https://chat.example.com/?error=Token+exchange+failed%3A+nope', client, true)).toEqual({ kind: 'done', error: 'Token exchange failed: nope' });
    expect(oauthReturn('about:blank', client, true)).toEqual({ kind: 'waiting', sawCallback: true });
    expect(oauthReturn('not a url', client, true)).toEqual({ kind: 'waiting', sawCallback: true });
  });

  it('disconnects the sign-in the server keeps for the tool', async () => {
    const calls: { method: string; url: string }[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ method: init?.method ?? 'GET', url });
      return new Response('true', { status: 200 });
    };
    await disconnectOAuthTool(new OwuiClient({ baseUrl: 'https://chat.example.com', token: 't', fetch }), { clientId: 'mcp:notion' });
    expect(calls).toEqual([{ method: 'DELETE', url: 'https://chat.example.com/api/v1/auths/oauth/sessions/mcp%3Anotion' }]);
  });

  it('lists the model’s own tools that wait to be connected', () => {
    const model = { id: 'm', info: { meta: { toolIds: ['server:mcp:notion', 'plain', 'server:mcp:notion', 'server:mcp:gh'] } } } as unknown as ModelItem;
    const tools = [
      { id: 'server:mcp:notion', name: 'Notion', authenticated: false },
      { id: 'server:mcp:gh', name: 'GitHub', authenticated: true },
      { id: 'plain', name: 'Plain' },
    ];
    expect(toolsToConnect(model, tools)).toEqual(['server:mcp:notion']);
    expect(toolsToConnect(undefined, tools)).toEqual([]);
  });
});
