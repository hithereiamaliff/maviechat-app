import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from '@/components/IconButton';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useSidebar } from '@/features/sidebar/SidebarContext';
import { fonts, usePalette } from '@/theme';

/** Phone layout of the web app's navbar: sidebar button, title, extra buttons, new chat, chat menu. */
export function ChatHeader({ title, menu, accessory }: { title?: string; menu?: MenuItem[]; accessory?: ReactNode }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const sidebar = useSidebar();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 4, backgroundColor: palette.background }]}>
      <IconButton icon="bars-3" label="Open sidebar" onPress={sidebar.open} />
      <Text style={[styles.title, { color: palette.text }]} numberOfLines={1} accessibilityRole="header">
        {title ?? ''}
      </Text>
      {accessory}
      <IconButton icon="pencil-square" label="New chat" onPress={() => router.replace('/')} />
      {menu && menu.length > 0 ? <MenuButton items={menu} label="Chat options" /> : null}
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
