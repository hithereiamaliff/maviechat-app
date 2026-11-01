import type { FeatureToggles, FileItem, QueuedMessage } from '@maviechat/owui-protocol';
import { useSyncExternalStore } from 'react';

/**
 * What's in a chat's input bar: text, attachments, switched-on toggles and tools, and
 * messages queued behind a running reply. Kept per chat while the app runs, as the web
 * keeps each chat's input for the session.
 */
export interface Draft {
  text: string;
  files: FileItem[];
  /** On-device previews of photos, by `itemId`; never sent. */
  previews: Record<string, string>;
  toggles: FeatureToggles;
  toolIds: string[];
  /** The model whose defaults the toggles and tools came from; picking another model applies its own. */
  defaultsFor: string | null;
  queue: QueuedMessage[];
}

/** The new-chat screen's draft. */
export const NEW_CHAT = 'new';

const EMPTY: Draft = { text: '', files: [], previews: {}, toggles: {}, toolIds: [], defaultsFor: null, queue: [] };
const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();

export function getDraft(key: string): Draft {
  return drafts.get(key) ?? EMPTY;
}

export function updateDraft(key: string, change: (draft: Draft) => Draft): void {
  drafts.set(key, change(getDraft(key)));
  for (const listener of listeners) listener();
}

export function patchFile(key: string, itemId: string, item: FileItem): void {
  updateDraft(key, (draft) => ({ ...draft, files: draft.files.map((file) => (file.itemId === itemId ? item : file)) }));
}

export function removeFile(key: string, itemId: string): void {
  updateDraft(key, (draft) => {
    const { [itemId]: _removed, ...previews } = draft.previews;
    return { ...draft, files: draft.files.filter((file) => file.itemId !== itemId), previews };
  });
}

/** The first message created the chat: it keeps the toggles and tools, and the new-chat input starts over. */
export function carryOver(from: string, to: string): void {
  const { toggles, toolIds, defaultsFor } = getDraft(from);
  drafts.delete(from);
  updateDraft(to, (draft) => ({ ...draft, toggles, toolIds, defaultsFor }));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDraft(key: string): Draft {
  return useSyncExternalStore(subscribe, () => getDraft(key));
}

/** Only the text, for screens that react to typing (the new-chat suggestions). */
export function useDraftText(key: string): string {
  return useSyncExternalStore(subscribe, () => getDraft(key).text);
}

/** Only the queue, so a chat screen doesn't re-render on every keystroke. */
export function useQueue(key: string): QueuedMessage[] {
  return useSyncExternalStore(subscribe, () => getDraft(key).queue);
}
