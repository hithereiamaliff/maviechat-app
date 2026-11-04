import {
  AUTHENTICATION_SECTIONS,
  CHAT_SECTIONS,
  CODE_EXECUTION_SECTIONS,
  GENERAL_SECTIONS,
  getChatConfig,
  getCodeExecutionConfig,
  getSubagentsConfig,
  getTaskConfig,
  getWebConfig,
  saveChatConfig,
  saveCodeExecutionConfig,
  saveSubagentsConfig,
  saveTaskConfig,
  saveWebConfig,
  SUBAGENT_SECTIONS,
  TASK_SECTIONS,
  WEB_SEARCH_SECTIONS,
} from '@maviechat/owui-protocol';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { ActionRow, Group, Note, SectionTitle } from '@/features/settings/rows';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, usePalette } from '@/theme';
import { AdminConfigPage, BannersEditor, SettingsEndpointPage } from './AdminConfigPage';
import { ConnectionsPage } from './ConnectionsPage';
import { ModelsPage } from './ModelsPage';

type Page = 'general' | 'authentication' | 'connections' | 'models' | 'interface' | 'subagents' | 'code-execution' | 'web';

/** The web's admin settings tabs not in the app yet, and why each is better on the web for now. */
const WEB_PAGES: { group: string; pages: { key: string; label: string; why: string }[] }[] = [
  { group: 'Quality', pages: [{ key: 'evaluations', label: 'Arena Models', why: 'The models the arena picks from' }] },
  {
    group: 'Tools',
    pages: [
      { key: 'integrations', label: 'Integrations', why: 'Tool and terminal servers, OAuth, outside knowledge' },
      { key: 'documents', label: 'Documents', why: 'Saving reloads the embedding model on the server' },
      { key: 'pipelines', label: 'Pipelines', why: 'Uploads code to a pipelines server' },
    ],
  },
  {
    group: 'Experience',
    pages: [
      { key: 'audio', label: 'Audio', why: 'Saving can load a speech model on the server' },
      { key: 'images', label: 'Images', why: 'Saving can switch Automatic1111’s model' },
    ],
  },
  { group: 'Data', pages: [{ key: 'db', label: 'Database', why: 'Exports hold every secret and chat' }] },
];

/**
 * The settings modal's Admin tab (admins only): the server's own settings. General,
 * Authentication, Connections, Models, Sub-agents, Interface, Web Search and Code Execution are here; each saves only what changed, after listing it. The
 * rest open on the web until their slices land.
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
          ) : page === 'authentication' ? (
            <AdminConfigPage sections={AUTHENTICATION_SECTIONS}>
              <Note>LDAP and OAuth sign-in are set on the web.</Note>
            </AdminConfigPage>
          ) : page === 'connections' ? (
            <ConnectionsPage />
          ) : page === 'models' ? (
            <ModelsPage />
          ) : page === 'interface' ? (
            <>
              <SettingsEndpointPage name="tasks" read={getTaskConfig} save={saveTaskConfig} sections={TASK_SECTIONS} />
              <SettingsEndpointPage name="chats" read={getChatConfig} save={saveChatConfig} sections={CHAT_SECTIONS} />
            </>
          ) : page === 'web' ? (
            <SettingsEndpointPage name="web" read={getWebConfig} save={saveWebConfig} sections={WEB_SEARCH_SECTIONS}>
              <Note>With hybrid search on (Documents), saving also reloads the server’s reranker.</Note>
            </SettingsEndpointPage>
          ) : page === 'subagents' ? (
            <SettingsEndpointPage name="subagents" read={getSubagentsConfig} save={saveSubagentsConfig} sections={SUBAGENT_SECTIONS} />
          ) : (
            <SettingsEndpointPage name="code-execution" read={getCodeExecutionConfig} save={saveCodeExecutionConfig} sections={CODE_EXECUTION_SECTIONS} />
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
          <View style={styles.section}>
            <SectionTitle title="AI" />
            <Group>
              <ActionRow label="Connections" hint="OpenAI-compatible and Ollama servers, their keys and models" onPress={() => setPage('connections')} />
              <ActionRow label="Models" hint="On or off, hidden, what new chats start with, pinned, who may use them" onPress={() => setPage('models')} />
              <ActionRow label="Sub-agents" hint="Helpers models can hand parts of a task to" onPress={() => setPage('subagents')} />
            </Group>
          </View>
          <View style={styles.section}>
            <SectionTitle title="Tools and experience" />
            <Group>
              <ActionRow label="Interface" hint="Titles, tags, follow-ups, searches; long chats; tool approvals" onPress={() => setPage('interface')} />
              <ActionRow label="Web Search" hint="The engine, its key, how pages are read" onPress={() => setPage('web')} />
              <ActionRow label="Code Execution" hint="The Run button and the code interpreter" onPress={() => setPage('code-execution')} />
            </Group>
          </View>
          {WEB_PAGES.map((group) => (
            <View key={group.group} style={styles.section}>
              <SectionTitle title={group.group} />
              <Group>
                {group.pages.map((item) => (
                  <ActionRow key={item.key} label={item.label} hint={item.why} value="Web" onPress={() => void WebBrowser.openBrowserAsync(`${session.baseUrl}/admin/settings/${item.key}`)} />
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
