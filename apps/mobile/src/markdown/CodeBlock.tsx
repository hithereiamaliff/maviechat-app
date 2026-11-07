import { diffLineKind, highlightCode, isDiffBlock, type CodeLine } from '@maviechat/owui-markdown';
import { isPythonBlock } from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { memo, useContext, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { describeError } from '@/lib/errors';
import { fonts, radius, usePalette, useSyntaxColors, type Palette, type SyntaxColors } from '@/theme';
import { ArtifactsContext } from './ArtifactsContext';
import { CodeRunContext, type CodeRun } from './CodeRunContext';
import { codeView, mermaidPage, previewPage, vegaPage } from './webPages';
import { WebFrame } from './WebFrame';

interface CodeBlockProps {
  code: string;
  lang?: string;
  /** Shown instead of the language in the header (e.g. "Input", "Output"). */
  title?: string;
  /** False while the block is still streaming: diagrams and previews wait for all of it. */
  complete?: boolean;
  /** Starts folded to its first line (Open WebUI's "always collapse code blocks"). */
  folded?: boolean;
}

/**
 * A code block, highlighted, with Copy and Collapse. Mermaid and Vega blocks draw as diagrams
 * (with the code a tap away), HTML and SVG blocks offer a preview, Python blocks a Run where the
 * chat allows it, and diffs show their added and removed lines, as on the web.
 */
export const CodeBlock = memo(function CodeBlock({ code, lang, title, complete = true, folded = false }: CodeBlockProps) {
  const palette = usePalette();
  const syntax = useSyntaxColors();
  const dark = useColorScheme() === 'dark';
  const lines = useMemo(() => highlightCode(code.replace(/\n$/, ''), lang), [code, lang]);
  const [collapsed, setCollapsed] = useState(folded);
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const openArtifact = useContext(ArtifactsContext);
  const runCode = useContext(CodeRunContext);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<CodeRun | null>(null);
  const runnable = runCode !== null && complete && isPythonBlock(lang, code);
  const diff = useMemo(() => isDiffBlock(lang, code), [lang, code]);
  const view = complete ? codeView(lang, code) : null;
  const diagram = useMemo(() => (view === 'mermaid' ? mermaidPage(code, dark) : view === 'vega' ? vegaPage(code, dark) : null), [view, code, dark]);
  const drawing = diagram !== null && !showCode;
  const shown = collapsed ? lines.slice(0, 1) : lines;

  const copy = async () => {
    await Clipboard.setStringAsync(code);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const startRun = async () => {
    if (!runCode || running) return;
    setRunning(true);
    setRun(null);
    try {
      setRun(await runCode(code));
    } catch (error) {
      setRun({ stdout: '', stderr: describeError(error), result: null, images: [] });
    } finally {
      setRunning(false);
    }
  };

  return (
    <View style={[styles.block, { backgroundColor: palette.codeBackground, borderColor: palette.border }]}>
      <View style={[styles.header, { backgroundColor: palette.codeHeader }]}>
        <Text style={[styles.lang, { color: palette.textMuted }]} numberOfLines={1}>
          {title ?? (lang?.split(/\s+/)[0] || 'code')}
        </Text>
        <View style={styles.actions}>
          {diagram ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={drawing ? 'Show the code' : 'Show the diagram'}
              hitSlop={8}
              onPress={() => setShowCode((value) => !value)}
              style={styles.action}>
              <Icon name={drawing ? 'code-bracket' : 'chart-bar'} size={14} color={palette.textMuted} strokeWidth={2} />
              <Text style={[styles.actionText, { color: palette.textMuted }]}>{drawing ? 'Code' : 'Diagram'}</Text>
            </Pressable>
          ) : null}
          {runnable ? (
            <Pressable accessibilityRole="button" accessibilityLabel={running ? 'Running the code' : 'Run the code'} disabled={running} hitSlop={8} onPress={() => void startRun()} style={styles.action}>
              {running ? <ActivityIndicator size="small" color={palette.textMuted} style={styles.spinner} /> : <Icon name="play" size={14} color={palette.textMuted} strokeWidth={2} />}
              <Text style={[styles.actionText, { color: palette.textMuted }]}>{running ? 'Running…' : 'Run'}</Text>
            </Pressable>
          ) : null}
          {view === 'preview' ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Preview" hitSlop={8} onPress={() => (openArtifact?.(code) ? undefined : setPreviewing(true))} style={styles.action}>
              <Icon name="arrows-pointing-out" size={14} color={palette.textMuted} strokeWidth={2} />
              <Text style={[styles.actionText, { color: palette.textMuted }]}>Preview</Text>
            </Pressable>
          ) : null}
          {lines.length > 1 && !drawing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={collapsed ? 'Expand code' : 'Collapse code'}
              hitSlop={8}
              onPress={() => setCollapsed((value) => !value)}
              style={styles.action}>
              <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={14} color={palette.textMuted} strokeWidth={2} />
              <Text style={[styles.actionText, { color: palette.textMuted }]}>
                {collapsed ? `${lines.length - 1} more lines` : 'Collapse'}
              </Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Copy code" hitSlop={8} onPress={() => void copy()} style={styles.action}>
            <Icon name={copied ? 'check' : 'clipboard-document'} size={14} color={palette.textMuted} strokeWidth={2} />
            <Text style={[styles.actionText, { color: palette.textMuted }]}>{copied ? 'Copied' : 'Copy'}</Text>
          </Pressable>
        </View>
      </View>
      {drawing && diagram ? (
        <View style={styles.diagram}>
          <WebFrame html={diagram} initialHeight={200} />
        </View>
      ) : diff ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.diffScroll}>
          <View style={styles.diffLines}>
            {shown.map((line, index) => {
              const kind = diffLineKind(line.map((span) => span.text).join(''));
              return (
                <Text key={index} selectable style={[styles.code, styles.diffLine, { color: palette.text }, kind ? diffLook(kind, dark, palette) : undefined]}>
                  {line.length ? <Spans line={line} syntax={syntax} /> : ' '}
                </Text>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Text selectable style={[styles.code, { color: palette.text }]}>
            {shown.map((line, index) => (
              <Text key={index}>
                <Spans line={line} syntax={syntax} />
                {index < shown.length - 1 ? '\n' : ''}
              </Text>
            ))}
          </Text>
        </ScrollView>
      )}
      {!collapsed && (running || run) ? (
        <View style={[styles.output, { borderTopColor: palette.border }]}>
          {running ? <Text style={[styles.outputLabel, { color: palette.textMuted }]}>Running…</Text> : run ? <RunOutput run={run} /> : null}
        </View>
      ) : null}
      {view === 'preview' ? (
        <Modal visible={previewing} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPreviewing(false)}>
          <View style={[styles.sheet, { backgroundColor: palette.background }]}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: palette.text }]} accessibilityRole="header">
                Preview
              </Text>
              <Pressable accessibilityRole="button" onPress={() => setPreviewing(false)} hitSlop={8}>
                <Text style={[styles.done, { color: palette.link }]}>Done</Text>
              </Pressable>
            </View>
            {previewing ? <WebFrame html={previewPage(code, dark)} fill /> : null}
          </View>
        </Modal>
      ) : null}
    </View>
  );
});

