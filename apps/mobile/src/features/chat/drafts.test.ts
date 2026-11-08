import { describe, expect, it } from 'vitest';
import { carryOver, connectFirst, draftTools, getDraft, updateDraft } from './drafts';

const tools = [
  { id: 'plain', name: 'Plain' },
  { id: 'server:mcp:notion', name: 'Notion', authenticated: false },
  { id: 'server:mcp:gh', name: 'GitHub', authenticated: true },
];

describe('tools in a draft', () => {
  it('sends the usable tools, the model’s own once connected, and lists the ones still to connect', () => {
    expect(draftTools({ toolIds: ['plain', 'gone'], pendingToolIds: ['server:mcp:notion', 'server:mcp:gh'] }, tools)).toEqual({
      toolIds: ['plain', 'server:mcp:gh'],
      waiting: [{ id: 'server:mcp:notion', name: 'Notion', clientId: 'mcp:notion', connected: false, canDisconnect: false }],
    });
    expect(draftTools({ toolIds: ['server:mcp:notion'], pendingToolIds: [] }, tools)).toEqual({ toolIds: [], waiting: [] });
  });

  it('says what to connect first', () => {
    const notion = { id: 'n', name: 'Notion', clientId: 'mcp:n', connected: false, canDisconnect: false };
    expect(connectFirst([notion])).toBe('Connect Notion first: tap it beside the + button.');
    expect(connectFirst([notion, { ...notion, name: 'Linear' }])).toBe('Connect Notion, Linear first: tap each beside the + button.');
  });

  it('carries the waiting tools into the chat the first message made', () => {
    updateDraft('from-test', (draft) => ({ ...draft, toolIds: ['plain'], pendingToolIds: ['server:mcp:notion'] }));
    carryOver('from-test', 'to-test');
    expect(getDraft('to-test')).toMatchObject({ toolIds: ['plain'], pendingToolIds: ['server:mcp:notion'] });
  });
});
