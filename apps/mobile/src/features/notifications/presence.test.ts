import { describe, expect, it } from 'vitest';
import { setViewingChat, shouldPresent } from './presence';

describe('push presence', () => {
  it('shows every notification while the app is open, except for the chat on screen', () => {
    setViewingChat('c1');
    expect(shouldPresent({ chatId: 'c1' })).toBe(false);
    expect(shouldPresent({ chatId: 'c2' })).toBe(true);
    expect(shouldPresent({ kind: 'test' })).toBe(true);
    expect(shouldPresent(undefined)).toBe(true);
    setViewingChat(null);
    expect(shouldPresent({ chatId: 'c1' })).toBe(true);
  });
});
