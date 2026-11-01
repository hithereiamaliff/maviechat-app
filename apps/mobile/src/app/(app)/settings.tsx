import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { AboutSettings } from '@/features/settings/AboutSettings';
import { ArchivedChats } from '@/features/settings/ArchivedChats';
import { GeneralSettings } from '@/features/settings/GeneralSettings';
import { fonts, radius, usePalette } from '@/theme';

type Tab = 'general' | 'archived' | 'about';

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'general', label: 'General', icon: 'cog-6-tooth' },
  { key: 'archived', label: 'Archived Chats', icon: 'archive-box' },
  { key: 'about', label: 'About', icon: 'information-circle' },
];

/** The web's settings modal in its phone layout: a strip of tabs on top. More tabs arrive in M2. */
export default function SettingsScreen() {
  const palette = usePalette();
  const [tab, setTab] = useState<Tab>('general');

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
          {TABS.map((item) => {
            const selected = item.key === tab;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setTab(item.key)}
                style={[styles.tab, selected && { backgroundColor: palette.surfaceStrong }]}>
                <Icon name={item.icon} size={16} color={selected ? palette.text : palette.textMuted} />
                <Text style={[styles.tabLabel, { color: selected ? palette.text : palette.textMuted }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <View style={styles.body}>{tab === 'general' ? <GeneralSettings /> : tab === 'archived' ? <ArchivedChats /> : <AboutSettings />}</View>
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
