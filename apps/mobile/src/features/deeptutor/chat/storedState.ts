import { useCallback, useSyncExternalStore } from 'react';

/**
 * State kept by key outside the component, for while the app runs. The message list recycles
 * rows as you scroll, so a quiz or question card keeps its answers here, not in the row.
 */
const values = new Map<string, unknown>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `initial` must be a constant (it's returned as is until something is stored). */
export function useStoredState<T>(key: string, initial: T): [T, (value: T) => void] {
  const value = useSyncExternalStore(subscribe, () => (values.has(key) ? (values.get(key) as T) : initial));
  const set = useCallback(
    (next: T) => {
      values.set(key, next);
      for (const listener of listeners) listener();
    },
    [key],
  );
  return [value, set];
}

/** Sets a stored value from outside a component (clearing a sent draft, say). */
export function setStoredState<T>(key: string, value: T): void {
  values.set(key, value);
  for (const listener of listeners) listener();
}
