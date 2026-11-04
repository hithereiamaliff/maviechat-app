import { errorText, type MessageWithParts, type OtherPart, type Part, type ToolPart } from '@maviechat/opencode-protocol';
import { memo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { Markdown } from '@/markdown/Markdown';
import { fonts, radius, usePalette } from '@/theme';

const MAX_OUTPUT = 6000;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** What a tool call is about, in a line: the command, the file, the pattern, the page. */
export function toolSubject(tool: string, input: Record<string, unknown>): string {
  const file = str(input.filePath) || str(input.path);
  switch (tool) {
    case 'bash':
      return str(input.command);
    case 'edit':
    case 'write':
    case 'read':
    case 'list':
      return file;
    case 'glob':
    case 'grep':
      return [str(input.pattern), file].filter(Boolean).join(' in ');
    case 'webfetch':
      return str(input.url);
    case 'websearch':
      return str(input.query);
    case 'task':
      return str(input.description);
    default:
      return file || str(input.command) || str(input.description);
  }
}

export function toolIcon(tool: string): IconName {
  if (tool === 'bash') return 'command-line';
  if (tool === 'edit' || tool === 'write' || tool === 'patch') return 'pencil';
  if (tool === 'read' || tool === 'list') return 'document-text';
  if (tool === 'glob' || tool === 'grep') return 'magnifying-glass';
  if (tool === 'webfetch' || tool === 'websearch') return 'globe-alt';
  if (tool === 'task') return 'sparkles';
  if (tool.startsWith('todo')) return 'list-bullet';
  return 'wrench-screwdriver';
}

const TOOL_NAMES: Record<string, string> = {
  bash: 'Ran a command',
  edit: 'Edited a file',
  write: 'Wrote a file',
  read: 'Read a file',
  list: 'Listed a folder',
  glob: 'Found files',
  grep: 'Searched',
  webfetch: 'Fetched a page',
  websearch: 'Searched the web',
  task: 'Delegated a task',
  todowrite: 'Updated the to-do list',
  todoread: 'Read the to-do list',
  patch: 'Applied a patch',
};

const shorten = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters)` : text);

/** One tool call: what it did and on what, its status, and (tapped) its output or diff. */
export function ToolCard({ part }: { part: ToolPart }) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const { state } = part;
  const subject = toolSubject(part.tool, state.input ?? {});
  const title = ('title' in state && state.title) || TOOL_NAMES[part.tool] || part.tool;
  const running = state.status === 'pending' || state.status === 'running';
  const failed = state.status === 'error';
  const diff = state.status === 'completed' ? str(state.metadata?.diff) : '';
  const output = state.status === 'completed' ? state.output : state.status === 'error' ? state.error : '';
  const detail = diff || output;
  return (
    <View style={[styles.tool, { borderColor: failed ? palette.danger : palette.border, backgroundColor: palette.surface }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open, busy: running }}
        accessibilityLabel={`${title}${subject ? `: ${subject}` : ''}${running ? ', running' : failed ? ', failed' : ''}`}
        onPress={() => detail && setOpen(!open)}
        style={styles.toolHead}>
        <Icon name={toolIcon(part.tool)} size={16} color={failed ? palette.danger : palette.textMuted} />
        <View style={styles.toolText}>
          <Text style={[styles.toolTitle, { color: palette.text }]} numberOfLines={1}>
            {title}
          </Text>
          {subject && subject !== title ? (
            <Text style={[styles.toolSubject, { color: palette.textMuted }]} numberOfLines={open ? undefined : 2}>
              {subject}
            </Text>
          ) : null}
        </View>
        {running ? <ActivityIndicator size="small" color={palette.textMuted} /> : failed ? <Icon name="exclamation-triangle" size={16} color={palette.danger} /> : detail ? <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={palette.textFaint} /> : null}
      </Pressable>
      {open && detail ? (
        <ScrollView horizontal style={[styles.output, { borderTopColor: palette.border, backgroundColor: palette.codeBackground }]}>
          <Text selectable style={[styles.mono, { color: failed ? palette.danger : palette.text }]}>
            {shorten(detail, MAX_OUTPUT)}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

/** The model's thinking, folded unless opened. */
function Reasoning({ text, done }: { text: string; done: boolean }) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.reasoningHead} hitSlop={6}>
        <Text style={[styles.reasoningLabel, { color: palette.textMuted }]}>{done ? 'Thought' : 'Thinking…'}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={palette.textFaint} />
      </Pressable>
      {open ? <Markdown text={text} muted /> : null}
    </View>
  );
}

function Note({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'danger' }) {
  const palette = usePalette();
  return <Text style={[styles.note, { color: tone === 'danger' ? palette.danger : palette.textMuted }]}>{text}</Text>;
}

const fileName = (path: string) => path.split('/').pop() || path;

function PartView({ part }: { part: Part | OtherPart }) {
  switch (part.type) {
    case 'text': {
      const text = (part as Extract<Part, { type: 'text' }>).text;
      return text.trim() ? <Markdown text={text} /> : null;
    }
    case 'reasoning': {
      const reasoning = part as Extract<Part, { type: 'reasoning' }>;
      return <Reasoning text={reasoning.text} done={Boolean(reasoning.time?.end)} />;
    }
    case 'tool':
      return (part as ToolPart).tool === 'todowrite' || (part as ToolPart).tool === 'todoread' ? null : <ToolCard part={part as ToolPart} />;
    case 'patch': {
      const files = (part as Extract<Part, { type: 'patch' }>).files;
      return files.length ? <Note text={`Changed ${files.length === 1 ? fileName(files[0] ?? '') : `${files.length} files: ${files.map(fileName).slice(0, 6).join(', ')}${files.length > 6 ? '…' : ''}`}`} /> : null;
    }
    case 'file': {
      const file = part as Extract<Part, { type: 'file' }>;
      return <Note text={`Attached ${file.filename ?? 'a file'}`} />;
    }
    case 'subtask': {
      const task = part as Extract<Part, { type: 'subtask' }>;
      return <Note text={`Asked the ${task.agent} agent: ${task.description}`} />;
    }
    case 'retry': {
      const retry = part as Extract<Part, { type: 'retry' }>;
      return <Note text={`Retrying (attempt ${retry.attempt})${retry.error ? `: ${errorText(retry.error)}` : ''}`} tone="danger" />;
    }
    case 'compaction':
      return <Note text="Summarised the conversation so far to make room." />;
    default:
      return null;
  }
}

const formatTokens = (count: number) => (count >= 1000 ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k` : String(count));

