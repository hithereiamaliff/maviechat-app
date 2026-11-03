import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from '@/components/IconButton';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { fonts, usePalette } from '@/theme';
import { useSidebar } from './SidebarContext';

/**
 * The bar over each space's screens, the same in Open WebUI and DeepTutor (the web apps' phone
 * navbar): the sidebar button and the switch to the other space, the title, extra buttons,
 * new chat, and a menu.
 */
export function SpaceBar({
  title,
  switchButton,
  onNewChat,
  accessory,
  menu,
  menuLabel = 'Chat options',
}: {
  title?: string;
  switchButton: ReactNode;
  onNewChat: () => void;
  accessory?: ReactNode;
  menu?: MenuItem[];
  menuLabel?: string;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const sidebar = useSidebar();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 4, backgroundColor: palette.background }]}>
      <IconButton icon="bars-3" label="Open sidebar" onPress={sidebar.open} />
      {switchButton}
      <Text style={[styles.title, { color: palette.text }]} numberOfLines={1} accessibilityRole="header">
        {title ?? ''}
      </Text>
      {accessory}
      <IconButton icon="pencil-square" label="New chat" onPress={onNewChat} />
      {menu && menu.length > 0 ? <MenuButton items={menu} label={menuLabel} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  title: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 16,
    marginHorizontal: 4,
  },
});
