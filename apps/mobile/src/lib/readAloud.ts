import { speakableText, speechLanguage, voiceFits } from '@maviechat/owui-markdown';
import * as Speech from 'expo-speech';
import { useSyncExternalStore } from 'react';
import { devicePrefs, type ChosenVoice } from './devicePrefs';

/*
 * Read Aloud, in the phone's own voice (as Open WebUI's web app uses the browser's when the server
 * has no speech engine): one reply at a time. Starting another stops the first; tapping again stops.
 * The voice you chose (Settings → Audio) reads the text in its language; other languages get the
 * phone's voice for theirs.
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
export function readAloud(id: string, markdown: string, options: { rate?: number; voice?: ChosenVoice | null } = {}): boolean {
  return speakParagraphs(id, speakableText(markdown).flatMap(pieces), options);
}

/** Says a line of plain text under `id`; `force` uses the voice whatever the line's language (a voice's sample). */
export function speakText(id: string, text: string, options: { rate?: number; voice?: ChosenVoice | null; force?: boolean } = {}): boolean {
  return speakParagraphs(id, [text], options);
}

function speakParagraphs(id: string, paragraphs: string[], options: { rate?: number; voice?: ChosenVoice | null; force?: boolean }): boolean {
  const voice = options.voice === undefined ? devicePrefs().voice : options.voice;
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
    const own = voice && (options.force || voiceFits(voice.language, text)) ? voice : null;
    Speech.speak(text, {
      rate: options.rate ?? 1,
      language: own ? own.language : speechLanguage(text),
      voice: own?.identifier,
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
