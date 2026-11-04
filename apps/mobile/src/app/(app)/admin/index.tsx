import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EvaluationsTab } from '@/features/admin/EvaluationsTab';
import { FunctionsTab } from '@/features/admin/FunctionsTab';
import { DefaultsTab, GroupsTab } from '@/features/admin/GroupsTabs';
import { UsersTab } from '@/features/admin/UsersTab';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { useCapabilities } from '@/lib/server';
import { fonts, usePalette } from '@/theme';

type Tab = 'users' | 'groups' | 'defaults' | 'evaluations' | 'functions';
const TABS: { key: Tab; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'groups', label: 'Groups' },
  { key: 'defaults', label: 'Default Permissions' },
  { key: 'evaluations', label: 'Evaluations' },
];

/**
 * Open WebUI's Admin Panel, for admins: users (approve, add, change, delete), groups and their
 * members, what everyone may do, evaluations, and functions (when plugins are on). Server
 * Settings opens the settings' Admin tab.
 */
export default function AdminPanel() {
  const palette = usePalette();
  const capabilities = useCapabilities();
  const [tab, setTab] = useState<Tab>('users');
  // Functions only where the server has plugins on, as on the web.
  const shownTabs = capabilities?.feature('functions') ? [...TABS, { key: 'functions' as const, label: 'Functions' }] : TABS;
  const tabs = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
      {shownTabs.map((item) => {
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
          { key: 'settings', label: 'Server Settings', icon: 'cog-6-tooth', onPress: () => router.push({ pathname: '/settings', params: { tab: 'admin' } }) },
        ]}
      />
      {!capabilities?.isAdmin ? (
        <Text style={[styles.note, { color: palette.textMuted }]}>Only this server’s admins can open the Admin Panel.</Text>
      ) : tab === 'users' ? (
        <UsersTab tabs={tabs} />
      ) : tab === 'groups' ? (
        <GroupsTab tabs={tabs} />
      ) : tab === 'evaluations' ? (
        <EvaluationsTab tabs={tabs} />
      ) : tab === 'functions' && capabilities.feature('functions') ? (
        <FunctionsTab tabs={tabs} />
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
