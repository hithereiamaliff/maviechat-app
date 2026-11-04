import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { PushSetup } from '@/features/notifications/PushSetup';
import { OcLiveProvider } from '@/features/opencode/live';
import { OcSidebar } from '@/features/opencode/OcSidebar';
import { OcProjectProvider } from '@/features/opencode/project';
import { SpaceDrawer } from '@/features/sidebar/SpaceDrawer';
import { useOpenCode } from '@/session/OpenCodeProvider';
import { saveSpace } from '@/session/storage';
import { usePalette } from '@/theme';

/** The OpenCode space: a paired machine's sessions, with the same sidebar overlay as the others. */
export default function OpenCodeLayout() {
  const { state } = useOpenCode();
  const palette = usePalette();
  const signedIn = state.status === 'signed-in';

  // The app reopens in the space you were in.
  useEffect(() => {
    if (signedIn) void saveSpace('opencode');
  }, [signedIn]);

  if (state.status === 'loading') return null;
  if (state.status !== 'signed-in') return <Redirect href="/pair" />;
  return (
    // Keyed by the account in use: switching machines starts its streams and screens afresh.
    <OcLiveProvider key={state.accountId}>
      <OcProjectProvider>
        <PushSetup />
        <SpaceDrawer sidebar={() => <OcSidebar />}>
          <Stack screenOptions={{ headerShown: false, animation: 'none', gestureEnabled: false, contentStyle: { backgroundColor: palette.background } }} />
        </SpaceDrawer>
      </OcProjectProvider>
    </OcLiveProvider>
  );
}
