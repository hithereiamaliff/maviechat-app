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
  getLdapSettings,
  getOAuthSettings,
  isAtLeast,
  LDAP_SECTIONS,
  OAUTH_SECTIONS,
  oauthLockedWhy,
  saveLdapSettings,
  saveOAuthSettings,
} from '@maviechat/owui-protocol';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { ActionRow, Group, Note, SectionTitle } from '@/features/settings/rows';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, usePalette } from '@/theme';
import { AdminConfigPage, BannersEditor, SettingsEndpointPage } from './AdminConfigPage';
import { AppsPage } from './AppsPage';
import { ConnectionsPage } from './ConnectionsPage';
import { EventWebhooks } from './EventWebhooks';
import { ExternalKnowledgePage } from './ExternalKnowledgePage';
import { InterfaceDefaults } from './InterfaceDefaults';
import { InterfaceText } from './InterfaceText';
import { ModelsPage } from './ModelsPage';

type Page = 'general' | 'authentication' | 'connections' | 'models' | 'interface' | 'subagents' | 'code-execution' | 'web' | 'external-knowledge' | 'apps';

/** The web's admin settings tabs not in the app yet, and why each is better on the web for now. */
const WEB_PAGES: { group: string; pages: { key: string; label: string; why: string }[] }[] = [
  { group: 'Quality', pages: [{ key: 'evaluations', label: 'Arena Models', why: 'The models the arena picks from' }] },
  {
    group: 'Tools',
    pages: [
      { key: 'integrations', label: 'Integrations', why: 'Tool and terminal servers and their sign-ins' },
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
 * Authentication, Connections, Models, Sub-agents, Interface, Web Search, Code Execution and
 * External Knowledge (on the web, a part of Integrations) are here; each saves only what changed.
 * The rest open on the web until their slices land.
 */
export function AdminSettings() {
  const palette = usePalette();
  const { session } = useAuthed();
  const capabilities = useCapabilities();
  const [page, setPage] = useState<Page | null>(null);
  // Apps came with 0.12 (switched on in General).
  const appsOnServer = isAtLeast(capabilities?.version, '0.12.0');
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
              <InterfaceDefaults />
              <InterfaceText />
              <BannersEditor />
              <EventWebhooks />
            </AdminConfigPage>
          ) : page === 'authentication' ? (
            <>
              <AdminConfigPage sections={AUTHENTICATION_SECTIONS} />
              {/* The web's LDAP and single sign-on parts: each its own endpoint, saved on its own. */}
              <SettingsEndpointPage name="ldap" read={getLdapSettings} save={saveLdapSettings} sections={LDAP_SECTIONS} />
              <SettingsEndpointPage name="oauth" read={getOAuthSettings} save={saveOAuthSettings} sections={OAUTH_SECTIONS} lockedWhy={oauthLockedWhy} />
            </>
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
          ) : page === 'external-knowledge' ? (
            <ExternalKnowledgePage />
          ) : page === 'apps' ? (
            <AppsPage />
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
              <ActionRow label="General" hint="Features, this server’s address, everyone’s Interface defaults, the web’s interface text, banners, event webhooks" onPress={() => setPage('general')} />
              <ActionRow label="Authentication" hint="Sign-ups, new accounts, sessions, API keys, LDAP, single sign-on" onPress={() => setPage('authentication')} />
            </Group>
          </View>
          <View style={styles.section}>
            <SectionTitle title="AI" />
            <Group>
              <ActionRow label="Connections" hint="OpenAI-compatible and Ollama servers, their keys and models" onPress={() => setPage('connections')} />
              <ActionRow label="Models" hint="On or off, sharing, settings, defaults for every model, order, import and export" onPress={() => setPage('models')} />
              <ActionRow label="Sub-agents" hint="Helpers models can hand parts of a task to" onPress={() => setPage('subagents')} />
            </Group>
          </View>
          <View style={styles.section}>
            <SectionTitle title="Tools and experience" />
            <Group>
              <ActionRow label="Interface" hint="Titles, tags, follow-ups, searches; long chats; tool approvals" onPress={() => setPage('interface')} />
              <ActionRow label="Web Search" hint="The engine, its key, how pages are read" onPress={() => setPage('web')} />
              <ActionRow label="Code Execution" hint="The Run button and the code interpreter" onPress={() => setPage('code-execution')} />
              <ActionRow label="External Knowledge" hint="Collections in Qdrant, Milvus or pgvector, searched where they live" onPress={() => setPage('external-knowledge')} />
              {appsOnServer ? <ActionRow label="Apps" hint="Outside apps that join channels and answer there (experimental)" onPress={() => setPage('apps')} /> : null}
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
