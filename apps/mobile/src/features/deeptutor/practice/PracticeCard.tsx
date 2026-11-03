import {
  answerKind,
  checkPracticeAnswer,
  choiceAnswer,
  DtHttpError,
  randomId,
  reviewPracticeQuestion,
  type DtPracticeQuestion,
  type DtPracticeRating,
  type DtReviewInput,
  type DtReviewOutcome,
} from '@maviechat/deeptutor-protocol';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { describeError } from '@/lib/errors';
import { Markdown } from '@/markdown/Markdown';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { correctKeys } from './round';

/** The four ratings for questions DeepTutor can't check, in our words. */
const RATINGS: { value: DtPracticeRating; label: string; hint: string }[] = [
  { value: 'again', label: 'Again', hint: 'Not yet: again this round' },
  { value: 'hard', label: 'Hard', hint: 'Got there with effort' },
  { value: 'good', label: 'Good', hint: 'Got it' },
  { value: 'easy', label: 'Easy', hint: 'Knew it well' },
];

interface PracticeCardProps {
  item: DtPracticeQuestion;
  /** "2 of 8". */
  position: string;
  onReviewed: (rating: DtPracticeRating, outcome: DtReviewOutcome) => void;
  onSkip: () => void;
}

/**
 * One practice question: answer it (choices or your own words), check it, then rate how it went.
 * Choice questions are checked by DeepTutor, so right means "Next" and wrong means "Practise
 * Again"; written ones you compare with DeepTutor's answer and rate yourself.
 */
