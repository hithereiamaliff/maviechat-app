import { describe, expect, it } from 'vitest';
import { setPresence, shouldPresent } from './presence';

describe('push presence', () => {
  it('stays quiet for the chat on screen and while the live connection announces replies', () => {
    setPresence({ viewingChatId: 'c1', liveConnected: true });
    expect(shouldPresent({ chatId: 'c1' })).toBe(false);
    expect(shouldPresent({ chatId: 'c2' })).toBe(false);
    expect(shouldPresent({ kind: 'test' })).toBe(true);
    setPresence({ liveConnected: false });
    expect(shouldPresent({ chatId: 'c1' })).toBe(false);
    expect(shouldPresent({ chatId: 'c2' })).toBe(true);
    expect(shouldPresent(undefined)).toBe(true);
    setPresence({ viewingChatId: null });
    expect(shouldPresent({ chatId: 'c1' })).toBe(true);
  });
});
