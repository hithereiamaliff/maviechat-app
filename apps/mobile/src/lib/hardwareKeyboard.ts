import { requireOptionalNativeModule } from 'expo';
import { useEffect, useEffectEvent } from 'react';
import { createKeyCommands, type KeyCommandName, type KeyCommandNative } from './keyCommandRegistry';

/**
 * An iPad's keyboard (M9): the app's own add-on, `modules/maviechat-keyboard`, from the 1.0.0
 * build on. In builds without it (build 6, Android), every call here does nothing.
 */
const keyCommands = createKeyCommands(requireOptionalNativeModule<KeyCommandNative>('MavieKeyboard'));

/** Handles a keyboard command while `active`; the latest screen to ask for one wins. */
export function useKeyCommand(name: KeyCommandName, handler: () => void, active = true): void {
  const onCommand = useEffectEvent(handler);
  useEffect(() => {
    if (!active || !keyCommands.available) return;
    return keyCommands.register(name, () => onCommand());
  }, [name, active]);
}
