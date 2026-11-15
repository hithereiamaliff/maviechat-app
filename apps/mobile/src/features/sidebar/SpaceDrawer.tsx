import { useRef, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Drawer } from 'react-native-drawer-layout';
import type { GestureType, LegacyPanGesture } from 'react-native-gesture-handler';
import { SidebarSwipeContext } from '@/components/SideScroll';
import { useKeyCommand } from '@/lib/hardwareKeyboard';
import { CONTENT_MAX_WIDTH, isWideWidth } from '@/lib/layout';
import { sidebarMode } from '@/lib/layoutRules';
import { SIDEBAR_WIDTH, usePalette } from '@/theme';
import { SidebarContext, type SidebarControls } from './SidebarContext';

/**
 * A space's sidebar. On a phone (or any narrow window) it's an overlay you can swipe open from
 * anywhere, as in the web apps' phone layout. On a wide window (an iPad, a big Android screen) it
 * sits beside the content, as on a computer, until its close button hides it; the content then keeps
 * the web's chat width in the middle, unless `fullWidth` (Open WebUI's Widescreen). Open WebUI,
 * DeepTutor and OpenCode each wrap their screens in one, so all work the same way. Sideways-scrolling
 * content wins the swipe (`SideScroll`), as on the web.
 */
export function SpaceDrawer({ sidebar, swipeEnabled = true, fullWidth = false, children }: { sidebar: () => ReactNode; swipeEnabled?: boolean; fullWidth?: boolean; children: ReactNode }) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const wide = isWideWidth(width);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const { docked, visible } = sidebarMode(wide, hidden, open);
  // The React Compiler keeps this the same object until one of these values changes.
  const controls: SidebarControls = {
    isOpen: visible,
    docked,
    open: () => (wide ? setHidden(false) : setOpen(true)),
    close: () => setOpen(false),
    hide: () => {
      setOpen(false);
      if (wide) setHidden(true);
    },
  };
  // A keyboard on an iPad: ⌘⇧S shows or hides the sidebar, as on the web.
  useKeyCommand('sidebar', () => (visible ? controls.hide() : controls.open()));
  // The swipe, for the sideways scrollers that it waits for. The drawer's types name gesture
  // handler 3's new gesture type, but it hands over a classic one (`Gesture.Pan()`).
  const swipe = useRef<GestureType | undefined>(undefined);

  return (
    <SidebarContext.Provider value={controls}>
      <SidebarSwipeContext value={swipe}>
        <Drawer
          open={visible}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          drawerType={docked ? 'permanent' : 'front'}
          swipeEnabled={swipeEnabled && !docked}
          swipeEdgeWidth={width}
          swipeMinDistance={24}
          configureGestureHandler={(gesture) => (gesture as unknown as LegacyPanGesture).withRef(swipe) as unknown as typeof gesture}
          keyboardDismissMode="on-drag"
          drawerStyle={[
            { width: SIDEBAR_WIDTH, backgroundColor: palette.sidebar },
            docked && { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: palette.border },
          ]}
          overlayStyle={{ backgroundColor: palette.overlay }}
          renderDrawerContent={sidebar}>
          {/* Always the same two views, so turning the iPad or resizing its window never restarts the screens. */}
          <View style={[styles.content, { backgroundColor: palette.background }]}>
            <View style={[styles.column, wide && !fullWidth && styles.capped]}>{children}</View>
          </View>
        </Drawer>
      </SidebarSwipeContext>
    </SidebarContext.Provider>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, alignItems: 'center' },
  column: { flex: 1, width: '100%' },
  capped: { maxWidth: CONTENT_MAX_WIDTH },
});
