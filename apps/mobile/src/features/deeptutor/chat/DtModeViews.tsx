import type { DtAsk, DtOutline, DtQuizQuestion, DtStage, DtVisual } from '@maviechat/deeptutor-protocol';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { Disclosure } from '@/features/chat/Steps';
import { describeError } from '@/lib/errors';
import { CodeBlock } from '@/markdown/CodeBlock';
import { Markdown } from '@/markdown/Markdown';
import { fonts, radius, usePalette } from '@/theme';
import { choicesFor, isCorrect, NO_ANSWER, type QuizAnswer } from './quiz';
import { useStoredState } from './storedState';
import { visualHtml } from './visualHtml';

/** Our names for the stages DeepTutor's modes go through. */
const STAGE_NAMES: Record<string, string> = {
  rephrasing: 'Understanding',
  decomposing: 'Outlining',
  researching: 'Researching',
  reporting: 'Writing',
  exploring: 'Exploring',
  planning: 'Planning',
  quizzing: 'Writing questions',
  analyzing: 'Analyzing',
  generating: 'Drawing',
  reviewing: 'Reviewing',
  responding: 'Answering',
};

function stageName(stage: string): string {
  const known = STAGE_NAMES[stage];
  if (known) return known;
  const words = stage.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Where a multi-stage mode has got to: done stages ticked, the current one turning. */
export function DtStages({ stages, running }: { stages: DtStage[]; running: boolean }) {
  const palette = usePalette();
  if (stages.length < 2) return null;
  return (
    <View style={styles.stages} accessibilityLabel={`Stages: ${stages.map((stage) => `${stageName(stage.name)} ${stage.done ? 'done' : 'in progress'}`).join(', ')}`}>
      {stages.map((stage) => (
        <View key={stage.name} style={styles.stage}>
          {stage.done ? (
            <Icon name="check" size={13} color={palette.success} strokeWidth={2.2} />
          ) : running ? (
            <ActivityIndicator size="small" color={palette.textMuted} style={styles.stageSpinner} />
          ) : (
            <Icon name="x-mark" size={13} color={palette.textFaint} />
          )}
          <Text style={[styles.stageText, { color: stage.done ? palette.textMuted : palette.text }]}>{stageName(stage.name)}</Text>
        </View>
      ))}
    </View>
  );
}

function QuizItem({ question, number, answer, setAnswer }: { question: DtQuizQuestion; number: number; answer: QuizAnswer; setAnswer: (answer: QuizAnswer) => void }) {
  const palette = usePalette();
  const [draft, setDraft] = useState('');
  const choices = choicesFor(question);
  const answered = answer.checked;
  const good = palette.success;
  const bad = palette.danger;

  const pick = (key: string) => {
    if (answered) return;
    setAnswer({ value: key, checked: true, correct: isCorrect(question, key) });
  };
  const check = () => {
    const value = draft.trim();
    if (!value) return;
    setAnswer({ value, checked: true, correct: isCorrect(question, value) });
  };

  return (
    <View style={[styles.card, { borderColor: palette.border }]}>
      <Text style={[styles.cardLabel, { color: palette.textMuted }]}>{`Question ${number}${question.difficulty ? ` · ${question.difficulty}` : ''}`}</Text>
      <Markdown text={question.question} />
      {choices.length > 0 ? (
        <View style={styles.options}>
          {choices.map((choice) => {
            const chosen = answer.value === choice.key;
            const isAnswer = answered && isCorrect(question, choice.key) === true;
            const color = isAnswer ? good : chosen && answered ? bad : palette.border;
            return (
              <Pressable
                key={choice.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: chosen, disabled: answered }}
                onPress={() => pick(choice.key)}
                style={({ pressed }) => [styles.option, { borderColor: color }, pressed && !answered && { backgroundColor: palette.surface }]}>
                {question.options.length > 0 ? <Text style={[styles.optionKey, { color: palette.textMuted }]}>{choice.key}</Text> : null}
                <View style={styles.optionText}>
                  <Markdown text={choice.text} />
                </View>
                {isAnswer ? <Icon name="check" size={16} color={good} strokeWidth={2.2} /> : chosen && answered ? <Icon name="x-mark" size={16} color={bad} strokeWidth={2.2} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : answered ? (
        <Text style={[styles.yourAnswer, { color: palette.text }]}>{`Your answer: ${answer.value}`}</Text>
      ) : (
        <View style={styles.written}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={question.type === 'fill_in_blank' ? 'Fill in the blank' : 'Your answer'}
            placeholderTextColor={palette.textFaint}
            multiline={question.type !== 'fill_in_blank'}
            style={[styles.input, { color: palette.text, borderColor: palette.border }]}
          />
          <Button label="Check" onPress={check} disabled={!draft.trim()} />
        </View>
      )}
      {answered ? (
        <View style={styles.verdict}>
          {answer.correct === true ? (
            <Text style={[styles.verdictText, { color: good }]}>Correct.</Text>
          ) : answer.correct === false ? (
            <Text style={[styles.verdictText, { color: bad }]}>{choices.length > 0 ? 'Not quite.' : `Not quite. The answer: ${question.answer}`}</Text>
          ) : (
            <>
              <Text style={[styles.verdictText, { color: palette.text }]}>{`DeepTutor's answer: ${question.answer}`}</Text>
              <View style={styles.selfMark}>
                <Button label="I Got It" onPress={() => setAnswer({ ...answer, correct: true })} />
                <Button label="I Missed It" onPress={() => setAnswer({ ...answer, correct: false })} />
              </View>
            </>
          )}
          {question.explanation ? <Markdown text={question.explanation} muted /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** A Quiz to answer here; once every question is checked, the results go to DeepTutor. */
export function DtQuizView({
  questions,
  stateKey,
  onSubmit,
}: {
  questions: DtQuizQuestion[];
  stateKey: string;
  onSubmit?: (answers: Record<string, QuizAnswer>) => Promise<void>;
}) {
  const palette = usePalette();
  const toast = useToast();
  const [answers, setAnswers] = useStoredState<Record<string, QuizAnswer>>(`quiz:${stateKey}`, NO_ANSWERS);
  const [submitted, setSubmitted] = useStoredState<boolean>(`quiz:${stateKey}:submitted`, false);
  const [sending, setSending] = useState(false);
  const done = questions.length > 0 && questions.every((question) => answers[question.id]?.checked && answers[question.id]?.correct !== null);
  const score = questions.filter((question) => answers[question.id]?.correct === true).length;

  const submit = async () => {
    if (!onSubmit) return;
    setSending(true);
    try {
      await onSubmit(answers);
      setSubmitted(true);
    } catch (error) {
      toast(`Couldn't save the results: ${describeError(error)}`, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.block}>
      {questions.map((question, index) => (
        <QuizItem
          key={question.id}
          question={question}
          number={index + 1}
          answer={answers[question.id] ?? NO_ANSWER}
          setAnswer={(answer) => setAnswers({ ...answers, [question.id]: answer })}
        />
      ))}
      {done ? (
        <View style={[styles.summary, { backgroundColor: palette.surface }]}>
          <Text style={[styles.summaryText, { color: palette.text }]}>{`${score} of ${questions.length} right.`}</Text>
          {onSubmit && !submitted ? <Button label="Submit Answers" onPress={() => void submit()} loading={sending} /> : null}
          {submitted ? <Text style={[styles.note, { color: palette.textMuted }]}>Saved to DeepTutor.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const NO_ANSWERS: Record<string, QuizAnswer> = {};

interface AskDraft {
  picked: Record<string, string[]>;
  text: Record<string, string>;
}
const NO_DRAFT: AskDraft = { picked: {}, text: {} };

/** What Ask Questions wants to know: options to pick and room to type, sent back to the waiting turn. */
export function DtAskView({
  ask,
  answers,
  waiting,
  stateKey,
  onSubmit,
}: {
  ask: DtAsk;
  /** Answers already sent (saved with the reply). */
  answers: Record<string, string> | null;
  waiting: boolean;
  stateKey: string;
  onSubmit?: (answers: { questionId: string; text: string }[]) => Promise<boolean>;
}) {
  const palette = usePalette();
  const [draft, setDraft] = useStoredState<AskDraft>(`ask:${stateKey}`, NO_DRAFT);
  const [sending, setSending] = useState(false);
  const replyFor = (id: string) => [...(draft.picked[id] ?? []), draft.text[id]?.trim() ?? ''].filter(Boolean).join(', ');
  const complete = ask.questions.every((question) => replyFor(question.id));
  const canAnswer = waiting && !answers && Boolean(onSubmit);

  const toggle = (questionId: string, label: string, multi: boolean) => {
    const current = draft.picked[questionId] ?? [];
    const next = current.includes(label) ? current.filter((item) => item !== label) : multi ? [...current, label] : [label];
    setDraft({ ...draft, picked: { ...draft.picked, [questionId]: next } });
  };

  const send = async () => {
    if (!onSubmit) return;
    setSending(true);
    await onSubmit(ask.questions.map((question) => ({ questionId: question.id, text: replyFor(question.id) })));
    setSending(false);
  };

  return (
    <View style={[styles.card, { borderColor: palette.border }]}>
      {ask.intro ? <Markdown text={ask.intro} /> : null}
      {ask.questions.map((question) => (
        <View key={question.id} style={styles.askQuestion}>
          {question.header ? <Text style={[styles.cardLabel, { color: palette.textMuted }]}>{question.header}</Text> : null}
          <Text style={[styles.askPrompt, { color: palette.text }]}>{question.prompt}</Text>
          {answers ? (
            <Text style={[styles.yourAnswer, { color: palette.text }]}>{answers[question.id] ? `You answered: ${answers[question.id]}` : 'No answer.'}</Text>
          ) : (
            <>
              <View style={styles.askOptions}>
                {question.options.map((option) => {
                  const picked = (draft.picked[question.id] ?? []).includes(option.label);
                  return (
                    <Pressable
                      key={option.label}
                      accessibilityRole={question.multiSelect ? 'checkbox' : 'radio'}
                      accessibilityState={{ checked: picked, disabled: !canAnswer }}
                      accessibilityHint={option.description || undefined}
                      disabled={!canAnswer}
                      onPress={() => toggle(question.id, option.label, question.multiSelect)}
                      style={[styles.askOption, picked ? { backgroundColor: palette.primary } : { borderColor: palette.border, borderWidth: 1 }]}>
                      <Text style={[styles.askOptionLabel, { color: picked ? palette.onPrimary : palette.text }]}>{option.label}</Text>
                      {option.description ? (
                        <Text style={[styles.askOptionHint, { color: picked ? palette.onPrimary : palette.textFaint }]} numberOfLines={2}>
                          {option.description}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
              {question.freeText ? (
                <TextInput
                  value={draft.text[question.id] ?? ''}
                  onChangeText={(value) => setDraft({ ...draft, text: { ...draft.text, [question.id]: value } })}
                  editable={canAnswer}
                  placeholder={question.placeholder || (question.options.length ? 'Or type your own' : 'Your answer')}
                  placeholderTextColor={palette.textFaint}
                  style={[styles.input, { color: palette.text, borderColor: palette.border }]}
                />
              ) : null}
            </>
          )}
        </View>
      ))}
      {canAnswer ? <Button label="Send Answers" onPress={() => void send()} loading={sending} disabled={!complete} /> : null}
      {!answers && !waiting ? <Text style={[styles.note, { color: palette.textFaint }]}>Writing the questions…</Text> : null}
    </View>
  );
}

/** Research's plan: the parts it will cover, to confirm before it runs. */
export function DtOutlineView({ outline, onStart }: { outline: DtOutline; onStart?: () => Promise<void> }) {
  const palette = usePalette();
  const [starting, setStarting] = useState(false);
  return (
    <View style={[styles.card, { borderColor: palette.border }]}>
      <Text style={[styles.cardLabel, { color: palette.textMuted }]}>Research plan</Text>
      {outline.subTopics.map((topic, index) => (
        <View key={`${index}-${topic.title}`} style={styles.outlineItem}>
          <Text style={[styles.outlineTitle, { color: palette.text }]}>{`${index + 1}. ${topic.title}`}</Text>
          {topic.overview ? <Text style={[styles.outlineOverview, { color: palette.textMuted }]}>{topic.overview}</Text> : null}
        </View>
      ))}
      {onStart ? (
        <Button
          label="Start Research"
          loading={starting}
          onPress={() => {
            setStarting(true);
            void onStart().finally(() => setStarting(false));
          }}
        />
      ) : null}
    </View>
  );
}

/** A Visualize result drawn in its own sandboxed web view, with its code a tap away. */
export function DtVisualView({ visual, onOpenWeb }: { visual: DtVisual; onOpenWeb?: () => void }) {
  const palette = usePalette();
  const dark = useColorScheme() === 'dark';
  const html = useMemo(() => visualHtml(visual, dark), [visual, dark]);
  const [height, setHeight] = useState(visual.renderType === 'chartjs' ? 320 : 240);

  return (
    <View style={styles.block}>
      {visual.title ? <Text style={[styles.visualTitle, { color: palette.text }]}>{visual.title}</Text> : null}
      {html ? (
        <View style={[styles.visualFrame, { height, borderColor: palette.border }]}>
          <WebView<object>
            source={{ html }}
            originWhitelist={['*']}
            incognito
            scrollEnabled={false}
            javaScriptEnabled
            onMessage={(event) => {
              try {
                const next = Number((JSON.parse(event.nativeEvent.data) as { height?: unknown }).height);
                if (Number.isFinite(next)) setHeight(Math.min(900, Math.max(120, next)));
              } catch {
                // not a size message
              }
            }}
            onShouldStartLoadWithRequest={(request) => {
              if (request.url === 'about:blank' || !request.isTopFrame) return true;
              if (/^https?:/i.test(request.url)) void WebBrowser.openBrowserAsync(request.url);
              return false;
            }}
            style={{ backgroundColor: palette.background }}
          />
        </View>
      ) : (
        <View style={[styles.summary, { backgroundColor: palette.surface }]}>
          <Text style={[styles.note, { color: palette.textMuted }]}>{`This kind of visual (${visual.renderType}) shows in the DeepTutor web app.`}</Text>
          {onOpenWeb ? <Button label="Open in DeepTutor Web App" onPress={onOpenWeb} /> : null}
        </View>
      )}
      {visual.description ? <Text style={[styles.note, { color: palette.textMuted }]}>{visual.description}</Text> : null}
      <Disclosure icon="code-bracket" label="Code" busy={false}>
        <CodeBlock code={visual.code.content} lang={visual.code.language} />
      </Disclosure>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 8, gap: 10 },
  stages: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginVertical: 6 },
  stage: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stageSpinner: { transform: [{ scale: 0.7 }] },
  stageText: { fontFamily: fonts.medium, fontSize: 13 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 14, gap: 10, marginTop: 8 },
  cardLabel: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.3, textTransform: 'uppercase' },
  options: { gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  optionKey: { fontFamily: fonts.semibold, fontSize: 14, width: 18 },
  optionText: { flex: 1 },
  written: { gap: 8 },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8, fontFamily: fonts.regular, fontSize: 15, minHeight: 40 },
  yourAnswer: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  verdict: { gap: 6 },
  verdictText: { fontFamily: fonts.semibold, fontSize: 14 },
  selfMark: { flexDirection: 'row', gap: 8 },
  summary: { padding: 12, borderRadius: radius.md, gap: 10 },
  summaryText: { fontFamily: fonts.semibold, fontSize: 15 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  askQuestion: { gap: 8 },
  askPrompt: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  askOptions: { gap: 8 },
  askOption: { borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  askOptionLabel: { fontFamily: fonts.medium, fontSize: 14 },
  askOptionHint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  outlineItem: { gap: 3 },
  outlineTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  outlineOverview: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  visualTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  visualFrame: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
});
