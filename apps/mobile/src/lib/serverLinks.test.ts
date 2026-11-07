import { describe, expect, it } from 'vitest';
import { serverLinkTarget } from './serverLinks';

const base = 'https://chat.example.com';

describe('links to your server’s own pages', () => {
  it('opens chats, shared chats, notes, folders and knowledge in the app', () => {
    expect(serverLinkTarget('https://chat.example.com/c/abc-1', base)).toEqual({ kind: 'route', pathname: '/c/[id]', params: { id: 'abc-1' } });
    expect(serverLinkTarget('/s/share-9', base)).toEqual({ kind: 'route', pathname: '/s/[id]', params: { id: 'share-9' } });
    expect(serverLinkTarget('/notes', base)).toEqual({ kind: 'route', pathname: '/notes' });
    expect(serverLinkTarget('/notes/n1?page=p2', base)).toEqual({ kind: 'route', pathname: '/notes/[id]', params: { id: 'n1', page: 'p2' } });
    expect(serverLinkTarget('/folders/f%201', base)).toEqual({ kind: 'route', pathname: '/folders/[id]', params: { id: 'f 1' } });
    expect(serverLinkTarget('/workspace/knowledge/k1', base)).toEqual({ kind: 'route', pathname: '/knowledge/[id]', params: { id: 'k1' } });
    expect(serverLinkTarget('/workspace/prompts', base)).toEqual({ kind: 'route', pathname: '/workspace', params: { area: 'prompts' } });
    expect(serverLinkTarget('/workspace', base)).toEqual({ kind: 'route', pathname: '/workspace' });
    expect(serverLinkTarget('/admin/users/overview', base)).toEqual({ kind: 'route', pathname: '/admin' });
  });

  it('starts a new chat with the web’s address settings, and opens the server’s files with your sign-in', () => {
    expect(serverLinkTarget('https://chat.example.com/?q=Hello&models=a,b', base)).toEqual({ kind: 'route', pathname: '/', params: { q: 'Hello', models: 'a,b' } });
    expect(serverLinkTarget('https://chat.example.com/', base)).toEqual({ kind: 'route', pathname: '/' });
    expect(serverLinkTarget('/api/v1/files/f-1/content', base)).toEqual({ kind: 'file', id: 'f-1' });
  });

  it('leaves other servers, pages the app doesn’t have, and other schemes to the browser', () => {
    expect(serverLinkTarget('https://other.example.com/c/abc', base)).toBeNull();
    expect(serverLinkTarget('http://chat.example.com/c/abc', base)).toBeNull();
    expect(serverLinkTarget('/channels/x', base)).toBeNull();
    expect(serverLinkTarget('/playground', base)).toBeNull();
    expect(serverLinkTarget('/c/abc/extra', base)).toBeNull();
    expect(serverLinkTarget('mailto:a@b.c', base)).toBeNull();
    expect(serverLinkTarget('/c/abc', null)).toBeNull();
  });

  it('follows a server that lives under a path', () => {
    expect(serverLinkTarget('https://host.example/owui/c/abc', 'https://host.example/owui')).toEqual({ kind: 'route', pathname: '/c/[id]', params: { id: 'abc' } });
    expect(serverLinkTarget('https://host.example/other/c/abc', 'https://host.example/owui')).toBeNull();
  });
});
