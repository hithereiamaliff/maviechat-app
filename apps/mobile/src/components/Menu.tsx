import * as Haptics from 'expo-haptics';
import { useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View, type HostInstance } from 'react-native';
import { fonts, radius, usePalette } from '@/theme';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';

export interface MenuItem {
  key: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  onPress: () => void;
}

interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MENU_WIDTH = 224;
const ROW_HEIGHT = 44;

function useAnchoredMenu(items: MenuItem[]) {
  const ref = useRef<HostInstance>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [visible, setVisible] = useState(false);

  const open = () => {
    ref.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setVisible(true);
      void Haptics.selectionAsync();
    });
  };

  const menu = <PopoverMenu anchor={anchor} visible={visible} items={items} onClose={() => setVisible(false)} />;
  return { ref, open, menu };
}

/** An icon button that opens an anchored popover menu, like the web app's dropdowns. */
export function MenuButton({
  items,
  label = 'More',
  icon = 'ellipsis-horizontal',
  size = 20,
  color,
}: {
  items: MenuItem[];
  label?: string;
  icon?: IconName;
  size?: number;
  color?: string;
}) {
  const { ref, open, menu } = useAnchoredMenu(items);
  return (
    <>
      <IconButton ref={ref} icon={icon} label={label} onPress={open} size={size} color={color} />
      {menu}
    </>
  );
}

/** Any content that opens the menu when tapped (e.g. the user row in the sidebar). */
export function MenuTrigger({ items, label, children }: { items: MenuItem[]; label: string; children: ReactNode }) {
  const palette = usePalette();
  const { ref, open, menu } = useAnchoredMenu(items);
  return (
    <>
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={open}
        style={({ pressed }) => [styles.trigger, pressed && { backgroundColor: palette.sidebarActive }]}>
        {children}
      </Pressable>
      {menu}
    </>
  );
}

function PopoverMenu({
  anchor,
  visible,
  items,
  onClose,
}: {
  anchor: Anchor | null;
  visible: boolean;
  items: MenuItem[];
  onClose: () => void;
}) {
  const palette = usePalette();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  // An action that presents an alert must wait until the menu has closed, or iOS refuses to show it.
  const pending = useRef<(() => void) | null>(null);

  if (!anchor) return null;
  const menuHeight = items.length * ROW_HEIGHT + 12;
  const left = Math.min(Math.max(8, anchor.x + anchor.width - MENU_WIDTH), screenWidth - MENU_WIDTH - 8);
  const below = anchor.y + anchor.height + 6;
  const top = below + menuHeight > screenHeight - 24 ? Math.max(48, anchor.y - menuHeight - 6) : below;

  const runPending = () => {
    const action = pending.current;
    pending.current = null;
    action?.();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} onDismiss={runPending}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      <View
        style={[
          styles.menu,
          { left, top, backgroundColor: palette.menu, borderColor: palette.border, shadowColor: '#000' },
        ]}>
        {items.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="menuitem"
            onPress={() => {
              pending.current = item.onPress;
              onClose();
            }}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.surfaceStrong }]}>
            <Icon name={item.icon} size={18} color={item.destructive ? palette.danger : palette.text} />
            <Text style={[styles.label, { color: item.destructive ? palette.danger : palette.text }]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  trigger: {
    borderRadius: radius.md,
  },
  menu: {
    position: 'absolute',
    width: MENU_WIDTH,
    paddingVertical: 6,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    marginHorizontal: 6,
    borderRadius: radius.md,
  },
  label: {
    fontFamily: fonts.regular,
    fontSize: 15,
  },
});
