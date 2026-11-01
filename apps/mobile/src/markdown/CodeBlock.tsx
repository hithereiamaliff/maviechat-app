import { highlightCode } from '@maviechat/owui-markdown';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { fonts, radius, usePalette, useSyntaxColors } from '@/theme';

interface CodeBlockProps {
  code: string;
  lang?: string;
  /** Shown instead of the language in the header (e.g. "Input", "Output"). */
  title?: string;
}

export const CodeBlock = memo(function CodeBlock({ code, lang, title }: CodeBlockProps) {
  const palette = usePalette();
  const syntax = useSyntaxColors();
  const lines = useMemo(() => highlightCode(code.replace(/\n$/, ''), lang), [code, lang]);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
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
          {lines.length > 1 ? (
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
});
