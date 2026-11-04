import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { readAloud } from './readAloud';

interface AutoReadAloud {
  /** The reply's id (rows are reused as lists scroll, so a change of id is a different reply). */
  id: string;
  /** Being written now. */
  writing: boolean;
  /** Ended well (not stopped or failed). */
  finished: boolean;
  markdown: string;
  enabled: boolean;
  rate?: number;
  /** Asked when the reply ends: true leaves it unread (you stopped it). */
  skip?: () => boolean;
}

/**
 * Auto-playback, as on the web: a reply is read aloud the moment it finishes on screen. Not one
 * that finished while the app was in the background (it would start talking when you come back).
 */
export function useAutoReadAloud({ id, writing, finished, markdown, enabled, rate, skip }: AutoReadAloud): void {
  const seen = useRef<{ id: string; writing: boolean; away: boolean } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && seen.current?.writing) seen.current.away = true;
    });
    return () => subscription.remove();
  }, [enabled]);

  useEffect(() => {
    const before = seen.current;
    const same = before?.id === id;
    if (enabled && same && before.writing && !writing && finished && !before.away && AppState.currentState === 'active' && markdown.trim() && !skip?.()) readAloud(id, markdown, { rate });
    // A new stretch of writing starts with the app in front.
    seen.current = { id, writing, away: same && before.writing && writing ? before.away : AppState.currentState !== 'active' };
  }, [id, writing, finished, markdown, enabled, rate, skip]);
}
