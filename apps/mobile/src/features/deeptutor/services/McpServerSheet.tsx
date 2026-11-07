import { deleteMcpServer, mcpRefusal, mcpUsage, setMcpServerEnabled, testMcpServer, type DtMcpServer, type DtMcpTool } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { bareToolName, McpStatus, useMcpStateSetter } from './mcpBits';

/** Where the screen goes once the sheet has gone. */
export type McpSheetAfter = 'edit' | 'sign-in' | null;

/**
 * One MCP server: its state and tools, on or off, a test connection, reconnecting, signing in
 * with its provider (on DeepTutor's page), editing and deleting.
 */
export function McpServerSheet({ visible, server, onClose, onAfter, onDismiss }: { visible: boolean; server: DtMcpServer | null; onClose: () => void; onAfter: (after: McpSheetAfter) => void; onDismiss: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const setState = useMcpStateSetter();
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; tools: DtMcpTool[]; error: string } | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast(mcpRefusal(error) ?? describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  };
  const toggle = (on: boolean) => {
    if (server) void run(async () => setState(await setMcpServerEnabled(client, server, on)));
  };
  // DeepTutor 1.7.1 retries a server that failed, not one waiting for sign-in: off and on again makes it try.
  const reconnect = () => {
    if (!server) return;
    void run(async () => {
      await setMcpServerEnabled(client, server, false);
      setState(await setMcpServerEnabled(client, { ...server, config: { ...server.config, enabled: false } }, true));
      toast('Reconnecting');
    });
  };
  const runTest = () => {
    if (!server) return;
    void run(async () => {
      setTest(null);
      setTest(await testMcpServer(client, server.name, server.config));
    });
  };
  const remove = async () => {
    if (!server) return;
    const usage = await mcpUsage(client, server.name).catch(() => [] as string[]);
    Alert.alert(`Delete ${server.name}?`, `Its credentials and sign-in go too.${usage.length ? ` Chats in ${usage.join(', ')} use it.` : ''}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void run(async () => {
            setState(await deleteMcpServer(client, server.name));
            onClose();
            toast(`${server.name} deleted`);
          }),
      },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onDismiss}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <View style={styles.placeholder} />
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
            {server?.name ?? ''}
          </Text>
          {busy ? (
            <ActivityIndicator color={palette.textMuted} />
          ) : (
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
              <Text style={[styles.action, styles.strong, { color: palette.link }]}>Done</Text>
            </Pressable>
          )}
        </View>
        {server ? (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.line}>
              <McpStatus status={server.status} />
              <View style={styles.flex} />
              <Text style={[styles.note, { color: palette.textMuted }]}>On</Text>
              <Switch accessibilityLabel="On" value={server.enabled} disabled={busy} onValueChange={toggle} />
            </View>
            {server.error ? <Text style={[styles.note, { color: palette.danger }]}>{server.error}</Text> : null}
            <Text style={[styles.mono, { color: palette.textMuted }]} selectable>
              {server.url}
            </Text>
            {server.credentials.length ? <Text style={[styles.note, { color: palette.textMuted }]}>{`Credentials stored: ${server.credentials.map((field) => field.replace(/^header\./, '')).join(', ')}`}</Text> : null}
            {server.oauth ? (
              <View style={[styles.box, { borderColor: palette.border }]}>
                <Text style={[styles.note, { color: palette.text }]}>{server.authorized ? 'Signed in with its provider.' : 'It needs you to sign in with its provider.'}</Text>
                <Button label={server.authorized ? 'Sign In Again on DeepTutor’s Page' : 'Sign In on DeepTutor’s Page'} variant="secondary" onPress={() => onAfter('sign-in')} />
              </View>
            ) : null}
            <View style={styles.buttons}>
              <Button label="Test Connection" variant="secondary" disabled={busy} onPress={runTest} />
              {server.enabled && (server.status === 'error' || server.status === 'needs_auth') ? <Button label="Reconnect" variant="secondary" disabled={busy} onPress={reconnect} /> : null}
              <Button label="Edit" variant="secondary" disabled={busy} onPress={() => onAfter('edit')} />
            </View>
            {test ? (
              <Text style={[styles.note, { color: test.ok ? palette.text : palette.danger }]}>
                {test.ok ? `It answered with ${test.tools.length} ${test.tools.length === 1 ? 'tool' : 'tools'}.` : `It didn’t connect: ${test.error || 'no reason given'}`}
              </Text>
            ) : null}
            <Text style={[styles.section, { color: palette.textMuted }]}>{server.tools.length ? `Its ${server.tools.length} tools` : 'No tools listed yet'}</Text>
            {server.tools.map((tool) => (
              <View key={tool.name} style={styles.tool}>
                <Text style={[styles.toolName, { color: palette.text }]}>{bareToolName(server, tool.name)}</Text>
                {tool.description ? <Text style={[styles.note, { color: palette.textMuted }]}>{tool.description.replace(/^\[[^\]]+\]\s*/, '')}</Text> : null}
              </View>
            ))}
            <Pressable accessibilityRole="button" onPress={() => void remove()} style={styles.remove} hitSlop={6}>
              <Text style={[styles.removeText, { color: palette.danger }]}>{`Delete ${server.name}`}</Text>
            </Pressable>
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  placeholder: { width: 40 },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  mono: { fontFamily: fonts.mono, fontSize: 12 },
  box: { gap: 8, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  buttons: { gap: 8 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 8 },
  tool: { gap: 2 },
  toolName: { fontFamily: fonts.mono, fontSize: 13 },
  remove: { alignSelf: 'center', marginTop: 16, padding: 8 },
  removeText: { fontFamily: fonts.medium, fontSize: 15 },
});
