import { Redirect, Stack, usePathname } from 'expo-router';
import { useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { Drawer } from 'react-native-drawer-layout';
import { LiveProvider } from '@/features/live/LiveProvider';
import { PushSetup } from '@/features/notifications/PushSetup';
import { Sidebar } from '@/features/sidebar/Sidebar';
import { SidebarContext } from '@/features/sidebar/SidebarContext';
import { useSession } from '@/session/SessionProvider';
import { SIDEBAR_WIDTH, usePalette } from '@/theme';

/** Signed-in area: the web app's phone layout, with the sidebar as an overlay you can swipe open from anywhere. */
export default function AppLayout() {
  const { state } = useSession();
  const palette = usePalette();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const controls = useMemo(() => ({ isOpen: open, open: () => setOpen(true), close: () => setOpen(false) }), [open]);
  const currentChatId = pathname.startsWith('/c/') ? decodeURIComponent(pathname.slice(3)) : null;

  if (state.status === 'loading') return null;
  if (state.status !== 'signed-in') return <Redirect href="/login" />;

  return (
    <LiveProvider currentChatId={currentChatId}>
      <PushSetup />
      <SidebarContext.Provider value={controls}>
        <Drawer
          open={open}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          drawerType="front"
          swipeEdgeWidth={width}
          swipeMinDistance={24}
          keyboardDismissMode="on-drag"
          drawerStyle={{ width: SIDEBAR_WIDTH, backgroundColor: palette.sidebar }}
          overlayStyle={{ backgroundColor: palette.overlay }}
          renderDrawerContent={() => <Sidebar />}>
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
        </Drawer>
      </SidebarContext.Provider>
    </LiveProvider>
  );
}
