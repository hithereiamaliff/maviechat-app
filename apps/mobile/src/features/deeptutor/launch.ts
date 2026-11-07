import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import type { DtState } from '@/session/DeepTutorProvider';
import type { OcState } from '@/session/OpenCodeProvider';
import { loadSpace, type Space } from '@/session/storage';

let lastSpace: Space = 'owui';
let launchDecided = false;

/** Reads the space open when the app last closed. The root layout waits for it, so nothing shows before it's known. */
export async function prepareLaunchSpace(): Promise<void> {
  lastSpace = await loadSpace().catch((): Space => 'owui');
}

/** A launch from a link into a new Open WebUI chat (`maviechat://?q=…`, see `chatLinkFrom`). */
const openedByChatLink = () => /^maviechat:\/\/\/?\?/.test(Linking.getLinkingURL() ?? '');

/**
 * Where a launch belongs, asked by Open WebUI's layout (the app's first screen): the space open
 * last when its sign-in holds, "pending" while that sign-in loads, else here. Only the launch
 * asks; switching to Open WebUI later stays put, and a launch from a notification goes to its
 * chat, as one from a chat link stays here.
 */
export function useLaunchTarget(deepTutor: DtState['status'], openCode: OcState['status'] = 'signed-out'): 'pending' | 'deeptutor' | 'opencode' | 'here' {
  const [atLaunch] = useState(() => !launchDecided);
  useEffect(() => {
    launchDecided = true;
  }, []);
  if (!atLaunch || lastSpace === 'owui' || Notifications.getLastNotificationResponse() || openedByChatLink()) return 'here';
  const status = lastSpace === 'deeptutor' ? deepTutor : openCode;
  if (status === 'loading') return 'pending';
  return status === 'signed-in' ? lastSpace : 'here';
}
