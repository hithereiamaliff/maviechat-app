import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { openLink } from '@/lib/links';
import { fonts, radius, usePalette } from '@/theme';
import { NOTE_LIMIT, REPORT_EMAIL, REPORT_REASONS, REPORT_THREADS, reportIntro, sendReport, type ReportReason, type ReportSubject } from './report';

export interface ReportRequest extends ReportSubject {
  /** Open WebUI: also files it with the server's admins, as its own 👎 with the reason. Resolves true once saved. */
  toServer?: (reason: ReportReason, note: string) => Promise<boolean>;
}

/**
 * Report… on an AI reply: a sheet to say what's wrong and send it to TechMavie Digital without
 * leaving the app. Render `element` once in the screen or list that shows the replies.
 */
export function useReportSheet(): { open: (request: ReportRequest) => void; element: ReactNode } {
  const [request, setRequest] = useState<ReportRequest | null>(null);
  const element = (
    <Modal visible={request !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setRequest(null)}>
      {request ? <ReportForm request={request} onClose={() => setRequest(null)} /> : null}
    </Modal>
  );
  return { open: setRequest, element };
}

function appInfo() {
  const platform = Platform.OS === 'ios' ? (Platform.isPad ? 'iPad' : 'iPhone') : Platform.OS === 'android' ? 'Android' : Platform.OS;
  const update = Updates.isEmbeddedLaunch || !Updates.updateId ? 'built-in' : `update ${Updates.updateId.slice(0, 8)}`;
  return { version: Constants.expoConfig?.version ?? 'unknown', platform, update };
}

function ReportForm({ request, onClose }: { request: ReportRequest; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [includeReply, setIncludeReply] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const reply = request.reply.trim();

  const send = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await sendReport({ subject: request, reason, note, includeReply: includeReply && reply.length > 0, app: appInfo() });
    } catch (error) {
      setProblem(`Couldn't send the report: ${describeError(error)}. Try again, or write to ${REPORT_EMAIL}.`);
      setBusy(false);
      return;
    }
    const toAdmins = request.toServer ? await request.toServer(reason, note).catch(() => false) : true;
    setBusy(false);
    onClose();
    toast(toAdmins ? 'Report sent. Thank you.' : "Report sent to TechMavie Digital, but the server's admins couldn't be told.", toAdmins ? 'success' : 'info');
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={1} accessibilityRole="header">
          Report Reply
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.headerAction, { color: palette.link }]}>Cancel</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.body, { color: palette.text }]}>{reportIntro(request, Boolean(request.toServer))}</Text>

        <Text style={[styles.label, { color: palette.textMuted }]}>{"What's wrong?"}</Text>
        <View style={[styles.group, { borderColor: palette.border }]} accessibilityRole="radiogroup">
          {REPORT_REASONS.map((item, index) => {
            const chosen = reason === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: chosen }}
                onPress={() => setReason(item.key)}
                style={({ pressed }) => [styles.reason, index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: palette.surface }]}>
                <View style={[styles.radio, { borderColor: chosen ? palette.link : palette.textFaint }]}>{chosen ? <View style={[styles.radioDot, { backgroundColor: palette.link }]} /> : null}</View>
                <Text style={[styles.reasonText, { color: palette.text }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Anything else we should know? (optional)"
          placeholderTextColor={palette.textFaint}
          multiline
          maxLength={NOTE_LIMIT}
          editable={!busy}
          style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          accessibilityLabel="Anything else we should know"
        />

        {reply ? (
          <View style={[styles.group, { borderColor: palette.border }]}>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={[styles.reasonText, { color: palette.text }]}>{"Include the reply's text"}</Text>
                <Text style={[styles.small, { color: palette.textMuted }]}>So we can see what it said.</Text>
              </View>
              <Switch accessibilityLabel="Include the reply's text" value={includeReply} onValueChange={setIncludeReply} disabled={busy} />
            </View>
            {includeReply ? (
              <Text style={[styles.preview, { color: palette.textMuted, borderTopColor: palette.border }]} numberOfLines={5}>
                {reply}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text style={[styles.small, { color: palette.textMuted }]}>
          {
            "It goes to TechMavie Digital through Netlify, which hosts our website: what's wrong, your note, the reply's text if you include it, the server's address, the model's name and this app's version. Your sign-in, name, email and the rest of the chat stay out of it."
          }
        </Text>

        {problem ? <Text style={[styles.small, { color: palette.danger }]}>{problem}</Text> : null}

        <Button label="Send Report" onPress={() => void send()} loading={busy} disabled={!reason || busy} />

        <Text style={[styles.small, { color: palette.textMuted }]}>
          {'You can also write to '}
          <Text accessibilityRole="link" style={{ color: palette.link }} onPress={() => void openLink(`mailto:${REPORT_EMAIL}`)}>
            {REPORT_EMAIL}
          </Text>
          {', or message '}
          <Text accessibilityRole="link" style={{ color: palette.link }} onPress={() => void openLink(REPORT_THREADS.url)}>
            {REPORT_THREADS.handle}
          </Text>
          {' on Threads.'}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 17 },
  headerAction: { fontFamily: fonts.medium, fontSize: 16 },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 40, gap: 14 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  label: { fontFamily: fonts.medium, fontSize: 13, marginBottom: -6 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 14, paddingVertical: 10 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  reasonText: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  input: { minHeight: 84, maxHeight: 160, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, fontFamily: fonts.regular, fontSize: 15, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  switchText: { flex: 1, gap: 2 },
  preview: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
