import { installMcpEntry, mcpRefusal, testMcpServer, type DtMcpEntry } from '@maviechat/deeptutor-protocol';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { useMcpStateSetter } from './mcpBits';

/**
 * One server in DeepTutor's store: what it is and needs, and installing it under its own name
 * (DeepTutor 1.7.1 mislays the credentials of one installed under another), then a test.
 */
export function McpEntrySheet({ visible, entry, atCap, onClose }: { visible: boolean; entry: DtMcpEntry | null; atCap: boolean; onClose: () => void }) {
  const palette = usePalette();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible && entry ? <Entry key={entry.id} entry={entry} atCap={atCap} onClose={onClose} /> : <View style={{ backgroundColor: palette.background }} />}
    </Modal>
  );
}

function Entry({ entry, atCap, onClose }: { entry: DtMcpEntry; atCap: boolean; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const setState = useMcpStateSetter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const blank = entry.fields.filter((field) => field.required && !values[field.key]?.trim());
  const blocked = (atCap && !entry.installed) || blank.length > 0;

  const install = async () => {
    setBusy(true);
    setResult(null);
    try {
      const state = await installMcpEntry(client, entry.id, Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim())));
      setState(state);
      setValues({});
      toast(`${entry.name} installed`);
      const server = state.servers.find((row) => row.name === entry.id);
      if (server) {
        const test = await testMcpServer(client, server.name, server.config);
        setResult(test.ok ? { ok: true, text: `Connected: ${test.tools.length} ${test.tools.length === 1 ? 'tool' : 'tools'}.` } : { ok: false, text: server.oauth ? 'Installed. It needs you to sign in with its provider: open it in MCP Services.' : `Installed, but it didn’t connect: ${test.error || 'no reason given'}` });
      }
    } catch (error) {
      setResult({ ok: false, text: mcpRefusal(error) ?? describeError(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <View style={styles.placeholder} />
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
          {entry.name}
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, styles.strong, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {entry.installed ? <Text style={[styles.badge, { color: palette.success }]}>Installed</Text> : null}
        <Text style={[styles.body, { color: palette.text }]}>{entry.description}</Text>
        {!entry.verified ? <Text style={[styles.note, { color: palette.warning }]}>Not checked by DeepTutor’s makers: install it only if you trust who runs it.</Text> : null}
        {entry.requires ? <Text style={[styles.note, { color: palette.textMuted }]}>{`It needs: ${entry.requires}`}</Text> : null}
        <View style={styles.links}>
          {entry.docs ? (
            <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(entry.docs)} hitSlop={6}>
              <Text style={[styles.link, { color: palette.link }]}>Documentation</Text>
            </Pressable>
          ) : null}
          {entry.homepage ? (
            <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(entry.homepage)} hitSlop={6}>
              <Text style={[styles.link, { color: palette.link }]}>Website</Text>
            </Pressable>
          ) : null}
        </View>
        {entry.fields.map((field) => (
          <View key={field.key} style={styles.field}>
            <Text style={[styles.label, { color: palette.text }]}>{field.required ? field.label : `${field.label} (optional)`}</Text>
            <TextInput
              value={values[field.key] ?? ''}
              onChangeText={(value) => setValues({ ...values, [field.key]: value })}
              placeholder={field.placeholder}
              placeholderTextColor={palette.textFaint}
              secureTextEntry={field.secret}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={field.label}
              style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
            />
          </View>
        ))}
        {entry.fields.some((field) => field.secret) ? <Text style={[styles.note, { color: palette.textMuted }]}>Credentials are kept on the server, apart from the settings, and never shown again.</Text> : null}
        {atCap && !entry.installed ? <Text style={[styles.note, { color: palette.warning }]}>You have as many servers as DeepTutor allows: delete one first.</Text> : null}
        {blank.length && !(atCap && !entry.installed) ? <Text style={[styles.note, { color: palette.textMuted }]}>{`Fill in ${blank.map((field) => field.label).join(', ')} first.`}</Text> : null}
        <Button label={entry.installed ? 'Install Again' : 'Install'} loading={busy} disabled={blocked} onPress={() => void install()} />
        {result ? <Text style={[styles.note, { color: result.ok ? palette.text : palette.danger }]}>{result.text}</Text> : null}
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
  placeholder: { width: 40 },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  badge: { fontFamily: fonts.medium, fontSize: 13 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  links: { flexDirection: 'row', gap: 20 },
  link: { fontFamily: fonts.medium, fontSize: 14 },
  field: { gap: 6 },
  label: { fontFamily: fonts.medium, fontSize: 14 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
});
