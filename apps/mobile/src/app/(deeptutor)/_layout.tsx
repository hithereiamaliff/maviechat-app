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
    <DtLiveProvider key={state.accountId}>
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
          <Stack.Screen name="learn/books/index" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/books/new" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/books/[id]/index" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/books/[id]/[page]" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/books/chat" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/reading/index" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/reading/[id]" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/reading/read" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/reading/chat" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/partners/index" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/partners/new" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/partners/[id]" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/partners/edit" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/partners/channels" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/personalization" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/personas/index" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/skills/index" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/memory/index" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/memory/sheet" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/mcp/index" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/mcp/store" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/cli-apps" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/agents/index" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/agents/group" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/notes/index" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/notes/[id]" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/notes/review" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/notes/ask" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/admin/index" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/admin/user" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/partners/groups/new" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/partners/groups/[id]" options={{ animation: 'slide_from_right', gestureEnabled: true }} />
          <Stack.Screen name="learn/settings" options={{ presentation: 'modal', animation: 'slide_from_bottom', gestureEnabled: true }} />
        </Stack>
      </SpaceDrawer>
    </DtLiveProvider>
  );
}
