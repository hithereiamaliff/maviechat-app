import { clock, timeOf, type DtAnnotation, type DtTranscriptSegment } from '@maviechat/deeptutor-protocol';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, radius, usePalette } from '@/theme';

/**
 * A video's or audio's transcript, segment by segment with its time. Tap a segment to make it
 * yours (the tutor hears where you are); long-press it to note it or ask about it. Your notes
 * sit under their segment.
 */
export function TranscriptView({
  segments,
  current,
  notes,
  onPick,
  onAction,
  onNotePress,
}: {
  segments: DtTranscriptSegment[];
  current: number;
  notes: DtAnnotation[];
  onPick: (segment: DtTranscriptSegment) => void;
  onAction: (segment: DtTranscriptSegment) => void;
  onNotePress: (note: DtAnnotation) => void;
}) {
  const palette = usePalette();
  return (
    <View style={styles.list}>
      {segments.map((segment) => {
        const on = segment.locator === current;
        const mine = notes.filter((note) => note.locator === segment.locator || timeOf(note.anchor) === segment.start);
        return (
          <View key={segment.locator}>
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Long press to note it or ask about it"
              onPress={() => onPick(segment)}
              onLongPress={() => onAction(segment)}
              style={({ pressed }) => [styles.segment, on && { backgroundColor: palette.surface }, pressed && { backgroundColor: palette.surfaceStrong }]}>
              <Text style={[styles.time, { color: on ? palette.link : palette.textMuted }]}>{clock(segment.start)}</Text>
              <Text style={[styles.text, { color: palette.text }]}>{segment.text}</Text>
            </Pressable>
            {mine.map((note) => (
              <Pressable key={note.id} accessibilityRole="button" onPress={() => onNotePress(note)} style={[styles.note, { borderLeftColor: palette.border }]}>
                <Text style={[styles.noteText, { color: palette.textMuted }]}>{note.note || note.quote}</Text>
              </Pressable>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 2 },
  segment: { flexDirection: 'row', gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: radius.md },
  time: { fontFamily: fonts.medium, fontSize: 13, minWidth: 44, paddingTop: 2 },
  text: { flex: 1, fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  note: { marginLeft: 64, marginBottom: 6, paddingLeft: 10, borderLeftWidth: 2 },
  noteText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19, fontStyle: 'italic' },
});
