import { highlightCode } from '@maviechat/owui-markdown';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { memo, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { fonts, radius, usePalette, useSyntaxColors } from '@/theme';
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
 * (with the code a tap away), and HTML and SVG blocks offer a preview, as on the web.
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
          {view === 'preview' ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Preview" hitSlop={8} onPress={() => setPreviewing(true)} style={styles.action}>
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
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Text selectable style={[styles.code, { color: palette.text }]}>
            {shown.map((line, index) => (
              <Text key={index}>
                {line.map((span, spanIndex) => (
                  <Text key={spanIndex} style={span.scope ? { color: syntax[span.scope] ?? syntax[span.scope.split('.')[0] ?? ''] } : undefined}>
                    {span.text}
                  </Text>
                ))}
                {index < shown.length - 1 ? '\n' : ''}
              </Text>
            ))}
          </Text>
        </ScrollView>
      )}
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

const styles = StyleSheet.create({
  block: {
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
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
});
