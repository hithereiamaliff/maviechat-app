import { disconnectAgent, groupImportedChats, type DtAgentConnection } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useAgentConnections, useImportedChats, usePersonalizationRefresh } from '@/features/deeptutor/personalization/queries';
import { useChatGptImport } from '@/features/deeptutor/personalization/useChatGptImport';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const KINDS: Record<string, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  grok: 'Grok',
  antigravity: 'Antigravity',
  kimi: 'Kimi',
  opencode: 'opencode',
  mimo: 'MiMo Code',
  hermes: 'Hermes',
  hermes_remote: 'Hermes (remote)',
  openclaw: 'OpenClaw',
  deepseek_harness: 'DeepSeek Harness',
};

const openWebPage = () => router.push({ pathname: '/learn/web', params: { path: '/agents', title: 'My Agents' } });

/**
 * My Agents, as DeepTutor's page has it: conversations imported from elsewhere (ChatGPT's export
 * here; Claude Code and Codex folders on the web page), and the agent programs on the server a
 * chat can consult. Connecting one stays on DeepTutor's page: finding which agents the server has
 * runs each of them there.
 */
export default function MyAgents() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const agents = useAgentConnections();
  const imported = useImportedChats();
  const refresh = usePersonalizationRefresh();
  const { choose, progress } = useChatGptImport(refresh);
  const groups = groupImportedChats(imported.data ?? []);

  const disconnect = (agent: DtAgentConnection) =>
    Alert.alert(`Disconnect ${agent.name}?`, 'Chats can’t consult it any more. The agent program itself stays as it is.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () =>
          void disconnectAgent(client, agent.name).then(
            () => {
              refresh();
              toast(`${agent.name} disconnected`);
            },
            (error: unknown) => toast(`Couldn’t disconnect it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="My Agents" menu={[{ key: 'web', label: 'Open on the Web', icon: 'globe-alt', onPress: openWebPage }]} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        <Text style={[styles.section, { color: palette.textMuted }]}>Imported conversations</Text>
        <Text style={[styles.note, { color: palette.textMuted }]}>Chats from elsewhere, kept apart from your chat history: open and carry them on, or refer to them from any chat (Earlier Chat). Claude Code and Codex folders are imported on DeepTutor’s web page.</Text>
        <Button label={progress ? `Importing ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}…` : 'Import from ChatGPT'} loading={progress !== null} variant="secondary" onPress={() => void choose()} />
        {imported.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {imported.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load them: ${describeError(imported.error)}`}</Text> : null}
        {imported.data && !groups.length ? <Text style={[styles.empty, { color: palette.textFaint }]}>None yet.</Text> : null}
        {groups.length ? (
          <View style={[styles.group, { borderColor: palette.border }]}>
            {groups.map((group, index) => (
              <Pressable
                key={group.key}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/learn/agents/group', params: { key: group.key } })}
                style={({ pressed }) => [styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                <Icon name="chat-bubble-left-right" size={16} color={palette.textMuted} />
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                  {group.label}
                </Text>
                <Text style={[styles.count, { color: palette.textMuted }]}>{group.chats.length.toLocaleString()}</Text>
                <Icon name="chevron-right" size={14} color={palette.textFaint} />
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text style={[styles.section, { color: palette.textMuted }]}>Connected agents</Text>
        <Text style={[styles.note, { color: palette.textMuted }]}>Agent programs on the server a chat can consult. Connecting one is done on DeepTutor’s page: finding which agents the server has runs each of them there.</Text>
        {agents.data === null ? <Text style={[styles.note, { color: palette.textFaint }]}>Your server has its knowledge features off, so no agent can be connected.</Text> : null}
        {agents.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {agents.data && !agents.data.length ? <Text style={[styles.empty, { color: palette.textFaint }]}>None connected.</Text> : null}
        {agents.data?.map((agent) => (
          <View key={agent.name} style={[styles.card, { borderColor: palette.border }]}>
            <Icon name="cpu-chip" size={18} color={palette.textMuted} />
            <View style={styles.text}>
              <Text style={[styles.name, { color: palette.text }]}>{agent.name}</Text>
              <Text style={[styles.detail, { color: palette.textMuted }]} numberOfLines={1}>
                {[KINDS[agent.kind] ?? agent.kind, agent.folder].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => disconnect(agent)} hitSlop={8}>
              <Text style={[styles.link, { color: palette.danger }]}>Disconnect</Text>
            </Pressable>
          </View>
        ))}
        <Button label="Connect on DeepTutor’s Page" variant="secondary" onPress={openWebPage} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  section: { fontFamily: fonts.semibold, fontSize: 15, marginTop: 8 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  empty: { fontFamily: fonts.regular, fontSize: 13, marginLeft: 4 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  name: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  count: { fontFamily: fonts.regular, fontSize: 13 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  text: { flex: 1, gap: 2 },
  detail: { fontFamily: fonts.regular, fontSize: 12 },
  link: { fontFamily: fonts.medium, fontSize: 14 },
});
