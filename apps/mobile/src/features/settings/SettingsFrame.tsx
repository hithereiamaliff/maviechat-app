import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { fonts, radius, usePalette } from '@/theme';

export interface SettingsTab<K extends string> {
  key: K;
  label: string;
  icon: IconName;
}

/** The settings modal in its phone layout, the same in both spaces: Settings and Done, a strip of tabs, then the tab. */
export function SettingsFrame<K extends string>({ tabs, tab, onTab, children }: { tabs: SettingsTab<K>[]; tab: K; onTab: (tab: K) => void; children: ReactNode }) {
  const palette = usePalette();
  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Settings
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10}>
          <Text style={[styles.done, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {tabs.map((item) => {
            const selected = item.key === tab;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => onTab(item.key)}
                style={[styles.tab, selected && { backgroundColor: palette.surfaceStrong }]}>
                <Icon name={item.icon} size={16} color={selected ? palette.text : palette.textMuted} />
                <Text style={[styles.tabLabel, { color: selected ? palette.text : palette.textMuted }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 18 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  tabs: { gap: 6, paddingHorizontal: 12, paddingVertical: 6 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: radius.lg },
  tabLabel: { fontFamily: fonts.medium, fontSize: 14 },
  body: { flex: 1 },
});
