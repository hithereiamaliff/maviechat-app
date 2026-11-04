import { isSecretRef, mcpConfigOf, mcpDraftOf, mcpNameProblem, mcpRefusal, saveMcpServer, testMcpServer, type DtMcpDraft, type DtMcpServer, type DtMcpTool } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { useMcpStateSetter } from './mcpBits';

const TRANSPORTS: { value: DtMcpDraft['transport']; label: string }[] = [
  { value: '', label: 'Automatic' },
  { value: 'streamableHttp', label: 'Streamable HTTP' },
  { value: 'sse', label: 'SSE' },
];

/** A server by URL, new or changed: headers' values are kept as credentials on the server and never shown again. */
export function McpServerForm({ visible, server, taken, onClose }: { visible: boolean; server: DtMcpServer | null; taken: string[]; onClose: () => void }) {
  const palette = usePalette();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Form server={server} taken={taken} onClose={onClose} /> : <View style={{ backgroundColor: palette.background }} />}
    </Modal>
  );
}

function Form({ server, taken, onClose }: { server: DtMcpServer | null; taken: string[]; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const setState = useMcpStateSetter();
  const [name, setName] = useState(server?.name ?? '');
  const [draft, setDraft] = useState<DtMcpDraft>(() => mcpDraftOf(server));
  const [toolsText, setToolsText] = useState(() => mcpDraftOf(server).enabledTools.join('\n'));
  const [timeoutText, setTimeoutText] = useState(() => String(mcpDraftOf(server).timeout));
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [problem, setProblem] = useState('');
  const [test, setTest] = useState<{ ok: boolean; tools: DtMcpTool[]; error: string } | null>(null);
  const nameIssue = server ? null : mcpNameProblem(name.trim(), taken);
  const ready = !nameIssue && draft.url.trim().length > 0;
  const full = (): DtMcpDraft => ({
    ...draft,
    timeout: Number.parseInt(timeoutText, 10) || 30,
    enabledTools: toolsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  });
  const setHeader = (index: number, change: Partial<{ key: string; value: string }>) => setDraft((current) => ({ ...current, headers: current.headers.map((header, i) => (i === index ? { ...header, ...change } : header)) }));

  const runTest = async () => {
    setBusy('test');
    setTest(null);
    try {
      setTest(await testMcpServer(client, server?.name ?? name.trim(), mcpConfigOf(full(), server?.config)));
    } catch (error) {
      setTest({ ok: false, tools: [], error: mcpRefusal(error) ?? describeError(error) });
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    if (!ready) return setProblem(nameIssue ?? 'Give the server’s URL.');
    setBusy('save');
    setProblem('');
    try {
      setState(await saveMcpServer(client, server?.name ?? name.trim(), mcpConfigOf(full(), server?.config)));
      toast(server ? 'Saved' : `${name.trim()} added`);
      onClose();
    } catch (error) {
      setProblem(mcpRefusal(error) ?? describeError(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
          {server ? server.name : 'Add by URL'}
        </Text>
        {busy === 'save' ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : (
          <Pressable accessibilityRole="button" disabled={!ready || busy !== null} onPress={() => void save()} hitSlop={10}>
            <Text style={[styles.action, styles.strong, { color: ready ? palette.link : palette.textFaint }]}>Save</Text>
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {problem ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{problem}</Text> : null}
        {!server ? (
          <View style={styles.field}>
            <Text style={[styles.label, { color: palette.text }]}>Name</Text>
            <TextInput value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Name" style={[styles.input, { color: palette.text, borderColor: name && nameIssue ? palette.danger : palette.border, backgroundColor: palette.surface }]} />
            {name && nameIssue ? <Text style={[styles.note, { color: palette.danger }]}>{nameIssue}</Text> : null}
          </View>
        ) : null}
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>Server URL</Text>
          <TextInput
            value={draft.url}
            onChangeText={(url) => setDraft({ ...draft, url })}
            placeholder="https://example.com/mcp"
            placeholderTextColor={palette.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Server URL"
            style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
          <Text style={[styles.note, { color: palette.textMuted }]}>A server on the internet: DeepTutor connects to it from the server, and refuses private addresses.</Text>
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>How it talks</Text>
          <View style={styles.segments}>
            {TRANSPORTS.map((option) => {
              const on = draft.transport === option.value;
              return (
                <Pressable
                  key={option.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setDraft({ ...draft, transport: option.value })}
                  style={[styles.segment, { borderColor: palette.border }, on && { backgroundColor: palette.active, borderColor: palette.active }]}>
                  <Text style={[styles.segmentText, { color: on ? palette.onActive : palette.textMuted }]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>Headers</Text>
          <Text style={[styles.note, { color: palette.textMuted }]}>Values are kept as credentials on the server, apart from these settings, and never shown again.</Text>
          {draft.headers.map((header, index) => {
            const stored = isSecretRef(header.value);
            return (
              <View key={index} style={styles.header2}>
                <TextInput
                  value={header.key}
                  onChangeText={(key) => setHeader(index, { key })}
                  placeholder="Authorization"
                  placeholderTextColor={palette.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Header name"
                  style={[styles.input, styles.flex, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
                />
                {stored ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Replace ${header.key}`} onPress={() => setHeader(index, { value: '' })} style={[styles.input, styles.flex, styles.stored, { borderColor: palette.border }]}>
                    <Text style={[styles.note, { color: palette.textMuted }]}>Stored · Replace</Text>
                  </Pressable>
                ) : (
                  <TextInput
                    value={header.value}
                    onChangeText={(value) => setHeader(index, { value })}
                    placeholder="Value"
                    placeholderTextColor={palette.textFaint}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel={`${header.key || 'Header'} value`}
                    style={[styles.input, styles.flex, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
                  />
                )}
                <Pressable accessibilityRole="button" accessibilityLabel="Remove header" onPress={() => setDraft({ ...draft, headers: draft.headers.filter((_, i) => i !== index) })} hitSlop={8}>
                  <Icon name="x-mark" size={16} color={palette.textMuted} />
                </Pressable>
              </View>
            );
          })}
          <Pressable accessibilityRole="button" onPress={() => setDraft({ ...draft, headers: [...draft.headers, { key: '', value: '' }] })} hitSlop={6}>
            <Text style={[styles.link, { color: palette.link }]}>Add a Header</Text>
          </Pressable>
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>Seconds a tool may take</Text>
          <TextInput value={timeoutText} onChangeText={setTimeoutText} keyboardType="number-pad" accessibilityLabel="Seconds a tool may take" style={[styles.input, styles.short, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>Only these tools</Text>
          <TextInput
            value={toolsText}
            onChangeText={setToolsText}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="One a line; empty for all of them"
            placeholderTextColor={palette.textFaint}
            accessibilityLabel="Only these tools"
            style={[styles.input, styles.multiline, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
        </View>
        <Button label="Test Connection" variant="secondary" loading={busy === 'test'} disabled={!draft.url.trim() || busy !== null} onPress={() => void runTest()} />
        {test ? (
          <Text style={[styles.note, { color: test.ok ? palette.text : palette.danger }]}>
            {test.ok ? `It answered with ${test.tools.length} ${test.tools.length === 1 ? 'tool' : 'tools'}: ${test.tools.map((tool) => tool.name).join(', ')}` : `It didn’t connect: ${test.error || 'no reason given'}`}
          </Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  field: { gap: 6 },
  label: { fontFamily: fonts.medium, fontSize: 14 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  problem: { padding: 10, borderWidth: 1, borderRadius: radius.md, fontSize: 13 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  short: { width: 100 },
  flex: { flex: 1 },
  segments: { flexDirection: 'row', gap: 8 },
  segment: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  segmentText: { fontFamily: fonts.medium, fontSize: 13 },
  header2: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stored: { justifyContent: 'center' },
  link: { fontFamily: fonts.medium, fontSize: 14 },
});
