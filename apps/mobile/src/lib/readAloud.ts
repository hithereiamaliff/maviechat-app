import { speakableText, speechLanguage } from '@maviechat/owui-markdown';
import * as Speech from 'expo-speech';
import { useSyncExternalStore } from 'react';

/*
 * Read Aloud, in the phone's own voice (as Open WebUI's web app uses the browser's when the server
 * has no speech engine): one reply at a time. Starting another stops the first; tapping again stops.
 */

let reading: string | null = null;
let session = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

function finish(of: number) {
  if (of !== session) return;
  reading = null;
  emit();
}

/** Longest piece one utterance takes (the platform's limit, else a safe size). */
const pieceLimit = () => Math.max(500, Math.min(Speech.maxSpeechInputLength || 4000, 4000));

/** Cuts a paragraph too long for one utterance at sentence ends. */
function pieces(paragraph: string): string[] {
  const limit = pieceLimit();
  if (paragraph.length <= limit) return [paragraph];
  const out: string[] = [];
  let rest = paragraph;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('。'), window.lastIndexOf('! '), window.lastIndexOf('? '));
    const at = cut > limit / 2 ? cut + 1 : limit;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/** Reads a reply's Markdown aloud under `id`; false when it has nothing to say. */
export function readAloud(id: string, markdown: string, options: { rate?: number } = {}): boolean {
  const paragraphs = speakableText(markdown).flatMap(pieces);
  session += 1;
  const mine = session;
  void Speech.stop();
  if (!paragraphs.length) {
    finish(mine);
    return false;
  }
  reading = id;
  emit();
  paragraphs.forEach((text, index) => {
    Speech.speak(text, {
      rate: options.rate ?? 1,
      language: speechLanguage(text),
      // The system manages its own audio session: other audio is lowered while it speaks.
      useApplicationAudioSession: false,
      onDone: index === paragraphs.length - 1 ? () => finish(mine) : undefined,
      onStopped: () => finish(mine),
      onError: () => finish(mine),
    });
  });
  return true;
}

export function stopReading(): void {
  session += 1;
  reading = null;
  void Speech.stop();
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the reply `id` is being read aloud now. */
export function useReadingAloud(id: string): boolean {
  return useSyncExternalStore(subscribe, () => reading === id);
}
