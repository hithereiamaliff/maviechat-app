import { describe, expect, it } from 'vitest';
import { buildCapabilities } from './capabilities';
import type { ServerConfig } from './server';
import { canUseWorkspace, sidebarShortcuts } from './shortcuts';

const config = (features: Record<string, unknown>): ServerConfig => ({ name: 'Test', version: '0.11.3', features });

describe('sidebarShortcuts', () => {
  it('pins Notes and Workspace by default, when the account may use them', () => {
    const caps = buildCapabilities({
      config: config({ enable_notes: true }),
      user: { role: 'user', permissions: { workspace: { prompts: true } } },
    });
    expect(sidebarShortcuts(caps, undefined)).toEqual(['notes', 'workspace']);
  });

  it('treats an unlisted Notes permission as allowed, but needs the flag', () => {
    const user = { role: 'user', permissions: {} };
    expect(sidebarShortcuts(buildCapabilities({ config: config({ enable_notes: true }), user }), undefined)).toEqual(['notes']);
    expect(sidebarShortcuts(buildCapabilities({ config: config({}), user }), undefined)).toEqual([]);
    const denied = { role: 'user', permissions: { features: { notes: false } } };
    expect(sidebarShortcuts(buildCapabilities({ config: config({ enable_notes: true }), user: denied }), undefined)).toEqual([]);
  });

  it("follows the user's order and skips unknown or unavailable pages", () => {
    const caps = buildCapabilities({
      config: config({ enable_calendar: true, enable_automations: false }),
      user: { role: 'user', permissions: { features: { calendar: true, automations: true }, workspace: { skills: true } } },
    });
    expect(sidebarShortcuts(caps, ['calendar', 'channels', 'automations', 'workspace', 'calendar', 'playground'])).toEqual([
      'calendar',
      'workspace',
    ]);
  });

  it('gives admins Workspace and Playground', () => {
    const caps = buildCapabilities({ config: config({}), user: { role: 'admin', permissions: {} } });
    expect(canUseWorkspace(caps)).toBe(true);
    expect(sidebarShortcuts(caps, ['playground', 'workspace'])).toEqual(['playground', 'workspace']);
  });
});
