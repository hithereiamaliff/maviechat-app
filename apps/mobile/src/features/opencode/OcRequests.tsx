import type { PermissionReply, PermissionRequest, QuestionRequest } from '@maviechat/opencode-protocol';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, radius, usePalette } from '@/theme';

/** What OpenCode is asking to do, in words. */
export function permissionTitle(request: PermissionRequest): string {
  switch (request.permission) {
    case 'bash':
      return request.patterns.length > 1 ? 'Run these commands?' : 'Run this command?';
    case 'edit':
      return request.patterns.length > 1 ? 'Change these files?' : 'Change this file?';
    case 'external_directory':
      return 'Work outside the project?';
    case 'webfetch':
      return 'Fetch this page?';
    case 'websearch':
      return 'Search the web?';
    case 'doom_loop':
      return 'Keep repeating the same step?';
    case 'read':
      return 'Read this file?';
    case 'task':
      return 'Start a helper agent?';
    default:
      return `Allow ${request.permission}?`;
  }
}

function Choice({ label, tone = 'plain', onPress, disabled }: { label: string; tone?: 'plain' | 'primary' | 'danger'; onPress: () => void; disabled: boolean }) {
  const palette = usePalette();
  const primary = tone === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        { borderColor: palette.border, backgroundColor: primary ? palette.primary : palette.background },
        pressed && { opacity: 0.7 },
        disabled && { opacity: 0.5 },
      ]}>
      <Text style={[styles.choiceText, { color: primary ? palette.onPrimary : tone === 'danger' ? palette.danger : palette.text }]}>{label}</Text>
    </Pressable>
  );
}

/** OpenCode waiting for your OK before a tool runs. "Always" covers the rest of this session. */
export function PermissionCard({ request, onReply }: { request: PermissionRequest; onReply: (reply: PermissionReply) => Promise<void> }) {
  const palette = usePalette();
  const [busy, setBusy] = useState(false);
  const reply = (value: PermissionReply) => {
    setBusy(true);
    onReply(value).finally(() => setBusy(false));
  };
  return (
    <View style={[styles.card, { borderColor: palette.warning, backgroundColor: palette.surface }]} accessibilityLiveRegion="polite">
      <Text style={[styles.title, { color: palette.text }]}>{permissionTitle(request)}</Text>
      {request.patterns.map((pattern) => (
        <Text key={pattern} selectable style={[styles.pattern, { color: palette.text, backgroundColor: palette.codeBackground }]}>
          {pattern}
        </Text>
      ))}
      <View style={styles.row}>
        <Choice label="Allow Once" tone="primary" onPress={() => reply('once')} disabled={busy} />
        {request.always.length > 0 ? <Choice label="Always Allow" onPress={() => reply('always')} disabled={busy} /> : null}
        <Choice label="Reject" tone="danger" onPress={() => reply('reject')} disabled={busy} />
        {busy ? <ActivityIndicator color={palette.textMuted} /> : null}
      </View>
    </View>
  );
}

/** The agent asking you to choose. One answer (the chosen labels) per question. */
export function QuestionCard({ request, onAnswer, onSkip }: { request: QuestionRequest; onAnswer: (answers: string[][]) => Promise<void>; onSkip: () => Promise<void> }) {
  const palette = usePalette();
  const [picked, setPicked] = useState<string[][]>(() => request.questions.map(() => []));
  const [busy, setBusy] = useState(false);
  const run = (work: () => Promise<void>) => {
    setBusy(true);
    work().finally(() => setBusy(false));
  };
  const complete = picked.every((answers) => answers.length > 0);
  return (
    <View style={[styles.card, { borderColor: palette.link, backgroundColor: palette.surface }]} accessibilityLiveRegion="polite">
      {request.questions.map((question, index) => (
        <View key={`${index}:${question.question}`} style={styles.question}>
          {question.header ? <Text style={[styles.header, { color: palette.textMuted }]}>{question.header}</Text> : null}
          <Text style={[styles.title, { color: palette.text }]}>{question.question}</Text>
          {question.options.map((option) => {
            const chosen = picked[index]?.includes(option.label) ?? false;
            return (
              <Pressable
                key={option.label}
                accessibilityRole={question.multiple ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: chosen }}
                disabled={busy}
                onPress={() =>
                  setPicked((current) =>
                    current.map((answers, at) => (at !== index ? answers : question.multiple ? (chosen ? answers.filter((label) => label !== option.label) : [...answers, option.label]) : [option.label])),
                  )
                }
                style={[styles.option, { borderColor: chosen ? palette.link : palette.border, backgroundColor: chosen ? palette.active : palette.background }]}>
                <Text style={[styles.optionLabel, { color: chosen ? palette.onActive : palette.text }]}>{option.label}</Text>
                {option.description ? <Text style={[styles.optionDetail, { color: palette.textMuted }]}>{option.description}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={styles.row}>
        <Choice label="Send" tone="primary" onPress={() => run(() => onAnswer(picked))} disabled={busy || !complete} />
        <Choice label="Skip" onPress={() => run(onSkip)} disabled={busy} />
        {busy ? <ActivityIndicator color={palette.textMuted} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: 14, gap: 10 },
  title: { fontFamily: fonts.semibold, fontSize: 15 },
  header: { fontFamily: fonts.medium, fontSize: 12 },
  pattern: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18, padding: 8, borderRadius: radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  choice: { minHeight: 40, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  choiceText: { fontFamily: fonts.medium, fontSize: 14 },
  question: { gap: 8 },
  option: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  optionLabel: { fontFamily: fonts.medium, fontSize: 14 },
  optionDetail: { fontFamily: fonts.regular, fontSize: 13 },
});
