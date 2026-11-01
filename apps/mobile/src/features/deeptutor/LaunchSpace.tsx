import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { loadSpace } from '@/session/storage';

/** At launch, returns to DeepTutor if that was the space open last (and its sign-in still holds). */
export function LaunchSpace() {
  const { state } = useDeepTutor();
  const ready = Boolean(useRootNavigationState()?.key);
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current || !ready || state.status === 'loading') return;
    decided.current = true;
    // Opened from a notification: NotificationRoot takes you to its chat instead.
    if (state.status !== 'signed-in' || Notifications.getLastNotificationResponse()) return;
    void loadSpace().then((space) => {
      if (space === 'deeptutor') router.replace('/learn');
    });
  }, [ready, state.status]);

  return null;
}
