import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useToast } from '@/components/Toast';

/** How often coming back to the app looks for an update. */
const CHECK_EVERY_MS = 10 * 60_000;

/**
 * An update downloads in the background and would only start on the next full launch, so a
 * fix seemed to need two. This offers a restart as soon as one is ready. iOS checks only at a
 * full launch, so coming back to the app checks too (at most every ten minutes).
 */
export function UpdatePrompt() {
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const toast = useToast();
  const offered = useRef<string | null>(null);
  const lastCheck = useRef(0);
  const updateId = downloadedUpdate?.updateId ?? null;

  useEffect(() => {
    if (!Updates.isEnabled) return;
    // The launch itself just checked.
    lastCheck.current = Date.now();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || Date.now() - lastCheck.current < CHECK_EVERY_MS) return;
      lastCheck.current = Date.now();
      Updates.checkForUpdateAsync()
        .then((result) => (result.isAvailable ? Updates.fetchUpdateAsync() : null))
        .catch(() => undefined);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isUpdatePending || !updateId || offered.current === updateId) return;
    offered.current = updateId;
    toast('A MavieChat update is ready.', 'info', { label: 'Restart', onPress: () => void Updates.reloadAsync().catch(() => undefined) });
  }, [isUpdatePending, updateId, toast]);

  return null;
}
