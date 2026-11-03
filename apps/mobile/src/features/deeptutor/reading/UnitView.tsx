import { highlightRanges, imageMarkers, materialImageUrl, textBlocks, type DtAnnotation, type DtTextBlock } from '@maviechat/deeptutor-protocol';
import { Image } from 'expo-image';
import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Markdown } from '@/markdown/Markdown';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { HIGHLIGHT_TINTS } from './labels';

export interface UnitViewProps {
  materialId: string;
  /** The unit's text as DeepTutor keeps it. */
  text: string;
  /** Web pages and Markdown files are Markdown; everything else is shown as written. */
  markdown: boolean;
  /** This unit's highlights and notes. */
  annotations: DtAnnotation[];
  /** Long-pressing a paragraph: highlight it, note it, ask about it… */
  onBlockAction: (block: DtTextBlock, marks: DtAnnotation[]) => void;
  onMarkPress: (annotation: DtAnnotation) => void;
}

/** A figure from the material (a PDF's), sized to its own shape once it loads. */
function MaterialImage({ materialId, name }: { materialId: string; name: string }) {
  const palette = usePalette();
  const { session } = useDtAuthed();
  const [ratio, setRatio] = useState(4 / 3);
  return (
    <Image
      accessibilityLabel="Figure"
      source={{ uri: materialImageUrl(session.baseUrl, materialId, name), headers: { Authorization: `Bearer ${session.token}` } }}
      onLoad={(event) => {
        if (event.source.width && event.source.height) setRatio(event.source.width / event.source.height);
      }}
      contentFit="contain"
      style={[styles.image, { aspectRatio: ratio, backgroundColor: palette.surface }]}
    />
  );
}

/**
 * One unit of a material (a page, chapter, section…), paragraph by paragraph. Highlights show
 * where they are (a Markdown paragraph is tinted as a whole); long-press a paragraph for what you
 * can do with it.
 */
export const UnitView = memo(function UnitView({ materialId, text, markdown, annotations, onBlockAction, onMarkPress }: UnitViewProps) {
  const palette = usePalette();
  const { session } = useDtAuthed();
  const blocks = useMemo(() => textBlocks(text), [text]);
  const ranges = useMemo(() => highlightRanges(text, annotations), [text, annotations]);
  const tint = (annotation: DtAnnotation) => HIGHLIGHT_TINTS[annotation.color] ?? HIGHLIGHT_TINTS.yellow;

  if (!blocks.length) return <Text style={[styles.empty, { color: palette.textMuted }]}>This part has no text.</Text>;

  return (
    <View style={styles.unit}>
      {blocks.map((block) => {
        const inside = ranges.filter((range) => range.start < block.end && range.end > block.start);
        const marks = inside.map((range) => range.annotation);
        const noted = marks.find((mark) => mark.note);
        const action = () => onBlockAction(block, marks);

        if (markdown) {
          return (
            <Pressable
              key={block.start}
              onLongPress={action}
              onPress={marks[0] ? () => onMarkPress(marks[0] as DtAnnotation) : undefined}
              accessibilityHint="Long press for highlight, note and the tutor"
              style={[styles.block, marks[0] ? [styles.marked, { backgroundColor: tint(marks[0]) }] : null]}>
              <Markdown text={block.text} baseUrl={session.baseUrl} token={session.token} />
              {noted ? <Text style={[styles.note, { color: palette.textMuted }]}>{`Note: ${noted.note}`}</Text> : null}
            </Pressable>
          );
        }

        // Plain text: the highlights' own words are tinted; figures sit under their paragraph.
        const parts = imageMarkers(block.text);
        const images = parts.filter((part) => part.type === 'image');
        const words = parts.filter((part) => part.type === 'text').length;
        const spans: { start: number; end: number; mark: DtAnnotation | null }[] = [];
        let cursor = block.start;
        for (const range of inside) {
          const start = Math.max(range.start, block.start, cursor);
          const end = Math.min(range.end, block.end);
          if (end <= start) continue;
          if (start > cursor) spans.push({ start: cursor, end: start, mark: null });
          spans.push({ start, end, mark: range.annotation });
          cursor = end;
        }
        if (cursor < block.end) spans.push({ start: cursor, end: block.end, mark: null });
        return (
          <View key={block.start} style={styles.block}>
            {words ? (
              <Text style={[styles.text, { color: palette.text }]} onLongPress={action} suppressHighlighting>
                {spans.map((span) => {
                  const piece = text.slice(span.start, span.end).replace(/\[图片 \d+: [^\]\s]+\]/g, '');
                  return span.mark ? (
                    <Text key={span.start} style={{ backgroundColor: tint(span.mark) }} onPress={() => onMarkPress(span.mark as DtAnnotation)}>
                      {piece}
                    </Text>
                  ) : (
                    <Text key={span.start}>{piece}</Text>
                  );
                })}
              </Text>
            ) : null}
            {images.map((image, index) => (image.type === 'image' ? <MaterialImage key={`${image.name}-${index}`} materialId={materialId} name={image.name} /> : null))}
            {noted ? <Text style={[styles.note, { color: palette.textMuted }]}>{`Note: ${noted.note}`}</Text> : null}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  unit: { gap: 14 },
  block: { gap: 8 },
  marked: { borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 4, marginHorizontal: -8 },
  text: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 26 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, fontStyle: 'italic' },
  image: { width: '100%', borderRadius: radius.md },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 24 },
});