/** A message: yours in a bubble; OpenCode's as its parts in order, with model, tokens and cost once done. */
export const OcMessage = memo(function OcMessage({ entry }: { entry: MessageWithParts }) {
  const palette = usePalette();
  const { info, parts } = entry;
  if (info.role === 'user') {
    const text = parts
      .filter((part): part is Extract<Part, { type: 'text' }> => part.type === 'text' && !(part as { synthetic?: boolean }).synthetic)
      .map((part) => part.text)
      .join('\n\n');
    const files = parts.filter((part): part is Extract<Part, { type: 'file' }> => part.type === 'file');
    return (
      <View style={[styles.user, { backgroundColor: palette.bubble }]}>
        {text ? (
          <Text selectable style={[styles.userText, { color: palette.text }]}>
            {text}
          </Text>
        ) : null}
        {files.map((file) => (
          <Text key={file.id} style={[styles.note, { color: palette.textMuted }]}>
            {file.filename ?? 'Attachment'}
          </Text>
        ))}
      </View>
    );
  }
  const done = Boolean(info.time.completed);
  const usage = done && info.tokens ? info.tokens.input + info.tokens.output + info.tokens.reasoning : 0;
  return (
    <View style={styles.assistant}>
      {parts.map((part) => (
        <PartView key={part.id} part={part} />
      ))}
      {info.error && info.error.name !== 'MessageAbortedError' ? <Note text={errorText(info.error)} tone="danger" /> : null}
      {info.error?.name === 'MessageAbortedError' ? <Note text="Stopped." /> : null}
      {done && info.modelID ? (
        <Text style={[styles.meta, { color: palette.textFaint }]}>
          {[info.modelID, usage ? `${formatTokens(usage)} tokens` : '', info.cost ? `$${info.cost.toFixed(info.cost < 0.01 ? 4 : 2)}` : ''].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  user: { alignSelf: 'flex-end', maxWidth: '88%', borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  userText: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  assistant: { gap: 10 },
  tool: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  toolHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  toolText: { flex: 1, gap: 2 },
  toolTitle: { fontFamily: fonts.medium, fontSize: 14 },
  toolSubject: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 17 },
  output: { maxHeight: 360, borderTopWidth: StyleSheet.hairlineWidth, padding: 10 },
  mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 17 },
  reasoningHead: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 2 },
  reasoningLabel: { fontFamily: fonts.medium, fontSize: 14 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
});
