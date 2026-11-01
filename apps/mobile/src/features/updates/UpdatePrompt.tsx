import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { useToast } from '@/components/Toast';

/**
 * An update downloads in the background and would only start on the next full launch, so a
 * fix seemed to need two. This offers a restart as soon as one is ready.
 */
export function UpdatePrompt() {
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const toast = useToast();
  const offered = useRef<string | null>(null);
  const updateId = downloadedUpdate?.updateId ?? null;

  useEffect(() => {
    if (!isUpdatePending || !updateId || offered.current === updateId) return;
    offered.current = updateId;
    toast('A MavieChat update is ready.', 'info', { label: 'Restart', onPress: () => void Updates.reloadAsync().catch(() => undefined) });
  }, [isUpdatePending, updateId, toast]);

  return null;
}
