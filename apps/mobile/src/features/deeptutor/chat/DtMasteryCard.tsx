import type { DtMasteryGrade, DtMasteryQuestion } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { useStoredState } from '@/lib/storedState';
import { Markdown } from '@/markdown/Markdown';
import { fonts, radius, usePalette } from '@/theme';

const DIFFICULTY: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export interface MasteryCardAnswer {
  text: string;
  /** A group's parts, by question id. */
  answers?: Record<string, string>;
}

interface DtMasteryCardProps {
  question: DtMasteryQuestion;
  /** The ruling, when one has come (usually with the next turn). */
  grade?: DtMasteryGrade;
  skipped: boolean;
  /** The server didn't take the answer: the card opens again. */
  rejected: boolean;
  /** Absent while a reply is running or for a card you can no longer answer. */
  onAnswer?: (answer: MasteryCardAnswer) => Promise<boolean>;
  onSkip?: () => Promise<boolean>;
  stateKey: string;
}

/** What you picked or wrote for one question (a group keeps one per part). */
function usePick(key: string) {
  return useStoredState<string>(key, '');
}

/**
 * A question from a mastery path's tutor: lettered options (or your own words), or a group of
 * two to four parts answered together. Answering sends it as your next message; DeepTutor grades
 * it before the tutor carries on, and the card then shows the ruling.
 */
