import { deleteMcpServer, type DtMcpServer } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { McpStatus, useMcpState, useMcpStateSetter } from '@/features/deeptutor/services/mcpBits';
import { McpServerForm } from '@/features/deeptutor/services/McpServerForm';
import { McpServerSheet, type McpSheetAfter } from '@/features/deeptutor/services/McpServerSheet';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const openWebPage = () => router.push({ pathname: '/learn/web', params: { path: '/space/mcp', title: 'MCP Services' } });

/**
 * MCP Services, as DeepTutor's page has them: your servers (by URL or from the store) with their
 * state and tools, the ones DeepTutor couldn't connect, and the deployment's own. Opening the
 * page makes DeepTutor connect to them, as its own page does.
 */
export default function McpServices() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const state = useMcpState();
  const setState = useMcpStateSetter();
  const [shown, setShown] = useState<DtMcpServer | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const after = useRef<McpSheetAfter>(null);
  // The server being edited, or 'new'; null when the form is closed.
  const [form, setForm] = useState<DtMcpServer | 'new' | null>(null);
  const data = state.data;
  const servers = data?.servers ?? [];
  const atCap = data ? servers.length >= data.maxServers : false;
  // The sheet shows the server as it is now (each change answers with the whole state).
  const current = shown ? (servers.find((server) => server.name === shown.name) ?? shown) : null;

  const removeRejected = (name: string) =>
    Alert.alert(`Remove ${name}?`, 'Its settings and credentials are deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void deleteMcpServer(client, name).then(
            (next) => {
              setState(next);
              toast(`${name} removed`);
            },
            (error: unknown) => toast(`Couldn’t remove it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader
        title="MCP Services"
        menu={[
          { key: 'store', label: 'Browse the Store', icon: 'squares-2x2', onPress: () => router.push('/learn/mcp/store') },
          { key: 'web', label: 'Open on the Web', icon: 'globe-alt', onPress: openWebPage },
        ]}
      />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={() => void state.refetch()} />}>
        <Text style={[styles.intro, { color: palette.textMuted }]}>
          Servers on the internet whose tools your chats can use. DeepTutor connects to them when you open this page, save, test, or chat.
          {data ? ` You have ${servers.length} of ${data.maxServers}.` : ''}
        </Text>
        <View style={styles.buttons}>
          <View style={styles.flex}>
            <Button label="Add by URL" disabled={atCap || !data} onPress={() => setForm('new')} />
          </View>
          <View style={styles.flex}>
            <Button label="Browse the Store" variant="secondary" onPress={() => router.push('/learn/mcp/store')} />
          </View>
        </View>
        {atCap ? <Text style={[styles.note, { color: palette.warning }]}>You have as many servers as DeepTutor allows.</Text> : null}
        {state.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {state.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load your servers: ${describeError(state.error)}`}</Text> : null}
        {data && !servers.length ? (
          <View style={[styles.emptyCard, { borderColor: palette.border }]}>
            <Icon name="puzzle-piece" size={28} color={palette.textFaint} />
            <Text style={[styles.emptyText, { color: palette.textMuted }]}>No servers yet. Add one by its URL, or install one from the store.</Text>
          </View>
        ) : null}
        {servers.map((server) => (
          <Pressable
            key={server.name}
            accessibilityRole="button"
            accessibilityHint="Shows its tools and settings"
            onPress={() => {
              setShown(server);
              setSheetOpen(true);
            }}
            style={({ pressed }) => [styles.row, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : 'transparent' }]}>
            <View style={[styles.mark, { backgroundColor: palette.surfaceStrong }]}>
              <Text style={[styles.markText, { color: palette.text }]}>{server.name.slice(0, 2).toUpperCase()}</Text>
            </View>
            <View style={styles.text}>
              <View style={styles.titleLine}>
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                  {server.name}
                </Text>
                <McpStatus status={server.status} />
              </View>
              <Text style={[styles.detail, { color: palette.textMuted }]} numberOfLines={1}>
                {[server.url, server.tools.length ? `${server.tools.length} tools` : ''].filter(Boolean).join(' · ')}
              </Text>
              {server.status === 'error' && server.error ? (
                <Text style={[styles.detail, { color: palette.danger }]} numberOfLines={2}>
                  {server.error}
                </Text>
              ) : null}
            </View>
            <Icon name="chevron-right" size={14} color={palette.textFaint} />
          </Pressable>
        ))}
        {data?.rejected.length ? (
          <>
            <Text style={[styles.section, { color: palette.textMuted }]}>Not connected</Text>
            {data.rejected.map((row) => (
              <View key={row.name} style={[styles.row, { borderColor: palette.border }]}>
                <View style={styles.text}>
                  <Text style={[styles.name, { color: palette.text }]}>{row.name}</Text>
                  <Text style={[styles.detail, { color: palette.textMuted }]}>{row.reason}</Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => removeRejected(row.name)} hitSlop={8}>
                  <Text style={[styles.link, { color: palette.danger }]}>Remove</Text>
                </Pressable>
              </View>
            ))}
          </>
        ) : null}
        {data?.deployment.length ? (
          <>
            <Text style={[styles.section, { color: palette.textMuted }]}>From your server</Text>
            <Text style={[styles.note, { color: palette.textFaint }]}>Your admin decides which of their tools your chats may use.</Text>
            {data.deployment.map((row) => (
              <View key={row.name} style={[styles.row, { borderColor: palette.border }]}>
                <View style={styles.text}>
                  <Text style={[styles.name, { color: palette.text }]}>{row.name}</Text>
                  <Text style={[styles.detail, { color: palette.textMuted }]}>{`${row.tools} tools`}</Text>
                </View>
                <McpStatus status={row.status} />
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
      <McpServerSheet
        key={shown?.name ?? 'none'}
        visible={sheetOpen}
        server={current}
        onClose={() => setSheetOpen(false)}
        onAfter={(next) => {
          after.current = next;
          setSheetOpen(false);
        }}
        onDismiss={() => {
          const next = after.current;
          after.current = null;
          if (next === 'edit' && current) setForm(current);
          if (next === 'sign-in') openWebPage();
        }}
      />
      <McpServerForm visible={form !== null} server={form === 'new' ? null : form} taken={servers.map((server) => server.name)} onClose={() => setForm(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  intro: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  buttons: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  emptyCard: { alignItems: 'center', gap: 8, padding: 24, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, borderStyle: 'dashed' },
  emptyText: { fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  mark: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  markText: { fontFamily: fonts.semibold, fontSize: 13 },
  text: { flex: 1, gap: 3 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 15 },
  detail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 10, marginLeft: 4 },
  link: { fontFamily: fonts.medium, fontSize: 14 },
});
