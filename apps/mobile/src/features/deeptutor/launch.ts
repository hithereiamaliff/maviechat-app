import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import type { DtState } from '@/session/DeepTutorProvider';
import { loadSpace, type Space } from '@/session/storage';

let lastSpace: Space = 'owui';
let launchDecided = false;

/** Reads the space open when the app last closed. The root layout waits for it, so nothing shows before it's known. */
export async function prepareLaunchSpace(): Promise<void> {
  lastSpace = await loadSpace().catch((): Space => 'owui');
}

/**
 * Where a launch belongs, asked by Open WebUI's layout (the app's first screen): DeepTutor when
 * that was the space open last and its sign-in holds, "pending" while that sign-in loads, else
 * here. Only the launch asks; switching to Open WebUI later stays put, and a launch from a
 * notification goes to its chat.
 */
export function useLaunchTarget(deepTutor: DtState['status']): 'pending' | 'deeptutor' | 'here' {
  const [atLaunch] = useState(() => !launchDecided);
  useEffect(() => {
    launchDecided = true;
  }, []);
  if (!atLaunch || lastSpace !== 'deeptutor' || Notifications.getLastNotificationResponse()) return 'here';
  if (deepTutor === 'loading') return 'pending';
  return deepTutor === 'signed-in' ? 'deeptutor' : 'here';
}
