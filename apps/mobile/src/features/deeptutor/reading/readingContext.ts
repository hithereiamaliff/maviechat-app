import { useSyncExternalStore } from 'react';

/** Where you are in a collection, so its chats can tell the tutor (the reader and the chat are separate screens). */
export interface ReadingPlace {
  materialId: string;
  revision: number;
  locator: number;
  /** A video's position, when known. */
  timeSeconds?: number;
  /** A passage you chose to ask about: sent with the next message, then cleared. */
  selection?: string;
  /** The chat you used last in this collection (passage actions carry on there). */
  chatId?: string;
}

const places = new Map<string, ReadingPlace>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

export const readingPlaces = {
  get: (collectionId: string): ReadingPlace | undefined => places.get(collectionId),
  /** Merges a change into the collection's place (a new material starts with no selection). */
  update(collectionId: string, change: Partial<ReadingPlace> & { materialId?: string }) {
    const before = places.get(collectionId);
    const switched = change.materialId !== undefined && before?.materialId !== change.materialId;
    places.set(collectionId, { materialId: '', revision: 1, locator: 1, ...(switched ? { chatId: before?.chatId } : before), ...change });
    emit();
  },
  /** The passage to ask about next, taken (so it goes with one message only). */
  takeSelection(collectionId: string): string | undefined {
    const place = places.get(collectionId);
    if (!place?.selection) return undefined;
    places.set(collectionId, { ...place, selection: undefined });
    emit();
    return place.selection;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useReadingPlace(collectionId: string): ReadingPlace | undefined {
  return useSyncExternalStore(readingPlaces.subscribe, () => (collectionId ? places.get(collectionId) : undefined));
}
