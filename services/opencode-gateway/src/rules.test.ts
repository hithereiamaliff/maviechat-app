import { describe, expect, it } from 'vitest';
import { ASK_BEFORE_CHANGES, checkRequest, folderAllowed, insideProject, withApprovals } from './rules.ts';

const folders = ['/home/dev/work', '/srv/projects'];
const query = (value: Record<string, string>) => new URLSearchParams(value);

describe('folders', () => {
  it('allows the folders and what is inside them, nothing else', () => {
    expect(folderAllowed('/home/dev/work', folders)).toBe(true);
    expect(folderAllowed('/home/dev/work/website', folders)).toBe(true);
    expect(folderAllowed('/srv/projects/a/b/', folders)).toBe(true);
    for (const outside of ['/home/dev', '/home/dev/workshop', '/home/dev/work/../.ssh', '/etc', 'home/dev/work', '', '/home/dev/work\0/x']) {
      expect(folderAllowed(outside, folders)).toBe(false);
    }
  });

  it('keeps file paths inside the project', () => {
    for (const inside of ['', '.', 'src', 'src/app/index.ts', 'a/../b']) expect(insideProject(inside)).toBe(true);
    for (const outside of ['/etc/passwd', '..', '../x', 'src/../../x', 'a\\..\\b']) expect(insideProject(outside)).toBe(false);
  });
});

describe('requests', () => {
  it('lets through only the routes the app uses, for allowed projects', () => {
    expect(checkRequest('GET', '/session', query({ directory: '/home/dev/work/app' }), folders)).toEqual({ ok: true, label: '/session' });
    expect(checkRequest('POST', '/session/ses_123/prompt_async', query({ directory: '/home/dev/work/app' }), folders)).toMatchObject({ ok: true, label: '/session/:id/prompt_async' });
    expect(checkRequest('GET', '/global/health', query({}), folders)).toMatchObject({ ok: true });
    expect(checkRequest('GET', '/config', query({ directory: '/home/dev/work/app' }), folders)).toEqual({ ok: true, label: '/config' });
    expect(checkRequest('GET', '/config', query({ directory: '/etc' }), folders)).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest('PATCH', '/global/config', query({}), folders)).toEqual({ ok: true, label: '/global/config' });
    expect(checkRequest('GET', '/session', query({}), folders)).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest('GET', '/session', query({ directory: '/etc' }), folders)).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest('GET', '/session', query({ directory: '/home/dev/work/app', workspace: 'w1' }), folders)).toMatchObject({ ok: false, status: 403 });
    // Routes the app doesn't use stay closed, whatever the project.
    for (const [method, path] of [
      ['POST', '/session/ses_1/shell'],
      ['PUT', '/auth/anthropic'],
      ['POST', '/session/ses_1/command'],
      ['PATCH', '/config'],
      ['GET', '/config/raw'],
      ['GET', '/global/config'],
      ['POST', '/global/dispose'],
      ['POST', '/pty'],
      ['GET', '/experimental/session'],
    ] as const) {
      expect(checkRequest(method, path, query({ directory: '/home/dev/work/app' }), folders)).toMatchObject({ ok: false, status: 404 });
    }
  });

  it('keeps file reads inside the project', () => {
    expect(checkRequest('GET', '/file', query({ directory: '/home/dev/work/app', path: 'src' }), folders)).toMatchObject({ ok: true });
    expect(checkRequest('GET', '/file', query({ directory: '/home/dev/work/app', path: '../../.ssh' }), folders)).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest('GET', '/file', query({ directory: '/home/dev/work/app', path: '/etc' }), folders)).toMatchObject({ ok: false, status: 403 });
    // File contents stay closed altogether (a project's .env).
    expect(checkRequest('GET', '/file/content', query({ directory: '/home/dev/work/app', path: 'src/index.ts' }), folders)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('approvals', () => {
  it('asks before edits and commands in new sessions, unless the phone said not to or set its own rules', () => {
    expect(withApprovals({ title: 'x' }, undefined)).toEqual({ title: 'x', permission: ASK_BEFORE_CHANGES });
    expect(withApprovals(undefined, undefined)).toEqual({ permission: ASK_BEFORE_CHANGES });
    expect(withApprovals({ title: 'x' }, 'off')).toEqual({ title: 'x' });
    const own = { permission: [{ permission: 'bash', pattern: 'git *', action: 'allow' }] };
    expect(withApprovals(own, undefined)).toBe(own);
  });
});