export function DtMasteryCard({ question, grade, skipped, rejected, onAnswer, onSkip, stateKey }: DtMasteryCardProps) {
  const palette = usePalette();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useStoredState<boolean>(`${stateKey}:sent:${question.id}`, false);
  const settled = (grade && grade.final) || skipped;
  const locked = Boolean(settled) || sending || (sent && !rejected) || !onAnswer;
  const parts = question.type === 'group' ? question.parts : [question];
  const [picks, setPicks] = useStoredState<Record<string, string>>(`${stateKey}:picks:${question.id}`, {});
  const answerOf = (part: DtMasteryQuestion) => (picks[part.id] ?? '').trim();
  const ready = parts.every((part) => answerOf(part));

  const submit = async () => {
    if (!onAnswer || locked || !ready) return;
    setSending(true);
    const text = question.type === 'group' ? parts.map((part, index) => `${index + 1}. ${answerOf(part)}`).join('\n') : answerOf(question);
    const answers = question.type === 'group' ? Object.fromEntries(parts.map((part) => [part.id, answerOf(part)])) : undefined;
    const ok = await onAnswer({ text, answers });
    setSending(false);
    if (ok) setSent(true);
  };
  const skip = async () => {
    if (!onSkip || locked) return;
    setSending(true);
    const ok = await onSkip();
    setSending(false);
    if (ok) setSent(true);
  };

  const meta = [question.pointName, DIFFICULTY[question.difficulty] ?? '', question.attempt > 1 ? `Attempt ${question.attempt}` : ''].filter(Boolean).join(' · ');
  const verdict = grade ? verdictOf(grade) : null;
  const border = skipped || grade?.result === 'ungraded' ? palette.border : grade ? (grade.correct ? palette.success : palette.danger) : palette.border;

  return (
    <View style={[styles.card, { borderColor: border, borderStyle: skipped || grade?.result === 'ungraded' ? 'dashed' : 'solid', backgroundColor: palette.surface }]}>
      {meta ? <Text style={[styles.meta, { color: palette.textMuted }]}>{meta}</Text> : null}
      {question.prompt ? <Markdown text={question.prompt} /> : null}
      {parts.map((part, index) => (
        <QuestionPart
          key={part.id}
          part={part}
          number={question.type === 'group' ? index + 1 : null}
          pick={picks[part.id] ?? ''}
          onPick={(value) => setPicks({ ...picks, [part.id]: value })}
          locked={locked}
          grade={question.type === 'group' ? grade?.parts.find((item) => item.questionId === part.id) : grade}
          stateKey={`${stateKey}:${part.id}`}
        />
      ))}
      {verdict ? (
        <View style={styles.verdict}>
          <Text style={[styles.verdictText, { color: grade?.result === 'ungraded' ? palette.textMuted : grade?.correct ? palette.success : palette.danger }]}>{verdict}</Text>
          {grade && !grade.correct && grade.correctLabel && question.type !== 'group' ? (
            <Text style={[styles.note, { color: palette.text }]}>{`Answer: ${grade.correctLabel}${grade.correctBody ? `. ${grade.correctBody}` : ''}`}</Text>
          ) : null}
          {grade?.explanation ? <Markdown text={grade.explanation} muted /> : null}
          {grade?.feedback && grade.feedback !== grade.explanation ? <Markdown text={grade.feedback} muted /> : null}
        </View>
      ) : skipped ? (
        <Text style={[styles.note, { color: palette.textMuted }]}>Skipped.</Text>
      ) : sent && !rejected ? (
        <View style={styles.waiting}>
          <ActivityIndicator size="small" color={palette.textMuted} />
          <Text style={[styles.note, { color: palette.textMuted }]}>Answer sent. The tutor is marking it.</Text>
        </View>
      ) : (
        <>
          {rejected ? <Text style={[styles.note, { color: palette.danger }]}>That answer didn&apos;t go through. Try again.</Text> : null}
          {onAnswer ? (
            <View style={styles.buttons}>
              <View style={styles.answer}>
                <Button label={question.type === 'group' ? 'Answer All' : 'Answer'} onPress={() => void submit()} loading={sending} disabled={!ready || locked} />
              </View>
              {onSkip ? (
                <Pressable accessibilityRole="button" disabled={locked} onPress={() => void skip()} hitSlop={6} style={styles.skip}>
                  <Text style={[styles.skipText, { color: palette.textMuted }]}>Skip this one</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function verdictOf(grade: DtMasteryGrade): string {
  if (grade.result === 'ungraded') return 'Not graded: your mastery is unchanged.';
  if (grade.result === 'partial') return 'Partly right.';
  if (grade.correct) return 'Correct.';
  return 'Not quite.';
}

function QuestionPart({
  part,
  number,
  pick,
  onPick,
  locked,
  grade,
  stateKey,
}: {
  part: DtMasteryQuestion;
  number: number | null;
  pick: string;
  onPick: (value: string) => void;
  locked: boolean;
  grade?: DtMasteryGrade;
  stateKey: string;
}) {
  const palette = usePalette();
  const [ownWords, setOwnWords] = usePick(`${stateKey}:own`);
  const choices = part.options.length > 0;
  const writing = !choices || (part.freeText && ownWords === 'yes');
  const learner = grade?.learnerAnswer || pick;

  return (
    <View style={styles.part}>
      {number !== null ? (
        <View style={styles.partHead}>
          <Text style={[styles.partNumber, { color: palette.textMuted }]}>{`${number}.`}</Text>
          <View style={styles.partPrompt}>
            <Markdown text={part.prompt} />
          </View>
        </View>
      ) : null}
      {choices
        ? part.options.map((option) => {
            const chosen = !writing && pick === option.label;
            const right = grade && grade.correctLabel === option.label;
            const wrong = grade && !grade.correct && learner === option.label && !right;
            const tint = right ? palette.success : wrong ? palette.danger : chosen ? palette.text : palette.border;
            return (
              <Pressable
                key={option.label}
                accessibilityRole="radio"
                accessibilityState={{ checked: chosen, disabled: locked }}
                disabled={locked}
                onPress={() => {
                  setOwnWords('');
                  onPick(option.label);
                }}
                style={[styles.option, { borderColor: tint, backgroundColor: chosen && !grade ? palette.background : 'transparent' }]}>
                <Text style={[styles.letter, { color: tint === palette.border ? palette.textMuted : tint }]}>{option.label}</Text>
                <View style={styles.optionBody}>
                  <Markdown text={option.body || option.label} />
                </View>
              </Pressable>
            );
          })
        : null}
      {choices && part.freeText && !locked ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setOwnWords(writing ? '' : 'yes');
            onPick('');
          }}
          hitSlop={6}>
          <Text style={[styles.own, { color: palette.link }]}>{writing ? 'Pick an option instead' : 'Answer in my own words'}</Text>
        </Pressable>
      ) : null}
      {writing ? (
        <TextInput
          value={pick}
          onChangeText={onPick}
          editable={!locked}
          multiline
          placeholder="Your answer"
          placeholderTextColor={palette.textFaint}
          style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.background }]}
          accessibilityLabel={number !== null ? `Answer to part ${number}` : 'Your answer'}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: 14, gap: 10, marginVertical: 8 },
  meta: { fontFamily: fonts.medium, fontSize: 12 },
  part: { gap: 8 },
  partHead: { flexDirection: 'row', gap: 6 },
  partNumber: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 23 },
  partPrompt: { flex: 1 },
  option: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9 },
  letter: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 23, minWidth: 16 },
  optionBody: { flex: 1 },
  own: { fontFamily: fonts.medium, fontSize: 14 },
  input: { minHeight: 70, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15, textAlignVertical: 'top' },
  verdict: { gap: 6 },
  verdictText: { fontFamily: fonts.semibold, fontSize: 15 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  answer: { flex: 1 },
  skip: { paddingVertical: 8 },
  skipText: { fontFamily: fonts.medium, fontSize: 14 },
});
