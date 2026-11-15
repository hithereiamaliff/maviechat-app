/*
 * Keyboard commands from an iPad's keyboard (M9): who handles each one now, and which ones the
 * native add-on (`modules/maviechat-keyboard`) should listen for. Kept free of React Native so it can
 * be tested on its own; `lib/hardwareKeyboard.ts` connects it to the add-on.
 */

/**
 * - `return`: send from the message box you're typing in (Shift-Return still starts a new line).
 * - The rest follow Open WebUI's web shortcuts: ⌘⇧O new chat, ⌘K search, ⌘. settings, ⌘⇧S the
 *   sidebar, ⇧Esc back to the message box.
 */
export type KeyCommandName = 'return' | 'newChat' | 'search' | 'settings' | 'sidebar' | 'focusInput';

/** The add-on, where the build has it. */
export interface KeyCommandNative {
  setCommands(names: string[]): Promise<void>;
  addListener(event: 'onKeyCommand', listener: (event: { name: string }) => void): { remove(): void };
}

export interface KeyCommands {
  /** False in builds without the add-on (every call then does nothing). */
  available: boolean;
  /** Handles `name` until the returned function is called; the latest to register wins. */
  register(name: KeyCommandName, run: () => void): () => void;
  /** Runs the current handler for `name`; false when nothing handles it. */
  dispatch(name: string): boolean;
}

export function createKeyCommands(native: KeyCommandNative | null): KeyCommands {
  const entries: { name: KeyCommandName; run: () => void }[] = [];
  let sent = '';
  let listening = false;

  const dispatch = (name: string): boolean => {
    for (let at = entries.length - 1; at >= 0; at -= 1) {
      const entry = entries[at];
      if (entry?.name === name) {
        entry.run();
        return true;
      }
    }
    return false;
  };

  // Tells the add-on which commands someone handles now (it only listens for those).
  const sync = () => {
    if (!native) return;
    if (!listening) {
      listening = true;
      native.addListener('onKeyCommand', (event) => void dispatch(event.name));
    }
    const names = [...new Set(entries.map((entry) => entry.name))].sort();
    const key = names.join(',');
    if (key === sent) return;
    sent = key;
    void native.setCommands(names).catch(() => undefined);
  };

  return {
    available: native !== null,
    register(name, run) {
      if (!native) return () => undefined;
      const entry = { name, run };
      entries.push(entry);
      sync();
      return () => {
        const at = entries.indexOf(entry);
        if (at >= 0) entries.splice(at, 1);
        sync();
      };
    },
    dispatch,
  };
}
