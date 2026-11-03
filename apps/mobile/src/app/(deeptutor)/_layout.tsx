import { Redirect, Stack, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { DtLiveProvider } from '@/features/deeptutor/chat/DtLiveProvider';
import { DtSidebar } from '@/features/deeptutor/DtSidebar';
import { PushSetup } from '@/features/notifications/PushSetup';
import { SpaceDrawer } from '@/features/sidebar/SpaceDrawer';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { saveSpace } from '@/session/storage';
import { usePalette } from '@/theme';

/**
 * The DeepTutor space, laid out like Open WebUI's: its own sidebar you can swipe open from
 * anywhere, its screens, cached data and live connection, behind its own sign-in.
 */
export default function DeepTutorLayout() {
  const { state } = useDeepTutor();
  const palette = usePalette();
  const pathname = usePathname();
  const signedIn = state.status === 'signed-in';
  // The app reopens in the space you were in, however you got here.
  useEffect(() => {
    if (signedIn) void saveSpace('deeptutor');
  }, [signedIn]);
  if (state.status === 'loading') return null;
  if (state.status !== 'signed-in') return <Redirect href="/deeptutor-login" />;
  return (
    <DtLiveProvider>
      <PushSetup />
      {/* DeepTutor's web pages keep their own swipes (back, scrolling sideways); the sidebar button still opens the sidebar. */}
      <SpaceDrawer sidebar={() => <DtSidebar />} swipeEnabled={pathname !== '/learn/web'}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'none',
            gestureEnabled: false,
            contentStyle: { backgroundColor: palette.background },
          }}>
          <Stack.Screen name="learn/connection" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/notebook/[id]" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/knowledge/[name]" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/mastery/index" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/mastery/[id]" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/mastery/new" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/mastery/chat" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/settings" options={{ presentation: 'modal', animation: 'slide_from_bottom', gestureEnabled: true }} />
        </Stack>
      </SpaceDrawer>
    </DtLiveProvider>
  );
}
