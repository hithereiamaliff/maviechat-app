import { DT_MASTERY_MODES, masteryTitle, type DtMasteryMode, type DtMasteryTopic } from '@maviechat/deeptutor-protocol';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { fonts, radius, usePalette } from '@/theme';
import { MODE_LABELS, MODE_NOTES } from './pathChat';

interface PathBarProps {
  topic: DtMasteryTopic | undefined;
  mode: DtMasteryMode;
  /** Absent while you can't switch (a reply is running, or the chat isn't saved yet). */
  onMode?: (mode: DtMasteryMode) => void;
  onOpenPath: () => void;
}

/**
 * Above a mastery path's chat: the path (tap for its page) and how far along you are, then the
 * chat's mode. Study needs an outline, so it waits until the path has one.
 */
export function PathBar({ topic, mode, onMode, onOpenPath }: PathBarProps) {
  const palette = usePalette();
  const noOutline = topic ? topic.counts.total === 0 : false;
  return (
    <View style={[styles.wrap, { borderBottomColor: palette.border }]}>
      <Pressable accessibilityRole="button" accessibilityHint="Opens the path" onPress={onOpenPath} style={styles.top} hitSlop={4}>
        <Text style={styles.emoji}>{topic?.emoji ?? '🧭'}</Text>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
          {topic ? masteryTitle(topic) : 'Mastery Path'}
        </Text>
        {topic && topic.counts.total > 0 ? (
          <Text style={[styles.count, { color: palette.textMuted }]}>{`${topic.counts.mastered}/${topic.counts.total} mastered`}</Text>
        ) : null}
        <Icon name="chevron-right" size={14} color={palette.textFaint} />
      </Pressable>
      <View style={[styles.segments, { backgroundColor: palette.surface }]}>
        {DT_MASTERY_MODES.map((item) => {
          const on = item === mode;
          const disabled = !onMode || (item === 'study' && noOutline);
          return (
            <Pressable
              key={item}
              accessibilityRole="tab"
              accessibilityState={{ selected: on, disabled }}
              disabled={disabled || on}
              onPress={() => onMode?.(item)}
              style={[styles.segment, on && { backgroundColor: palette.background, borderColor: palette.border }]}>
              <Text style={[styles.segmentText, { color: on ? palette.text : disabled ? palette.textFaint : palette.textMuted }]}>{MODE_LABELS[item]}</Text>
            </Pressable>
          );
        })}
      </View>
      {mode !== 'study' ? <Text style={[styles.note, { color: palette.textMuted }]}>{MODE_NOTES[mode]}</Text> : null}
      {mode === 'study' && noOutline ? (
        <Text style={[styles.note, { color: palette.textMuted }]}>This path has no outline yet. Agree one in Outline first.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  emoji: { fontSize: 18 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 15 },
  count: { fontFamily: fonts.regular, fontSize: 12 },
  segments: { flexDirection: 'row', borderRadius: radius.md, padding: 3, gap: 3 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
  segmentText: { fontFamily: fonts.medium, fontSize: 13 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
});
