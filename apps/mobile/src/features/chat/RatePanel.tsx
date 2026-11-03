import { DISLIKE_REASONS, LIKE_REASONS, scoreAllowed, type ReplyAnnotation } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { fonts, radius, usePalette } from '@/theme';

/** Our words for the web's reason keys (the keys are what's stored). */
const REASON_LABELS: Record<string, string> = {
  accurate_information: 'Accurate',
  followed_instructions_perfectly: 'Followed my instructions',
  showcased_creativity: 'Creative',
  positive_attitude: 'Friendly tone',
  attention_to_detail: 'Careful with details',
  thorough_explanation: 'Explained well',
  dont_like_the_style: "Didn't like the style",
  too_verbose: 'Too long',
  not_helpful: 'Not helpful',
  not_factually_correct: 'Wrong facts',
  didnt_fully_follow_instructions: 'Missed my instructions',
  refused_when_it_shouldnt_have: 'Refused for no reason',
  being_lazy: 'Too little effort',
  other: 'Something else',
};

interface RatePanelProps {
  annotation: ReplyAnnotation;
  onSave: (details: Partial<ReplyAnnotation>) => Promise<boolean>;
  onClose: () => void;
}

/**
 * After 👍 or 👎, as on the web: a score out of 10 (6–10 or 1–5, by the thumb), one reason and a
 * comment, saved with the rating.
 */
export function RatePanel({ annotation, onSave, onClose }: RatePanelProps) {
  const palette = usePalette();
  const [score, setScore] = useState<number | null>(annotation.details?.rating ?? null);
  const [reason, setReason] = useState<string>(annotation.reason ?? '');
  const [comment, setComment] = useState(annotation.comment ?? '');
  const [busy, setBusy] = useState(false);
  const reasons: readonly string[] = annotation.rating === -1 ? DISLIKE_REASONS : LIKE_REASONS;

  const save = async () => {
    setBusy(true);
    const done = await onSave({ reason, comment: comment.trim(), details: { rating: score } });
    setBusy(false);
    if (done) onClose();
  };

  return (
    <View style={[styles.panel, { borderColor: palette.border }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>{annotation.rating === -1 ? 'What went wrong?' : 'What did you like?'}</Text>
        <IconButton icon="x-mark" label="Close" size={18} color={palette.textMuted} onPress={onClose} />
      </View>
      <Text style={[styles.label, { color: palette.textMuted }]}>Score out of 10</Text>
      <View style={styles.scores}>
        {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => {
          const allowed = scoreAllowed(annotation.rating, value);
          const selected = value === score;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={`${value} out of 10`}
              accessibilityState={{ selected, disabled: !allowed }}
              disabled={!allowed}
              onPress={() => setScore(selected ? null : value)}
              style={[
                styles.score,
                { borderColor: palette.border, opacity: allowed ? 1 : 0.35 },
                selected && { backgroundColor: palette.active, borderColor: palette.active },
              ]}>
              <Text style={[styles.scoreText, { color: selected ? palette.onActive : palette.text }]}>{value}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.label, { color: palette.textMuted }]}>Why</Text>
      <View style={styles.reasons}>
        {reasons.map((key) => {
          const selected = key === reason;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setReason(selected ? '' : key)}
              style={[styles.reason, { borderColor: palette.border }, selected && { backgroundColor: palette.surfaceStrong }]}>
              <Text style={[styles.reasonText, { color: palette.text }]}>{REASON_LABELS[key] ?? key}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="Anything else? (optional)"
        placeholderTextColor={palette.textFaint}
        multiline
        textAlignVertical="top"
        style={[styles.comment, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
        accessibilityLabel="Comment"
      />
      <Button label="Save" onPress={() => void save()} loading={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 14, gap: 10, marginTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.semibold, fontSize: 15 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  scores: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  score: { width: 30, height: 30, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  scoreText: { fontFamily: fonts.medium, fontSize: 13 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reason: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  reasonText: { fontFamily: fonts.regular, fontSize: 13 },
  comment: { minHeight: 64, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: 10, fontFamily: fonts.regular, fontSize: 14 },
});
