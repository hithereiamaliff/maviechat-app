import { describe, expect, it, vi } from 'vitest';
import { createKeyCommands, type KeyCommandNative } from './keyCommandRegistry';

function fakeNative() {
  const sets: string[][] = [];
  let listener: ((event: { name: string }) => void) | null = null;
  const native: KeyCommandNative = {
    setCommands: vi.fn(async (names: string[]) => {
      sets.push(names);
    }),
    addListener: (_event, next) => {
      listener = next;
      return { remove: () => undefined };
    },
  };
  return { native, sets, press: (name: string) => listener?.({ name }) };
}

describe('keyboard commands', () => {
  it('turns on only what someone handles, and the latest to register handles it', () => {
    const { native, sets, press } = fakeNative();
    const commands = createKeyCommands(native);
    const chat = vi.fn();
    const sidebar = vi.fn();
    const offChat = commands.register('newChat', chat);
    const offSidebar = commands.register('sidebar', sidebar);
    expect(sets.at(-1)).toEqual(['newChat', 'sidebar']);

    const composer = vi.fn();
    const offReturn = commands.register('return', composer);
    expect(sets.at(-1)).toEqual(['newChat', 'return', 'sidebar']);
    press('return');
    expect(composer).toHaveBeenCalledTimes(1);

    // Leaving the message box turns Return back over to typing.
    offReturn();
    expect(sets.at(-1)).toEqual(['newChat', 'sidebar']);
    press('newChat');
    expect(chat).toHaveBeenCalledTimes(1);

    // A newer screen's handler wins until it goes.
    const newer = vi.fn();
    const offNewer = commands.register('newChat', newer);
    press('newChat');
    expect(newer).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);
    offNewer();
    press('newChat');
    expect(chat).toHaveBeenCalledTimes(2);

    offChat();
    offSidebar();
    expect(sets.at(-1)).toEqual([]);
  });

  it('tells the add-on only when the set changes', () => {
    const { native, sets } = fakeNative();
    const commands = createKeyCommands(native);
    const offA = commands.register('newChat', () => undefined);
    const offB = commands.register('newChat', () => undefined);
    expect(sets).toEqual([['newChat']]);
    offB();
    expect(sets).toEqual([['newChat']]);
    offA();
    expect(sets).toEqual([['newChat'], []]);
  });

  it('does nothing in a build without the add-on', () => {
    const commands = createKeyCommands(null);
    const run = vi.fn();
    expect(commands.available).toBe(false);
    commands.register('return', run)();
    expect(commands.dispatch('return')).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