export function PracticeCard({ item, position, onReviewed, onSkip }: PracticeCardProps) {
  const palette = usePalette();
  const { client, session } = useDtAuthed();
  const entry = item.entry;
  const kind = answerKind(entry);
  const options = Object.entries(entry.options ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const right = correctKeys(entry);
  const [picked, setPicked] = useState<string[]>([]);
  const [written, setWritten] = useState('');
  // undefined: not revealed yet; null: DeepTutor can't check it, so you compare.
  const [verdict, setVerdict] = useState<boolean | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  // A review whose answer got lost is retried with the same id and payload, so only that rating stays open.
  const [pendingRating, setPendingRating] = useState<DtPracticeRating | null>(null);
  const submission = useRef<DtReviewInput | null>(null);
  const answer = kind === 'written' ? written : choiceAnswer(picked);
  const revealed = verdict !== undefined;

  const pick = (key: string) => {
    if (revealed) return;
    setPicked((current) => (kind === 'multi' ? (current.includes(key) ? current.filter((value) => value !== key) : [...current, key]) : [key]));
  };

  const reveal = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setVerdict(await checkPracticeAnswer(client, entry.id, answer));
    } catch (error) {
      setProblem(`Couldn't check it: ${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const rate = async (rating: DtPracticeRating, selfReport = false) => {
    submission.current ??= { requestId: randomId(), version: item.state.version, rating, answer, selfReport };
    setPendingRating(submission.current.rating);
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await reviewPracticeQuestion(client, entry.id, submission.current);
      onReviewed(submission.current.rating, outcome);
    } catch (error) {
      if (error instanceof DtHttpError && error.status === 409) {
        setConflict(true);
        setProblem('This question was reviewed somewhere else just now. Skip it; it comes back when it is due.');
      } else {
        setProblem(`Couldn't save the review: ${describeError(error)}. Try again.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const verdictText = verdict === true ? 'Correct' : verdict === false ? 'Not quite' : "Compare your answer with DeepTutor's";
  const verdictColor = verdict === true ? palette.success : verdict === false ? palette.danger : palette.textMuted;

  return (
    <View style={[styles.card, { borderColor: palette.border }]}>
      <Text style={[styles.position, { color: palette.textFaint }]}>
        {[position, entry.difficulty, entry.session_title].filter(Boolean).join(' · ')}
      </Text>
      <Markdown text={entry.question} baseUrl={session.baseUrl} />

      {kind === 'written' ? (
        <TextInput
          value={written}
          onChangeText={setWritten}
          editable={!revealed && !busy}
          multiline
          placeholder="Try to recall the answer first"
          placeholderTextColor={palette.textFaint}
          style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          accessibilityLabel="Your answer"
        />
      ) : (
        <View style={styles.options}>
          {kind === 'multi' ? <Text style={[styles.note, { color: palette.textMuted }]}>Pick every answer that fits.</Text> : null}
          {options.map(([key, text]) => {
            const chosen = picked.includes(key);
            const isRight = revealed && right.includes(key);
            const isWrong = revealed && chosen && !right.includes(key);
            const border = isRight ? palette.success : isWrong ? palette.danger : chosen ? palette.text : palette.border;
            return (
              <Pressable
                key={key}
                accessibilityRole={kind === 'multi' ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: chosen, disabled: revealed }}
                onPress={() => pick(key)}
                style={({ pressed }) => [styles.option, { borderColor: border }, pressed && !revealed && { backgroundColor: palette.surface }]}>
                <Text style={[styles.optionKey, { color: palette.textMuted }]}>{key}</Text>
                <Text style={[styles.optionText, { color: palette.text }]}>{text}</Text>
                {isRight ? <Icon name="check" size={16} color={palette.success} strokeWidth={2.2} /> : null}
                {isWrong ? <Icon name="x-mark" size={16} color={palette.danger} strokeWidth={2.2} /> : null}
              </Pressable>
            );
          })}
        </View>
      )}

      {!revealed ? (
        <View style={styles.actions}>
          <Button
            label={kind === 'written' ? 'Show Answer' : 'Check Answer'}
            onPress={() => void reveal()}
            loading={busy}
            disabled={kind !== 'written' && picked.length === 0}
          />
          <View style={styles.row}>
            <Pressable accessibilityRole="button" disabled={busy || conflict} onPress={() => void rate('good', true)} hitSlop={6}>
              <Text style={[styles.link, { color: palette.link }]}>I Know This</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onSkip} hitSlop={6}>
              <Text style={[styles.link, { color: palette.textMuted }]}>Skip</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.reveal}>
          <View style={[styles.answer, { backgroundColor: palette.surface }]}>
            <Text style={[styles.verdict, { color: verdictColor }]} accessibilityLiveRegion="polite">
              {verdictText}
            </Text>
            {entry.correct_answer ? (
              <Markdown
                text={kind === 'written' ? entry.correct_answer : right.map((key) => `**${key}.** ${entry.options?.[key] ?? ''}`).join('\n\n') || entry.correct_answer}
                baseUrl={session.baseUrl}
              />
            ) : (
              <Text style={[styles.note, { color: palette.textMuted }]}>No answer was saved with this question. Check it against where it came from.</Text>
            )}
            {entry.explanation ? (
              <View style={[styles.explanation, { borderTopColor: palette.border }]}>
                <Markdown text={entry.explanation} baseUrl={session.baseUrl} muted />
              </View>
            ) : null}
          </View>
          {verdict === null ? (
            <View style={styles.ratings}>
              {RATINGS.map((rating) => (
                <Pressable
                  key={rating.value}
                  accessibilityRole="button"
                  accessibilityLabel={`${rating.label}. ${rating.hint}`}
                  disabled={busy || conflict || (pendingRating !== null && pendingRating !== rating.value)}
                  onPress={() => void rate(rating.value)}
                  style={({ pressed }) => [
                    styles.rating,
                    { borderColor: palette.border, opacity: pendingRating !== null && pendingRating !== rating.value ? 0.4 : 1 },
                    pressed && { backgroundColor: palette.surface },
                  ]}>
                  <Text style={[styles.ratingLabel, { color: palette.text }]}>{rating.label}</Text>
                  <Text style={[styles.ratingHint, { color: palette.textMuted }]}>{rating.hint}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.actions}>
              <Button label={verdict ? 'Next' : 'Practise Again'} onPress={() => void rate(verdict ? 'good' : 'again')} loading={busy} disabled={conflict} />
              <Text style={[styles.note, { color: palette.textMuted }]}>
                {verdict ? 'It comes back when its next review is due.' : 'It comes back later in this round.'}
              </Text>
            </View>
          )}
          {busy && verdict === null ? <ActivityIndicator color={palette.textMuted} /> : null}
          {conflict ? (
            <Pressable accessibilityRole="button" onPress={onSkip} hitSlop={6} style={styles.center}>
              <Text style={[styles.link, { color: palette.link }]}>Skip This Question</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      {problem ? <Text style={[styles.note, { color: palette.danger }]}>{problem}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: 16, gap: 14 },
  position: { fontFamily: fonts.medium, fontSize: 12 },
  input: { minHeight: 96, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: 12, fontFamily: fonts.regular, fontSize: 15, textAlignVertical: 'top' },
  options: { gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  optionKey: { fontFamily: fonts.semibold, fontSize: 14, width: 18 },
  optionText: { flex: 1, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  actions: { gap: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  link: { fontFamily: fonts.medium, fontSize: 15 },
  reveal: { gap: 12 },
  answer: { borderRadius: radius.md, padding: 12, gap: 6 },
  verdict: { fontFamily: fonts.semibold, fontSize: 15 },
  explanation: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, marginTop: 4 },
  ratings: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rating: { flexBasis: '47%', flexGrow: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  ratingLabel: { fontFamily: fonts.semibold, fontSize: 15 },
  ratingHint: { fontFamily: fonts.regular, fontSize: 12 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  center: { alignSelf: 'center' },
});
