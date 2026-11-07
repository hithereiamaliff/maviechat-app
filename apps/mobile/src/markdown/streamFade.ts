import type { Token } from '@maviechat/owui-markdown';
import { useEffect, useState } from 'react';

/** How long a new word takes to fade in (the web's 100 ms). */
export const FADE_MS = 100;

/** What the fade knows about a growing text. */
export interface StreamFade {
  /** How much of the text has been seen; what comes after hasn't shown yet. */
  seen: number;
  /** When each part arrived: from `start` on, at `at` (animation-frame time, ms), in order. */
  arrivals: { start: number; at: number }[];
  /** The time of the latest frame. */
  now: number;
}

/** A character's opacity: 0 until the fade has seen it, then up to 1 over `FADE_MS`. */
export function fadeAlpha(fade: StreamFade, offset: number): number {
  if (offset >= fade.seen) return 0;
  let at = -Infinity;
  for (const arrival of fade.arrivals) if (arrival.start <= offset) at = arrival.at;
  return Math.max(0, Math.min(1, (fade.now - at) / FADE_MS));
}

/** The fade's next state, a frame later at `time`, for the text as it now is. */
export function nextFade(previous: StreamFade, length: number, time: number): StreamFade {
  // Replaced, not added to (a regenerated or edited reply): start again.
  if (length < previous.seen) return { seen: length, arrivals: [], now: time };
  const arrivals = previous.arrivals.filter((arrival) => time - arrival.at < FADE_MS);
  if (length > previous.seen) arrivals.push({ start: previous.seen, at: time });
  return { seen: length, arrivals, now: time };
}

/**
 * While `active` (a reply being written, with the web's "Fade Effect for Streaming Text" on), new
 * text fades in: frames are drawn for a moment after each change. Null when not fading.
 */
export function useStreamFade(text: string, active: boolean): StreamFade | null {
  const [fade, setFade] = useState<StreamFade>({ seen: text.length, arrivals: [], now: 0 });
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let first = 0;
    const tick = (time: number) => {
      if (!first) first = time;
      setFade((previous) => nextFade(previous, text.length, time));
      if (time - first < FADE_MS + 34) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, active]);
  return active ? fade : null;
}

/**
 * The text token new words arrive in: the last plain text of the last block (a paragraph, a list's
 * last item, a heading), with where it starts in `source`; null when the text doesn't end there
 * (a code block or a table is being written).
 */
export function fadingTail(tokens: Token[], source: string): { token: Token; start: number } | null {
  let token: Token | undefined = [...tokens].reverse().find((item) => item.type !== 'space');
  for (let depth = 0; token && depth < 12; depth += 1) {
    if (token.type === 'list') token = (token as unknown as { items: Token[] }).items.at(-1);
    else if ('tokens' in token && Array.isArray(token.tokens) && token.tokens.length) token = [...(token.tokens as Token[])].reverse().find((item) => item.type !== 'space');
    else break;
  }
  if (!token || token.type !== 'text' || typeof (token as { text?: unknown }).text !== 'string') return null;
  const end = source.trimEnd();
  const raw = token.raw.trimEnd();
  const at = raw ? end.lastIndexOf(raw) : -1;
  // A few characters of closing marks (`**`, `_`) may follow it.
  if (at < 0 || end.length - (at + raw.length) > 3) return null;
  return { token, start: at };
}

/** `#RRGGBB` (or `#RGB`) at an opacity, as `#RRGGBBAA`; other colours as they are. */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return color;
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  return `#${full}${Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')}`;
}
