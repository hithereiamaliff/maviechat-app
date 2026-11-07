import type { ChatDirection } from '@maviechat/owui-protocol';
import { createContext } from 'react';
import type { TextStyle, ViewStyle } from 'react-native';

/** Which way an Open WebUI chat's text runs (Settings → Interface → Chat direction); automatic elsewhere. */
export const ChatDirectionContext = createContext<ChatDirection>('auto');

/**
 * Styles for a chosen direction: the layout mirrored for right to left, and text set that way.
 * Automatic leaves each paragraph to its own language, as the web's `dir="auto"` does.
 */
export function directionStyles(direction: ChatDirection): { view?: ViewStyle; text?: TextStyle } {
  if (direction === 'RTL') return { view: { direction: 'rtl' }, text: { writingDirection: 'rtl', textAlign: 'right' } };
  if (direction === 'LTR') return { view: { direction: 'ltr' }, text: { writingDirection: 'ltr', textAlign: 'left' } };
  return {};
}
