import { useMemo, useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';
import { Drawer } from 'react-native-drawer-layout';
import { SIDEBAR_WIDTH, usePalette } from '@/theme';
import { SidebarContext } from './SidebarContext';

/**
 * A space's sidebar as an overlay you can swipe open from anywhere, as in the web apps' phone
 * layout. Open WebUI and DeepTutor each wrap their screens in one, so both work the same way.
 */
export function SpaceDrawer({ sidebar, swipeEnabled = true, children }: { sidebar: () => ReactNode; swipeEnabled?: boolean; children: ReactNode }) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const controls = useMemo(() => ({ isOpen: open, open: () => setOpen(true), close: () => setOpen(false) }), [open]);

  return (
    <SidebarContext.Provider value={controls}>
      <Drawer
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        drawerType="front"
        swipeEnabled={swipeEnabled}
        swipeEdgeWidth={width}
        swipeMinDistance={24}
        keyboardDismissMode="on-drag"
        drawerStyle={{ width: SIDEBAR_WIDTH, backgroundColor: palette.sidebar }}
        overlayStyle={{ backgroundColor: palette.overlay }}
        renderDrawerContent={sidebar}>
        {children}
      </Drawer>
    </SidebarContext.Provider>
  );
}
