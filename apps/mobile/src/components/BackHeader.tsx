import { router, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from '@/components/IconButton';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { fonts, usePalette } from '@/theme';

/** A pushed screen's top bar: back (to `fallback` when there's nothing to go back to), its title, and its menu. */
export function BackHeader({ title, fallback, menu, menuLabel = 'Options' }: { title: string; fallback: Href; menu?: MenuItem[]; menuLabel?: string }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
      <IconButton icon="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))} />
      <Text style={[styles.title, { color: palette.text }]} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      {menu?.length ? <MenuButton label={menuLabel} items={menu} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
  title: { flex: 1, fontFamily: fonts.medium, fontSize: 16, marginHorizontal: 4 },
});
