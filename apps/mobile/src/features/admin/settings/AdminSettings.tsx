import { AUTHENTICATION_SECTIONS, GENERAL_SECTIONS } from '@maviechat/owui-protocol';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { ActionRow, Group, Note, SectionTitle } from '@/features/settings/rows';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, usePalette } from '@/theme';
import { AdminConfigPage, BannersEditor } from './AdminConfigPage';

type Page = 'general' | 'authentication';

/** The web's admin settings tabs, in its groups; those not in the app yet open on the web, signed in. */
const WEB_PAGES: { group: string; pages: { key: string; label: string }[] }[] = [
  { group: 'AI', pages: [{ key: 'connections', label: 'Connections' }, { key: 'models', label: 'Models' }] },
  { group: 'Quality', pages: [{ key: 'evaluations', label: 'Evaluations' }] },
  {
    group: 'Tools',
    pages: [
      { key: 'integrations', label: 'Integrations' },
      { key: 'documents', label: 'Documents' },
      { key: 'web', label: 'Web Search' },
      { key: 'code-execution', label: 'Code Execution' },
      { key: 'pipelines', label: 'Pipelines' },
    ],
  },
  {
    group: 'Experience',
    pages: [
      { key: 'interface', label: 'Interface' },
      { key: 'audio', label: 'Audio' },
      { key: 'images', label: 'Images' },
    ],
  },
  { group: 'Data', pages: [{ key: 'db', label: 'Database' }] },
];

/**
 * The settings modal's Admin tab (admins only): the server's own settings. General and
 * Authentication are here; each saves only what changed, after listing it. The rest open on the
 * web until their slices land.
 */
export function AdminSettings() {
  const palette = usePalette();
  const { session } = useAuthed();
  const capabilities = useCapabilities();
  const [page, setPage] = useState<Page | null>(null);
  if (!capabilities?.isAdmin) return <Text style={[styles.empty, { color: palette.textMuted }]}>Only admins change the server’s settings.</Text>;
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {page ? (
        <>
          <Pressable accessibilityRole="button" onPress={() => setPage(null)} style={styles.back} hitSlop={8}>
            <Icon name="chevron-left" size={16} color={palette.link} />
            <Text style={[styles.backText, { color: palette.link }]}>All admin settings</Text>
          </Pressable>
          {page === 'general' ? (
            <AdminConfigPage sections={GENERAL_SECTIONS}>
              <BannersEditor />
              <Note>Webhooks, and the settings new users start with, are on the web for now.</Note>
            </AdminConfigPage>
          ) : (
            <AdminConfigPage sections={AUTHENTICATION_SECTIONS}>
              <Note>LDAP and OAuth sign-in are set on the web.</Note>
            </AdminConfigPage>
          )}
        </>
      ) : (
        <>
          <Note>This server’s own settings, for everyone on it.</Note>
          <View style={styles.section}>
            <SectionTitle title="System" />
            <Group>
              <ActionRow label="General" hint="Features, banners, this server’s address" onPress={() => setPage('general')} />
              <ActionRow label="Authentication" hint="Sign-ups, new accounts, sessions, API keys" onPress={() => setPage('authentication')} />
            </Group>
          </View>
          {WEB_PAGES.map((group) => (
            <View key={group.group} style={styles.section}>
              <SectionTitle title={group.group} />
              <Group>
                {group.pages.map((item) => (
                  <ActionRow key={item.key} label={item.label} value="Web" onPress={() => void WebBrowser.openBrowserAsync(`${session.baseUrl}/admin/settings/${item.key}`)} />
                ))}
              </Group>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  section: { gap: 6 },
  empty: { padding: 24, textAlign: 'center', fontFamily: fonts.regular, fontSize: 14 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  backText: { fontFamily: fonts.medium, fontSize: 15 },
});
