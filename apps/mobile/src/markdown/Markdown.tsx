import type { ModelItem, SourceRef } from '@maviechat/owui-protocol';
import { lexMarkdown, type MentionToken, type Token, type Tokens } from '@maviechat/owui-markdown';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { memo, useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { openLink } from '@/lib/links';
import { fonts, radius, usePalette, type Palette } from '@/theme';
import { CodeBlock } from './CodeBlock';

interface MarkdownProps {
  text: string;
  /** Muted text for reasoning and other secondary content. */
  muted?: boolean;
  sources?: SourceRef[];
  baseUrl?: string;
  /** Lets relative image URLs on the server load with the session. */
  token?: string;
}

interface Context {
  palette: Palette;
  color: string;
  sources: SourceRef[];
  baseUrl?: string;
  token?: string;
  /** For `@M:` mentions; undefined until the model list has loaded. */
  models?: ModelItem[];
  copy: (text: string) => void;
}

/** Renders markdown as native views (no web view). */
export const Markdown = memo(function Markdown({ text, muted = false, sources, baseUrl, token }: MarkdownProps) {
  const palette = usePalette();
  const toast = useToast();
  const models = useQueryClient().getQueryData<ModelItem[]>(['models']);
  const tokens = useMemo(() => lexMarkdown(text), [text]);
  const context: Context = {
    palette,
    color: muted ? palette.textMuted : palette.text,
    sources: sources ?? [],
    baseUrl,
    token,
    models,
    // As on the web, tapping inline code copies it.
    copy: (code) => void Clipboard.setStringAsync(code).then(() => toast('Copied to clipboard')),
  };
  return <View>{tokens.map((block, index) => renderBlock(block, `${index}`, context))}</View>;
});

function renderBlock(token: Token, key: string, context: Context): ReactNode {
  const { palette, color } = context;
  switch (token.type) {
    case 'space':
    case 'def':
      return null;
    case 'paragraph': {
      const paragraph = token as Tokens.Paragraph;
      const only = paragraph.tokens.length === 1 ? paragraph.tokens[0] : undefined;
      if (only?.type === 'image') return <MarkdownImage key={key} token={only as Tokens.Image} context={context} />;
      return (
        <Text key={key} style={[styles.paragraph, { color }]}>
          {renderInline(paragraph.tokens, key, context)}
        </Text>
      );
    }
    case 'heading': {
      const heading = token as Tokens.Heading;
      return (
        <Text key={key} accessibilityRole="header" style={[styles.heading, headingSize(heading.depth), { color }]}>
          {renderInline(heading.tokens, key, context)}
        </Text>
      );
    }
    case 'code': {
      const code = token as Tokens.Code;
      return <CodeBlock key={key} code={code.text} lang={code.lang ?? undefined} />;
    }
    case 'blockquote': {
      const quote = token as Tokens.Blockquote;
      return (
        <View key={key} style={[styles.quote, { borderLeftColor: palette.border }]}>
          {quote.tokens.map((child, index) => renderBlock(child, `${key}.${index}`, { ...context, color: palette.textMuted }))}
        </View>
      );
    }
    case 'list':
      return renderList(token as Tokens.List, key, context);
    case 'table':
      return renderTable(token as Tokens.Table, key, context);
    case 'hr':
      return <View key={key} style={[styles.rule, { backgroundColor: palette.border }]} />;
    case 'html': {
      const text = (token as Tokens.HTML).text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
      return text ? (
        <Text key={key} style={[styles.paragraph, { color }]}>
          {text}
        </Text>
      ) : null;
    }
    case 'text': {
      const textToken = token as Tokens.Text;
      return (
        <Text key={key} style={[styles.paragraph, { color }]}>
          {textToken.tokens ? renderInline(textToken.tokens, key, context) : textToken.text}
        </Text>
      );
    }
    case 'blockMath':
      return (
        <View key={key} style={[styles.math, { backgroundColor: palette.surface }]}>
          <Text style={[styles.mathText, { color }]}>{(token as unknown as { text: string }).text}</Text>
        </View>
      );
    default:
      return 'raw' in token && token.raw.trim() ? (
        <Text key={key} style={[styles.paragraph, { color }]}>
          {token.raw}
        </Text>
      ) : null;
  }
}

function renderList(list: Tokens.List, key: string, context: Context): ReactNode {
  const start = typeof list.start === 'number' ? list.start : 1;
  return (
    <View key={key} style={styles.list}>
      {list.items.map((item, index) => (
        <View key={`${key}.${index}`} style={styles.listItem}>
          {item.task ? (
            <View style={[styles.checkbox, { borderColor: context.palette.textMuted }]}>
              {item.checked ? <Icon name="check" size={12} color={context.color} strokeWidth={2.5} /> : null}
            </View>
          ) : (
            <Text style={[styles.bullet, { color: context.palette.textMuted }]}>{list.ordered ? `${start + index}.` : '•'}</Text>
          )}
          <View style={styles.listBody}>
            {item.tokens
              .filter((child) => child.type !== 'checkbox')
              .map((child, childIndex) => renderBlock(child, `${key}.${index}.${childIndex}`, context))}
          </View>
        </View>
      ))}
    </View>
  );
}

function renderTable(table: Tokens.Table, key: string, context: Context): ReactNode {
  const { palette, color } = context;
  return (
    <ScrollView key={key} horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
      <View style={[styles.table, { borderColor: palette.border }]}>
        <View style={[styles.tableRow, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {table.header.map((cell, index) => (
            <Text key={index} style={[styles.cell, styles.headerCell, { color }]}>
              {renderInline(cell.tokens, `${key}.h${index}`, context)}
            </Text>
          ))}
        </View>
        {table.rows.map((row, rowIndex) => (
          <View key={rowIndex} style={[styles.tableRow, { borderColor: palette.border }]}>
            {row.map((cell, index) => (
              <Text key={index} style={[styles.cell, { color }]}>
                {renderInline(cell.tokens, `${key}.${rowIndex}.${index}`, context)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function renderInline(tokens: Token[] | undefined, key: string, context: Context): ReactNode[] {
  if (!tokens) return [];
  const { palette } = context;
  return tokens.map((token, index) => {
    const k = `${key}-${index}`;
    switch (token.type) {
      case 'text': {
        const text = token as Tokens.Text;
        return text.tokens ? <Text key={k}>{renderInline(text.tokens, k, context)}</Text> : text.text;
      }
      case 'escape':
        return (token as Tokens.Escape).text;
      case 'strong':
        return (
          <Text key={k} style={styles.strong}>
            {renderInline((token as Tokens.Strong).tokens, k, context)}
          </Text>
        );
      case 'em':
        return (
          <Text key={k} style={styles.em}>
            {renderInline((token as Tokens.Em).tokens, k, context)}
          </Text>
        );
      case 'del':
        return (
          <Text key={k} style={styles.del}>
            {renderInline((token as Tokens.Del).tokens, k, context)}
          </Text>
        );
      case 'codespan': {
        const code = decodeCode((token as Tokens.Codespan).text);
        return (
          <Text
            key={k}
            accessibilityHint="Copies the code"
            onPress={() => context.copy(code)}
            style={[styles.codespan, { backgroundColor: palette.surfaceStrong }]}>
            {code}
          </Text>
        );
      }
      case 'br':
        return '\n';
      case 'link': {
        const link = token as Tokens.Link;
        return (
          <Text key={k} accessibilityRole="link" style={{ color: palette.link }} onPress={() => void openLink(link.href, context.baseUrl)}>
            {renderInline(link.tokens, k, context)}
          </Text>
        );
      }
      case 'image': {
        const image = token as Tokens.Image;
        return (
          <Text key={k} style={{ color: palette.link }} onPress={() => void openLink(image.href, context.baseUrl)}>
            {image.text || 'image'}
          </Text>
        );
      }
      case 'citation': {
        const ids = (token as unknown as { ids: number[] }).ids;
        const first = context.sources.find((source) => source.index === ids[0]);
        return (
          <Text
            key={k}
            style={[styles.citation, { backgroundColor: palette.surfaceStrong, color: palette.textMuted }]}
            onPress={first?.url ? () => void openLink(first.url as string) : undefined}>
            {` ${ids.join(', ')} `}
          </Text>
        );
      }
      case 'footnote': {
        const id = (token as unknown as { id: string }).id;
        const raised = superscript(id);
        return (
          <Text key={k} accessibilityLabel={`footnote ${id}`} style={[!raised && styles.footnote, { color: palette.textMuted }]}>
            {raised ?? id}
          </Text>
        );
      }
      case 'mention': {
        const mention = token as unknown as MentionToken;
        return (
          <Text key={k} style={[styles.mention, { color: palette.link }]}>
            {mention.trigger}
            {mentionLabel(mention, context.models)}
          </Text>
        );
      }
      case 'inlineMath':
        return (
          <Text key={k} style={styles.mathInline}>
            {(token as unknown as { text: string }).text}
          </Text>
        );
      case 'html':
        return (token as Tokens.HTML).text.replace(/<[^>]+>/g, '');
      default:
        return 'raw' in token ? token.raw : null;
    }
  });
}

function MarkdownImage({ token, context }: { token: Tokens.Image; context: Context }) {
  const uri = /^(https?:|data:)/i.test(token.href) || !context.baseUrl ? token.href : new URL(token.href, `${context.baseUrl}/`).toString();
  const sameServer = context.baseUrl ? uri.startsWith(context.baseUrl) : false;
  return (
    <Image
      accessibilityLabel={token.text || 'Image'}
      source={{ uri, headers: sameServer && context.token ? { Authorization: `Bearer ${context.token}` } : undefined }}
      style={[styles.image, { backgroundColor: context.palette.surface }]}
      contentFit="contain"
    />
  );
}

function headingSize(depth: number): TextStyle {
  if (depth <= 1) return { fontSize: 22, lineHeight: 30 };
  if (depth === 2) return { fontSize: 19, lineHeight: 27 };
  if (depth === 3) return { fontSize: 17, lineHeight: 25 };
  return { fontSize: 16, lineHeight: 24 };
}

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** Footnote numbers drawn raised; other ids are shown small. */
function superscript(id: string): string | null {
  return /^\d+$/.test(id) ? [...id].map((digit) => SUPERSCRIPT_DIGITS[Number(digit)]).join('') : null;
}

/** A mention's text, as the web shows it: `@M:` mentions name the model (or "Unknown"); others use their label. */
function mentionLabel(mention: MentionToken, models: ModelItem[] | undefined): string {
  if (mention.trigger !== '@' || !mention.id.startsWith('M:')) return mention.label;
  const model = models?.find((item) => item.id === mention.id.slice(2));
  return model?.name ?? (models ? 'Unknown' : mention.label);
}

/** marked escapes HTML inside code spans; show the characters as written. */
function decodeCode(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

const styles = StyleSheet.create({
  paragraph: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 25, marginVertical: 5 },
  heading: { fontFamily: fonts.semibold, marginTop: 14, marginBottom: 4 },
  strong: { fontFamily: fonts.semibold },
  em: { fontStyle: 'italic' },
  del: { textDecorationLine: 'line-through' },
  codespan: { fontFamily: fonts.mono, fontSize: 14 },
  citation: { fontFamily: fonts.medium, fontSize: 12 },
  footnote: { fontSize: 11 },
  mention: { fontFamily: fonts.medium },
  quote: { borderLeftWidth: 3, paddingLeft: 12, marginVertical: 6 },
  list: { marginVertical: 4, gap: 2 },
  listItem: { flexDirection: 'row', gap: 8 },
  bullet: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 25, minWidth: 16, marginVertical: 5 },
  listBody: { flex: 1 },
  checkbox: {
    width: 16,
    height: 16,
    marginTop: 10,
    borderWidth: 1.5,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
  tableScroll: { marginVertical: 8 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { minWidth: 96, maxWidth: 260, paddingHorizontal: 10, paddingVertical: 8, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  headerCell: { fontFamily: fonts.semibold },
  math: { borderRadius: radius.md, padding: 12, marginVertical: 8 },
  mathText: { fontFamily: fonts.mono, fontSize: 14, textAlign: 'center' },
  mathInline: { fontFamily: fonts.mono, fontSize: 14 },
  image: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, marginVertical: 8 },
});
