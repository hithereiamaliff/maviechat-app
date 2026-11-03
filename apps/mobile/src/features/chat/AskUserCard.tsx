import { askUserComplete, askUserPayload, type AskUserAnswer, type AskUserQuestion } from '@maviechat/owui-protocol';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { fonts, radius, usePalette } from '@/theme';

interface AskUserCardProps {
  questions: AskUserQuestion[];
  onSubmit: (answers: Record<string, AskUserAnswer>) => void;
  /** Answer nothing: the model carries on without (the web's "cancel"). */
  onSkip: () => void;
  busy?: boolean;
  /** When a live question lapses (ms since epoch); it's then skipped. */
  deadline?: number | null;
}

/**
 * The model's questions before it carries on, as the web asks them: one at a time, two or three
 * options each (the first is its recommendation), or your own words when it allows that.
 * Picking an option moves to the next question; the last one sends the answers.
 */
export function AskUserCard({ questions, onSubmit, onSkip, busy = false, deadline = null }: AskUserCardProps) {
  const palette = usePalette();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AskUserAnswer>>({});
  const [left, setLeft] = useState<number | null>(() => (deadline ? Math.max(0, deadline - Date.now()) : null));
  const question = questions[index];
  const answer = question ? answers[question.id] : undefined;
  const complete = askUserComplete(questions, answers);
  const last = index === questions.length - 1;

  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => {
      const remaining = deadline - Date.now();
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) {
        clearInterval(timer);
        onSkip();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline, onSkip]);

  if (!question) return null;
  const submit = (next = answers) => {
    if (askUserComplete(questions, next) && !busy) onSubmit(askUserPayload(questions, next));
  };
  const pick = (optionIndex: number) => {
    const option = question.options[optionIndex];
    if (!option) return;
    const next = { ...answers, [question.id]: { type: 'option' as const, option_index: optionIndex, label: option.label, description: option.description } };
    setAnswers(next);
    // As on the web: an option moves on, and the last one sends.
    if (!last) setIndex(index + 1);
    else submit(next);
  };
  const other = answer?.type === 'other';

  return (
    <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.background }]}>
      <View style={styles.head}>
        <Icon name="question-mark-circle" size={16} color={palette.textMuted} />
        <Text style={[styles.header, { color: palette.textMuted }]} numberOfLines={1}>
          {questions.length > 1 ? `${question.header} · ${index + 1} of ${questions.length}` : question.header}
        </Text>
        {left !== null ? <Text style={[styles.timer, { color: palette.textFaint }]}>{`${Math.ceil(left / 1000)} s`}</Text> : null}
      </View>
      <Text style={[styles.question, { color: palette.text }]}>{question.question}</Text>
      {question.options.map((option, optionIndex) => {
        const on = answer?.type === 'option' && answer.option_index === optionIndex;
        return (
          <Pressable
            key={`${option.label}-${optionIndex}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled: busy }}
            disabled={busy}
            onPress={() => pick(optionIndex)}
            style={({ pressed }) => [styles.option, { borderColor: on ? palette.text : palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <View style={styles.optionText}>
              <View style={styles.optionTop}>
                <Text style={[styles.label, { color: palette.text }]}>{option.label}</Text>
                {optionIndex === 0 ? (
                  <View style={[styles.badge, { backgroundColor: palette.surfaceStrong }]}>
                    <Text style={[styles.badgeText, { color: palette.textMuted }]}>Recommended</Text>
                  </View>
                ) : null}
              </View>
              {option.description ? <Text style={[styles.description, { color: palette.textMuted }]}>{option.description}</Text> : null}
            </View>
            {on ? <Icon name="check" size={16} color={palette.text} strokeWidth={2} /> : null}
          </Pressable>
        );
      })}
      {question.allowOther ? (
        <TextInput
          value={other ? (answer as { text: string }).text : ''}
          onFocus={() => (other ? undefined : setAnswers({ ...answers, [question.id]: { type: 'other', text: '' } }))}
          onChangeText={(value) => setAnswers({ ...answers, [question.id]: { type: 'other', text: value } })}
          onSubmitEditing={() => (last ? submit() : setIndex(index + 1))}
          editable={!busy}
          placeholder="Other: your own answer"
          placeholderTextColor={palette.textFaint}
          style={[styles.input, { color: palette.text, borderColor: other ? palette.text : palette.border }]}
          accessibilityLabel="Your own answer"
        />
      ) : null}
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" onPress={onSkip} disabled={busy} hitSlop={6}>
          <Text style={[styles.link, { color: palette.textMuted }]}>Skip</Text>
        </Pressable>
        <View style={styles.grow} />
        {index > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => setIndex(index - 1)} disabled={busy} hitSlop={6}>
            <Text style={[styles.link, { color: palette.link }]}>Previous</Text>
          </Pressable>
        ) : null}
        {!last ? (
          <Pressable accessibilityRole="button" onPress={() => setIndex(index + 1)} disabled={busy} hitSlop={6}>
            <Text style={[styles.link, { color: palette.link }]}>Next</Text>
          </Pressable>
        ) : null}
        {last || complete ? (
          <View style={styles.send}>
            <Button label="Submit Answers" onPress={() => submit()} loading={busy} disabled={!complete || busy} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  header: { flex: 1, fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  timer: { fontFamily: fonts.regular, fontSize: 12 },
  question: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  optionText: { flex: 1, gap: 2 },
  optionTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontFamily: fonts.medium, fontSize: 15, flexShrink: 1 },
  badge: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontFamily: fonts.medium, fontSize: 10 },
  description: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  grow: { flex: 1 },
  link: { fontFamily: fonts.medium, fontSize: 15 },
  send: { minWidth: 150 },
});
