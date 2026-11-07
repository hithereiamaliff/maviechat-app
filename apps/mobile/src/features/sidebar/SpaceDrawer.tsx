import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import { Drawer } from 'react-native-drawer-layout';
import type { GestureType, LegacyPanGesture } from 'react-native-gesture-handler';
import { SidebarSwipeContext } from '@/components/SideScroll';
import { SIDEBAR_WIDTH, usePalette } from '@/theme';
import { SidebarContext } from './SidebarContext';

/**
 * A space's sidebar as an overlay you can swipe open from anywhere, as in the web apps' phone
 * layout. Open WebUI, DeepTutor and OpenCode each wrap their screens in one, so all work the same
 * way. Sideways-scrolling content wins the swipe (`SideScroll`), as on the web.
 */
export function SpaceDrawer({ sidebar, swipeEnabled = true, children }: { sidebar: () => ReactNode; swipeEnabled?: boolean; children: ReactNode }) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const controls = useMemo(() => ({ isOpen: open, open: () => setOpen(true), close: () => setOpen(false) }), [open]);
  // The swipe, for the sideways scrollers that it waits for. The drawer's types name gesture
  // handler 3's new gesture type, but it hands over a classic one (`Gesture.Pan()`).
  const swipe = useRef<GestureType | undefined>(undefined);

  return (
    <SidebarContext.Provider value={controls}>
      <SidebarSwipeContext value={swipe}>
        <Drawer
          open={open}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          drawerType="front"
          swipeEnabled={swipeEnabled}
          swipeEdgeWidth={width}
          swipeMinDistance={24}
          configureGestureHandler={(gesture) => (gesture as unknown as LegacyPanGesture).withRef(swipe) as unknown as typeof gesture}
          keyboardDismissMode="on-drag"
          drawerStyle={{ width: SIDEBAR_WIDTH, backgroundColor: palette.sidebar }}
          overlayStyle={{ backgroundColor: palette.overlay }}
          renderDrawerContent={sidebar}>
          {children}
        </Drawer>
      </SidebarSwipeContext>
    </SidebarContext.Provider>
  );
}
