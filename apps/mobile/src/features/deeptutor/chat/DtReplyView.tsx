import { replySegments, toolSummary, type DtReply, type DtSource, type DtToolStep } from '@maviechat/deeptutor-protocol';
import * as Clipboard from 'expo-clipboard';
import { memo, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { Disclosure } from '@/features/chat/Steps';
import { openLink } from '@/lib/links';
import { Markdown } from '@/markdown/Markdown';
import { fonts, radius, usePalette } from '@/theme';
import { toolIcon, toolLabel } from './DtComposer';

/** Long tool output stays readable on a phone: the rest is a tap away on the web. */
const RESULT_LIMIT = 4000;

function hostOf(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? url;
}

function ToolStepView({ tool }: { tool: DtToolStep }) {
  const palette = usePalette();
  const summary = toolSummary(tool);
  const label = tool.done ? `${toolLabel(tool.name)}${summary ? `: ${summary}` : ''}` : `${toolLabel(tool.name)}…`;
  const result = tool.result.length > RESULT_LIMIT ? `${tool.result.slice(0, RESULT_LIMIT)}\n\n…` : tool.result;
  return (
    <Disclosure icon={toolIcon(tool.name)} label={label} busy={!tool.done}>
      {result.trim() ? <Markdown text={result} muted /> : <Text style={[styles.faint, { color: palette.textFaint }]}>No output yet.</Text>}
    </Disclosure>
  );
}

function SourceList({ sources }: { sources: DtSource[] }) {
  const palette = usePalette();
  return (
    <View style={styles.sources}>
      <Text style={[styles.sourcesTitle, { color: palette.textMuted }]}>Sources</Text>
      {sources.slice(0, 12).map((source, index) => (
        <Pressable
          key={source.url}
          accessibilityRole="link"
          onPress={() => void openLink(source.url)}
          style={({ pressed }) => [styles.source, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
          <Text style={[styles.sourceIndex, { color: palette.textFaint }]}>{index + 1}</Text>
          <View style={styles.sourceText}>
            <Text style={[styles.sourceTitle, { color: palette.text }]} numberOfLines={1}>
              {source.title}
            </Text>
            <Text style={[styles.sourceHost, { color: palette.textFaint }]} numberOfLines={1}>
              {hostOf(source.url)}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

interface DtReplyViewProps {
  reply: DtReply;
  baseUrl: string;
  /** Regenerate is offered on the last reply only. */
  onRegenerate?: () => void;
}

/** A DeepTutor reply: its reasoning, the answer with each tool call in its place, sources and actions. */
export const DtReplyView = memo(function DtReplyView({ reply, baseUrl, onRegenerate }: DtReplyViewProps) {
  const palette = usePalette();
  const toast = useToast();
  const segments = useMemo(() => replySegments(reply), [reply]);
  const running = reply.status === 'running';
  const thinking = reply.thoughts.map((thought) => thought.text.trim()).filter(Boolean).join('\n\n');
  const stillThinking = running && !reply.answer && reply.tools.length === 0;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.speaker, { color: palette.text }]}>DeepTutor</Text>
      {thinking ? (
        <Disclosure icon="light-bulb" label={stillThinking ? 'Thinking…' : 'Thought'} busy={stillThinking}>
          <Markdown text={thinking} muted />
        </Disclosure>
      ) : null}
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <Markdown key={`t${index}`} text={segment.text} baseUrl={baseUrl} />
        ) : (
          <View key={`s${index}`}>
            {segment.tools.map((tool) => (
              <ToolStepView key={tool.id} tool={tool} />
            ))}
          </View>
        ),
      )}
      {running || reply.status === 'waiting' ? (
        <View style={styles.activity}>
          <ActivityIndicator size="small" color={palette.textMuted} />
          <Text style={[styles.activityText, { color: palette.textMuted }]} numberOfLines={2}>
            {reply.status === 'waiting' ? 'DeepTutor is waiting for your answer in the web app.' : (reply.activity ?? 'Working…')}
          </Text>
        </View>
      ) : null}
      {reply.error ? (
        <View style={[styles.error, { borderColor: palette.danger }]}>
          <Icon name="exclamation-triangle" size={16} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{reply.error}</Text>
        </View>
      ) : null}
      {reply.status === 'cancelled' ? <Text style={[styles.faint, { color: palette.textFaint }]}>Stopped.</Text> : null}
      {reply.sources.length > 0 ? <SourceList sources={reply.sources} /> : null}
      {!running && reply.status !== 'waiting' ? (
        <View style={styles.actions}>
          {reply.answer.trim() ? (
            <IconButton
              icon="clipboard-document"
              label="Copy response"
              size={18}
              color={palette.textMuted}
              onPress={() => void Clipboard.setStringAsync(reply.answer).then(() => toast('Copied to clipboard'))}
            />
          ) : null}
          {onRegenerate ? <IconButton icon="arrow-path" label="Regenerate" size={18} color={palette.textMuted} onPress={onRegenerate} /> : null}
        </View>
      ) : null}
    </View>
  );
});

/** Your message, as a bubble on the right. */
export function DtUserBubble({ text }: { text: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.bubble, { backgroundColor: palette.bubble }]}>
      <Text selectable style={[styles.userText, { color: palette.text }]}>
        {text.trim()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 18 },
  speaker: { fontFamily: fonts.semibold, fontSize: 15, marginBottom: 4 },
  activity: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 6 },
  activityText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 14 },
  faint: { fontFamily: fonts.regular, fontSize: 13, marginVertical: 4 },
  error: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginVertical: 8, padding: 12, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  errorText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  sources: { marginTop: 10, gap: 6 },
  sourcesTitle: { fontFamily: fonts.medium, fontSize: 13 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  sourceIndex: { fontFamily: fonts.medium, fontSize: 12, width: 16, textAlign: 'center' },
  sourceText: { flex: 1 },
  sourceTitle: { fontFamily: fonts.regular, fontSize: 14 },
  sourceHost: { fontFamily: fonts.regular, fontSize: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4, marginLeft: -8 },
  bubble: { alignSelf: 'flex-end', maxWidth: '85%', borderRadius: radius.xl, paddingHorizontal: 14, paddingVertical: 10, marginTop: 18 },
  userText: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
});
