import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DefaultsTab, GroupsTab } from '@/features/admin/GroupsTabs';
import { UsersTab } from '@/features/admin/UsersTab';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, usePalette } from '@/theme';

type Tab = 'users' | 'groups' | 'defaults';
const TABS: { key: Tab; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'groups', label: 'Groups' },
  { key: 'defaults', label: 'Default Permissions' },
];

/**
 * Open WebUI's Admin Panel, for admins: users (approve, add, change, delete), groups and their
 * members, and what everyone may do. Server settings, evaluations and functions open on the web
 * until their slices land.
 */
export default function AdminPanel() {
  const palette = usePalette();
  const { session } = useAuthed();
  const capabilities = useCapabilities();
  const [tab, setTab] = useState<Tab>('users');
  const openWeb = (path: string) => void WebBrowser.openBrowserAsync(`${session.baseUrl}${path}`);
  const tabs = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
      {TABS.map((item) => {
        const on = item.key === tab;
        return (
          <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setTab(item.key)} style={[styles.tab, on && { borderBottomColor: palette.text }]}>
            <Text style={[styles.tabText, { color: on ? palette.text : palette.textMuted }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ChatHeader
        title="Admin Panel"
        menu={[
          { key: 'settings', label: 'Server Settings (Web)', icon: 'cog-6-tooth', onPress: () => openWeb('/admin/settings') },
          { key: 'evaluations', label: 'Evaluations (Web)', icon: 'chart-bar', onPress: () => openWeb('/admin/evaluations') },
          ...(capabilities?.feature('plugins') ? [{ key: 'functions', label: 'Functions (Web)', icon: 'bolt' as const, onPress: () => openWeb('/admin/functions') }] : []),
        ]}
      />
      {!capabilities?.isAdmin ? (
        <Text style={[styles.note, { color: palette.textMuted }]}>Only this server’s admins can open the Admin Panel.</Text>
      ) : tab === 'users' ? (
        <UsersTab tabs={tabs} />
      ) : tab === 'groups' ? (
        <GroupsTab tabs={tabs} />
      ) : (
        <DefaultsTab tabs={tabs} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tabs: { gap: 4 },
  tab: { paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontFamily: fonts.medium, fontSize: 14 },
  note: { padding: 16, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
