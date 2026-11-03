import { useLayoutEffect, useRef, useState } from 'react';
import type { ViewStyle } from 'react-native';

/** Lower than any line of text, so it never changes the box; only the change itself matters. */
const SECOND_PASS: ViewStyle = { minHeight: 1 };

/**
 * Keeps an input bar's height right when the app sets its text rather than you typing it: cleared
 * after sending, an idea or a queued message put in, edits made in the full-screen editor.
 * React Native (0.88) measures the box before it takes in such text, so the box would keep its old
 * height until the next keystroke. A style change too small to show makes it measure once more.
 */
export function useGrowingInput(text: string, onChangeText: (text: string) => void) {
  const typed = useRef(text);
  const [passes, setPasses] = useState(0);

  useLayoutEffect(() => {
    if (text === typed.current) return;
    typed.current = text;
    setPasses((count) => count + 1);
  }, [text]);

  return {
    value: text,
    onChangeText: (value: string) => {
      typed.current = value;
      onChangeText(value);
    },
    /** Goes last in the input's style. */
    style: passes % 2 === 1 ? SECOND_PASS : undefined,
  };
}
