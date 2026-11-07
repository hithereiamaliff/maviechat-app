import type { ModelItem, SourceRef } from '@maviechat/owui-protocol';
import {
  calloutOf,
  colonFenceLabel,
  inlineText,
  isClosedCodeBlock,
  lexMarkdown,
  tableCsv,
  type CalloutKind,
  type ColonFenceToken,
  type MentionToken,
  type Token,
  type Tokens,
} from '@maviechat/owui-markdown';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { memo, useContext, useMemo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View, type TextStyle } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { shareFile } from '@/features/settings/exportFile';
import { describeError } from '@/lib/errors';
import { openLink } from '@/lib/links';
import { fonts, radius, usePalette, type Palette } from '@/theme';
import { ChatDirectionContext, directionStyles } from './ChatDirectionContext';
import { CodeBlock } from './CodeBlock';
import { BlockMath, InlineMath } from './MathView';
import { fadeAlpha, fadingTail, useStreamFade, withAlpha, type StreamFade } from './streamFade';

interface MarkdownProps {
  text: string;
  /** Muted text for reasoning and other secondary content. */
  muted?: boolean;
  sources?: SourceRef[];
  baseUrl?: string;
  /** Lets relative image URLs on the server load with the session. */
  token?: string;
  /** Code blocks start folded. */
  foldCode?: boolean;
  /** Being written: new words fade in (the web's "Fade Effect for Streaming Text"). */
  fadeIn?: boolean;
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
  /** Hands a table's CSV to the share sheet (Save to Files, AirDrop…). */
  saveCsv: (csv: string, name: string) => void;
  foldCode: boolean;
  dark: boolean;
  /** The text token new words arrive in, while fading them in. */
  fade: { token: Token; start: number; state: StreamFade } | null;
  /** A chosen chat direction for text (none: automatic). */
  textDir?: TextStyle;
}

