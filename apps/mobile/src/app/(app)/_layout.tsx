import { Redirect, Stack, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { useLaunchTarget } from '@/features/deeptutor/launch';
import { LiveProvider } from '@/features/live/LiveProvider';
import { PushSetup } from '@/features/notifications/PushSetup';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { SpaceDrawer } from '@/features/sidebar/SpaceDrawer';
import { signedOutRoute } from '@/features/welcome/entry';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { saveSpace } from '@/session/storage';
import { usePalette } from '@/theme';

/** Signed-in area: the web app's phone layout, with the sidebar as an overlay you can swipe open from anywhere. */
export default function AppLayout() {
  const { state } = useSession();
  const palette = usePalette();
  const pathname = usePathname();
  const currentChatId = pathname.startsWith('/c/') ? decodeURIComponent(pathname.slice(3)) : null;
  const deepTutor = useDeepTutor().state.status;
  const launch = useLaunchTarget(deepTutor);
  const showing = launch === 'here' && state.status === 'signed-in';

  // The app reopens in the space you were in, however you got here.
  useEffect(() => {
    if (showing) void saveSpace('owui');
  }, [showing]);

  if (launch === 'pending') return null;
  if (launch === 'deeptutor') return <Redirect href="/learn" />;
  if (state.status === 'loading') return null;
  if (state.status !== 'signed-in') {
    // DeepTutor if it's signed in, else the welcome screen (or this sign-in, when it just expired).
    const route = signedOutRoute(deepTutor, Boolean(state.notice));
    return route ? <Redirect href={route} /> : null;
  }

  return (
    <LiveProvider currentChatId={currentChatId}>
      <PushSetup />
      <SpaceDrawer sidebar={() => <Sidebar />}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'none',
            gestureEnabled: false,
            contentStyle: { backgroundColor: palette.background },
          }}>
          <Stack.Screen name="connection" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal', animation: 'slide_from_bottom', gestureEnabled: true }} />
        </Stack>
      </SpaceDrawer>
    </LiveProvider>
  );
}
