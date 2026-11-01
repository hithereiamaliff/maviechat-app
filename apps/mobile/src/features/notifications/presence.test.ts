import { describe, expect, it } from 'vitest';
import { setPresence, shouldPresent } from './presence';

describe('push presence', () => {
  it('stays quiet for the chat on screen and while the live connection announces replies', () => {
    setPresence({ viewingChatId: 'c1', liveConnected: true });
    expect(shouldPresent('c1')).toBe(false);
    expect(shouldPresent('c2')).toBe(false);
    setPresence({ liveConnected: false });
    expect(shouldPresent('c1')).toBe(false);
    expect(shouldPresent('c2')).toBe(true);
    expect(shouldPresent(undefined)).toBe(true);
    setPresence({ viewingChatId: null });
    expect(shouldPresent('c1')).toBe(true);
  });
});