function Spans({ line, syntax }: { line: CodeLine; syntax: SyntaxColors }) {
  return line.map((span, index) => (
    <Text key={index} style={span.scope ? { color: syntax[span.scope] ?? syntax[span.scope.split('.')[0] ?? ''] } : undefined}>
      {span.text}
    </Text>
  ));
}

/** Added lines green, removed lines red, hunk headers in the link colour, file headers muted. */
function diffLook(kind: NonNullable<ReturnType<typeof diffLineKind>>, dark: boolean, palette: Palette) {
  switch (kind) {
    case 'added':
      return { backgroundColor: dark ? 'rgba(46, 160, 67, 0.2)' : 'rgba(46, 160, 67, 0.13)' };
    case 'removed':
      return { backgroundColor: dark ? 'rgba(248, 81, 73, 0.2)' : 'rgba(248, 81, 73, 0.12)' };
    case 'hunk':
      return { color: palette.link };
    case 'file':
      return { color: palette.textMuted };
  }
}

/** A run's printed text, errors, last value and pictures, under the code (as the web shows them). */
function RunOutput({ run }: { run: CodeRun }) {
  const palette = usePalette();
  const result = run.result === null || run.result === undefined ? '' : typeof run.result === 'string' ? run.result : JSON.stringify(run.result, null, 2);
  const parts: { label: string; text: string; color: string }[] = [
    { label: 'Output', text: run.stdout.replace(/\n+$/, ''), color: palette.text },
    { label: 'Errors', text: run.stderr.replace(/\n+$/, ''), color: palette.danger },
    { label: 'Result', text: result, color: palette.text },
  ].filter((part) => part.text.trim());
  if (!parts.length && !run.images.length) return <Text style={[styles.outputLabel, { color: palette.textMuted }]}>Ran without output.</Text>;
  return (
    <View style={styles.outputParts}>
      {parts.map((part) => (
        <View key={part.label}>
          <Text style={[styles.outputLabel, { color: palette.textMuted }]}>{part.label}</Text>
          <ScrollView style={styles.outputScroll} nestedScrollEnabled>
            <Text selectable style={[styles.outputText, { color: part.color }]}>
              {part.text}
            </Text>
          </ScrollView>
        </View>
      ))}
      {run.images.map((uri, index) => (
        <OutputImage key={index} uri={uri} />
      ))}
    </View>
  );
}

function OutputImage({ uri }: { uri: string }) {
  const palette = usePalette();
  const [aspect, setAspect] = useState(4 / 3);
  return (
    <Image
      accessibilityLabel="Output picture"
      source={{ uri }}
      contentFit="contain"
      onLoad={(event) => {
        if (event.source.width > 0 && event.source.height > 0) setAspect(event.source.width / event.source.height);
      }}
      style={[styles.outputImage, { aspectRatio: aspect, backgroundColor: palette.background }]}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    // Code reads left to right whatever the chat's direction.
    direction: 'ltr',
    marginVertical: 8,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    gap: 8,
  },
  lang: {
    flexShrink: 1,
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  scroll: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  code: {
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 20,
  },
  diagram: {
    padding: 8,
  },
  spinner: { transform: [{ scale: 0.7 }], width: 14, height: 14 },
  diffScroll: { flexGrow: 1, paddingVertical: 10 },
  diffLines: { flexGrow: 1 },
  diffLine: { paddingHorizontal: 12 },
  output: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 10 },
  outputParts: { gap: 10 },
  outputLabel: { fontFamily: fonts.medium, fontSize: 12, marginBottom: 4 },
  outputScroll: { maxHeight: 320 },
  outputText: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 19 },
  outputImage: { width: '100%', borderRadius: radius.sm },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
});