/** Renders markdown as native views (no web view). */
export const Markdown = memo(function Markdown({ text, muted = false, sources, baseUrl, token, foldCode = false, fadeIn = false }: MarkdownProps) {
  const palette = usePalette();
  const dark = useColorScheme() === 'dark';
  const toast = useToast();
  const models = useQueryClient().getQueryData<ModelItem[]>(['models']);
  const tokens = useMemo(() => lexMarkdown(text), [text]);
  const fadeState = useStreamFade(text, fadeIn);
  const tail = useMemo(() => (fadeIn ? fadingTail(tokens, text) : null), [fadeIn, tokens, text]);
  const direction = directionStyles(useContext(ChatDirectionContext));
  const context: Context = {
    palette,
    color: muted ? palette.textMuted : palette.text,
    sources: sources ?? [],
    baseUrl,
    token,
    models,
    // As on the web, tapping inline code copies it.
    copy: (code) => void Clipboard.setStringAsync(code).then(() => toast('Copied to clipboard')),
    // With a byte-order mark, as the web saves it, so spreadsheet apps read the text as UTF-8.
    saveCsv: (csv, name) => void shareFile(name, `\uFEFF${csv}`).catch((error: unknown) => toast(`Couldn't save the table: ${describeError(error)}`, 'error')),
    foldCode,
    dark,
    fade: tail && fadeState ? { ...tail, state: fadeState } : null,
    textDir: direction.text,
  };
  return <View style={direction.view}>{tokens.map((block, index) => renderBlock(block, `${index}`, context))}</View>;
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
      // A display formula ($$…$$, \[…\]) inside a paragraph gets a line of its own, as on the web.
      if (paragraph.tokens.some(isDisplayMath)) {
        const parts: ReactNode[] = [];
        let run: Token[] = [];
        const flush = (index: number) => {
          if (run.some((child) => child.type !== 'text' || (child as Tokens.Text).text.trim())) {
            parts.push(
              <Text key={`${key}.t${index}`} style={[styles.paragraph, { color }, context.textDir]}>
                {renderInline(run, `${key}.t${index}`, context)}
              </Text>,
            );
          }
          run = [];
        };
        paragraph.tokens.forEach((child, index) => {
          if (!isDisplayMath(child)) return void run.push(child);
          flush(index);
          parts.push(<BlockMath key={`${key}.m${index}`} tex={(child as unknown as { text: string }).text} color={color} />);
        });
        flush(paragraph.tokens.length);
        return <View key={key}>{parts}</View>;
      }
      return (
        <Text key={key} style={[styles.paragraph, { color }, context.textDir]}>
          {renderInline(paragraph.tokens, key, context)}
        </Text>
      );
    }
    case 'heading': {
      const heading = token as Tokens.Heading;
      return (
        <Text key={key} accessibilityRole="header" style={[styles.heading, headingSize(heading.depth), { color }, context.textDir]}>
          {renderInline(heading.tokens, key, context)}
        </Text>
      );
    }
    case 'code': {
      const code = token as Tokens.Code;
      return <CodeBlock key={key} code={code.text} lang={code.lang ?? undefined} complete={isClosedCodeBlock(code.raw)} folded={context.foldCode} />;
    }
    case 'blockquote': {
      const quote = token as Tokens.Blockquote;
      const callout = calloutOf(quote);
      if (callout) {
        const look = CALLOUTS[callout.kind];
        const tint = calloutColor(callout.kind, context);
        return (
          <View key={key} style={[styles.callout, { borderLeftColor: tint }]}>
            <View style={styles.calloutHeader}>
              <Icon name={look.icon} size={16} color={tint} strokeWidth={2} />
              <Text style={[styles.calloutLabel, { color: tint }]}>{look.label}</Text>
            </View>
            {callout.tokens.map((child, index) => renderBlock(child, `${key}.${index}`, context))}
          </View>
        );
      }
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
        <Text key={key} style={[styles.paragraph, { color }, context.textDir]}>
          {text}
        </Text>
      ) : null;
    }
    case 'text': {
      const textToken = token as Tokens.Text;
      return (
        <Text key={key} style={[styles.paragraph, { color }, context.textDir]}>
          {textToken.tokens ? renderInline(textToken.tokens, key, context) : textToken.text}
        </Text>
      );
    }
    case 'blockMath':
      return <BlockMath key={key} tex={(token as unknown as { text: string }).text} color={color} />;
    case 'colonFence': {
      const fence = token as unknown as ColonFenceToken;
      return (
        <View key={key} style={[styles.section, { borderColor: palette.border }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: palette.textMuted }]} numberOfLines={1}>
              {colonFenceLabel(fence)}
            </Text>
            <SmallAction icon="clipboard-document" label="Copy" accessibilityLabel="Copy this section" color={palette.textMuted} onPress={() => context.copy(fence.text)} />
          </View>
          {fence.tokens.map((child, index) => renderBlock(child, `${key}.${index}`, context))}
        </View>
      );
    }
    default:
      return 'raw' in token && token.raw.trim() ? (
        <Text key={key} style={[styles.paragraph, { color }, context.textDir]}>
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
  // Every row is a row of views, so columns line up only with a width each.
  const widths = columnWidths(table);
  const cellStyle = (index: number): TextStyle => {
    const align = table.align[index];
    return align ? { width: widths[index], textAlign: align } : { width: widths[index], ...context.textDir };
  };
  return (
    <View key={key} style={styles.tableWrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.table, { borderColor: palette.border }]}>
          <View style={[styles.tableRow, { backgroundColor: palette.surface, borderColor: palette.border }, table.rows.length === 0 && styles.lastRow]}>
            {table.header.map((cell, index) => (
              <Text key={index} style={[styles.cell, styles.headerCell, cellStyle(index), { color }]}>
                {renderInline(cell.tokens, `${key}.h${index}`, context)}
              </Text>
            ))}
          </View>
          {table.rows.map((row, rowIndex) => (
            <View key={rowIndex} style={[styles.tableRow, { borderColor: palette.border }, rowIndex === table.rows.length - 1 && styles.lastRow]}>
              {row.map((cell, index) => (
                <Text key={index} style={[styles.cell, cellStyle(index), { color }]}>
                  {renderInline(cell.tokens, `${key}.${rowIndex}.${index}`, context)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.tableActions}>
        <SmallAction icon="clipboard-document" label="Copy" accessibilityLabel="Copy the table" color={palette.textMuted} onPress={() => context.copy(table.raw.trim())} />
        <SmallAction
          icon="arrow-down-tray"
          label="Save as CSV"
          accessibilityLabel="Save the table as a CSV file"
          color={palette.textMuted}
          onPress={() => context.saveCsv(tableCsv(table), `table-${key.replace(/\./g, '-')}.csv`)}
        />
      </View>
    </View>
  );
}

/** A column's width from its longest line of text (about 7.6 points a character at 14 points, wide scripts double), within limits. */
function columnWidths(table: Tokens.Table): number[] {
  const measure = (text: string, factor = 1) =>
    Math.max(0, ...text.split('\n').map((line) => [...line].reduce((width, char) => width + ((char.codePointAt(0) ?? 0) >= 0x2e80 ? 14 : 7.6), 0) * factor));
  return table.header.map((header, index) => {
    const widest = Math.max(measure(inlineText(header.tokens), 1.08), ...table.rows.map((row) => measure(inlineText(row[index]?.tokens ?? []))));
    return Math.round(Math.min(280, Math.max(72, widest + 22)));
  });
}

function SmallAction({ icon, label, accessibilityLabel, color, onPress }: { icon: IconName; label: string; accessibilityLabel: string; color: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} hitSlop={8} onPress={onPress} style={styles.smallAction}>
      <Icon name={icon} size={14} color={color} strokeWidth={2} />
      <Text style={[styles.smallActionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const CALLOUTS: Record<CalloutKind, { label: string; icon: IconName }> = {
  note: { label: 'Note', icon: 'information-circle' },
  tip: { label: 'Tip', icon: 'light-bulb' },
  important: { label: 'Important', icon: 'star' },
  warning: { label: 'Warning', icon: 'exclamation-triangle' },
  caution: { label: 'Caution', icon: 'exclamation-circle' },
};

function calloutColor(kind: CalloutKind, { palette, dark }: Context): string {
  switch (kind) {
    case 'note':
      return palette.link;
    case 'tip':
      return palette.success;
    case 'important':
      return dark ? '#C084FC' : '#9333EA';
    case 'warning':
      return palette.warning;
    case 'caution':
      return palette.danger;
  }
}

function renderInline(tokens: Token[] | undefined, key: string, context: Context): ReactNode[] {
  if (!tokens) return [];
  const { palette } = context;
  return tokens.map((token, index) => {
    const k = `${key}-${index}`;
    switch (token.type) {
      case 'text': {
        const text = token as Tokens.Text;
        if (text.tokens) return <Text key={k}>{renderInline(text.tokens, k, context)}</Text>;
        if (context.fade && token === context.fade.token) return fadingWords(text.text, context.fade.start, context.fade.state, context.color, k);
        return text.text;
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
      case 'inlineMath': {
        const math = token as unknown as { text: string; display?: boolean };
        // Display maths inside a heading, list item or table cell stays in its line, at display size.
        return <InlineMath key={k} tex={math.text} display={math.display} color={context.color} />;
      }
      case 'html':
        return (token as Tokens.HTML).text.replace(/<[^>]+>/g, '');
      default:
        return 'raw' in token ? token.raw : null;
    }
  });
}

/** The words of the text being written, each at the opacity its fade has reached (spaces as they are). */
function fadingWords(text: string, start: number, fade: StreamFade, color: string, key: string): ReactNode[] {
  let offset = start;
  return text.split(/(\s+)/).map((part, index) => {
    const at = offset;
    offset += part.length;
    const alpha = part.trim() ? fadeAlpha(fade, at) : 1;
    return alpha >= 1 ? (
      part
    ) : (
      <Text key={`${key}.f${index}`} style={{ color: withAlpha(color, alpha) }}>
        {part}
      </Text>
    );
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

function isDisplayMath(token: Token): boolean {
  return token.type === 'inlineMath' && (token as unknown as { display?: boolean }).display === true;
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
  tableWrap: { marginVertical: 8, gap: 6 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  lastRow: { borderBottomWidth: 0 },
  cell: { paddingHorizontal: 10, paddingVertical: 8, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  headerCell: { fontFamily: fonts.semibold },
  tableActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, paddingRight: 2 },
  smallAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  smallActionText: { fontFamily: fonts.medium, fontSize: 12 },
  callout: { borderLeftWidth: 4, paddingLeft: 12, marginVertical: 6 },
  calloutHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 },
  calloutLabel: { fontFamily: fonts.medium, fontSize: 14 },
  section: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10, marginVertical: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionLabel: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 12 },
  image: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, marginVertical: 8 },
});
