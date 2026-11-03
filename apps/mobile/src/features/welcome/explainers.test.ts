import { describe, expect, it } from 'vitest';
import { EXPLAINERS } from './explainers';

describe('welcome explainers', () => {
  it('lead each product to its own sign-in', () => {
    expect(EXPLAINERS.owui.action?.route).toBe('/login');
    expect(EXPLAINERS.deeptutor.action?.route).toBe('/deeptutor-login');
  });

  it('say how the two differ, and what you need', () => {
    for (const key of ['owui', 'deeptutor'] as const) {
      const headings = EXPLAINERS[key].sections.map((section) => section.heading);
      expect(headings.some((heading) => heading.startsWith('How it differs'))).toBe(true);
      expect(headings).toContain('What you need');
    }
  });

  it('point people without a server to the official guides', () => {
    const noServer = EXPLAINERS['no-server'];
    expect(noServer.action).toBeUndefined();
    expect(noServer.links?.length).toBe(2);
    for (const link of noServer.links ?? []) expect(link.url).toMatch(/^https:\/\//);
  });
});
