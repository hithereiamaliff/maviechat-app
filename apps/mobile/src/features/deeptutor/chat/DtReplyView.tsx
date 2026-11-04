import {
  replySegments,
  toolSummary,
  type DtMasteryGrade,
  type DtMasteryQuestion,
  type DtOutline,
  type DtQuizQuestion,
  type DtReply,
  type DtSource,
  type DtToolStep,
} from '@maviechat/deeptutor-protocol';
import * as Clipboard from 'expo-clipboard';
import { memo, useMemo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { ReadAloudButton } from '@/components/ReadAloudButton';
import { useToast } from '@/components/Toast';
import { Disclosure } from '@/features/chat/Steps';
import { useAutoReadAloud } from '@/lib/autoReadAloud';
import { useDevicePrefs } from '@/lib/devicePrefs';
import { openLink } from '@/lib/links';
import { Markdown } from '@/markdown/Markdown';
import { fonts, radius, usePalette } from '@/theme';
import { toolIcon, toolLabel } from './DtComposer';
import { DtSentExtras, type SentAttachment } from './DtExtrasViews';
import { DtMasteryCard, type MasteryCardAnswer } from './DtMasteryCard';
import { DtAskView, DtOutlineView, DtQuizView, DtStages, DtVisualView } from './DtModeViews';
import type { QuizAnswer } from './quiz';

/** Long tool output stays readable on a phone: the rest is a tap away on the web. */
const RESULT_LIMIT = 4000;

/** Our names for the steps DeepTutor's modes take. */
const STEP_NAMES: Record<string, string> = {
  solve_plan: 'Plan',
  solve_finish_step: 'Step done',
  solve_replan: 'New plan',
  workspace_list: 'Looked through your workspace',
  workspace_read: 'Read a workspace file',
  workspace_search: 'Searched your workspace',
  write_note: 'Wrote a notebook page',
  search_notes: 'Searched your notebook',
  research_lit: 'Searched the literature',
  preprint: 'Read a preprint',
  rag: 'Searched your knowledge base',
  exec: 'Ran code',
  web_fetch: 'Read a web page',
  mastery_status: 'Checked your progress',
  mastery_build: 'Drew the outline',
  mastery_revise: 'Revised the outline',
  mastery_profile: 'Noted what you told it',
  mastery_mode: 'Switched mode',
  mastery_assess: 'Assessed your explanation',
  mastery_explained: 'Noted your explanation',
  mastery_defer: 'Set a point aside for now',
  mastery_paths: 'Looked at your paths',
};

/** Steps the reply shows in their own way (the question card, the drawing). */
const SHOWN_ELSEWHERE = new Set(['ask_user', 'submit_visualization', 'mastery_quiz', 'mastery_grade', 'mastery_skip_question']);

const MODE_NAMES: Record<string, string> = { outline: 'Outline', study: 'Study', review: 'Review' };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function hostOf(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? url;
}

function stepTitle(tool: DtToolStep): string {
  const name = STEP_NAMES[tool.name] ?? toolLabel(tool.name);
  if (!tool.done) return `${name}…`;
  if (tool.name === 'solve_plan' || tool.name === 'solve_replan') {
    const steps = Array.isArray(tool.args.steps) ? tool.args.steps.length : 0;
    return steps ? `${name} · ${steps} ${steps === 1 ? 'step' : 'steps'}` : name;
  }
  if (tool.name === 'solve_finish_step') return text(tool.args.step_id) ? `${name}: ${text(tool.args.step_id)}` : name;
  const summary = toolSummary(tool);
  return summary ? `${name}: ${summary}` : name;
}

/** What a step shows when opened: Solve's plan and step summaries as text, other tools' output. */
function stepBody(tool: DtToolStep): string {
  if (tool.name === 'solve_plan' || tool.name === 'solve_replan') {
    const steps = Array.isArray(tool.args.steps) ? tool.args.steps : [];
    const lines = steps.map((step, index) => `${index + 1}. ${text((step as Record<string, unknown>).goal)}`);
    return [text(tool.args.analysis), lines.join('\n')].filter(Boolean).join('\n\n');
  }
  if (tool.name === 'solve_finish_step' && text(tool.args.summary)) return text(tool.args.summary);
  return tool.result.length > RESULT_LIMIT ? `${tool.result.slice(0, RESULT_LIMIT)}\n\n…` : tool.result;
}

function ToolStepView({ tool }: { tool: DtToolStep }) {
  const palette = usePalette();
  const body = stepBody(tool);
  return (
    <Disclosure icon={toolIcon(tool.name)} label={stepTitle(tool)} busy={!tool.done}>
      {body.trim() ? <Markdown text={body} muted /> : <Text style={[styles.faint, { color: palette.textFaint }]}>No output yet.</Text>}
    </Disclosure>
  );
}

function SourceList({ sources }: { sources: DtSource[] }) {
  const palette = usePalette();
  return (
    <View style={styles.sources}>
      <Text style={[styles.sourcesTitle, { color: palette.textMuted }]}>Sources</Text>
      {sources.slice(0, 12).map((source, index) => (
        <Pressable
          key={source.url}
          accessibilityRole="link"
          onPress={() => void openLink(source.url)}
          style={({ pressed }) => [styles.source, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
          <Text style={[styles.sourceIndex, { color: palette.textFaint }]}>{index + 1}</Text>
          <View style={styles.sourceText}>
            <Text style={[styles.sourceTitle, { color: palette.text }]} numberOfLines={1}>
              {source.title}
            </Text>
            <Text style={[styles.sourceHost, { color: palette.textFaint }]} numberOfLines={1}>
              {hostOf(source.url)}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

export interface DtReplyActions {
  /** Regenerate is offered on the last reply only. */
  onRegenerate?: () => void;
  /** Research's outline → the research itself (last reply, nothing running). */
  onStartResearch?: (outline: DtOutline) => Promise<void>;
  /** Sends answers to the questions a waiting turn asked. */
  onAnswer?: (answers: { questionId: string; text: string }[]) => Promise<boolean>;
  /** Saves a finished Quiz to DeepTutor. */
  onSaveQuiz?: (turnId: string, questions: DtQuizQuestion[], answers: Record<string, QuizAnswer>) => Promise<void>;
  onOpenWeb?: () => void;
  /** A mastery path's chat: its question cards and their rulings across the conversation. */
  mastery?: DtMasteryContext;
  /** Who answers, when it isn't DeepTutor itself (a partner): a name, and a face beside it. */
  speaker?: { name: string; face?: ReactNode };
}

export interface DtMasteryContext {
  grades: Record<string, DtMasteryGrade>;
  skipped: string[];
  rejected: string[];
  /** Absent while a reply is running. */
  onAnswer?: (question: DtMasteryQuestion, answer: MasteryCardAnswer) => Promise<boolean>;
  onSkip?: (question: DtMasteryQuestion) => Promise<boolean>;
}

interface DtReplyViewProps extends DtReplyActions {
  reply: DtReply;
  baseUrl: string;
  /** Keeps this reply's quiz and question answers apart from other replies'. */
  stateKey: string;
  last: boolean;
}

/** A DeepTutor reply: its stages and reasoning, the answer with each step in its place, the mode's own result, sources and actions. */
export const DtReplyView = memo(function DtReplyView({ reply, baseUrl, stateKey, last, onRegenerate, onStartResearch, onAnswer, onSaveQuiz, onOpenWeb, mastery, speaker }: DtReplyViewProps) {
  const palette = usePalette();
  const toast = useToast();
  const segments = useMemo(() => replySegments({ answer: reply.answer, tools: reply.tools.filter((tool) => !SHOWN_ELSEWHERE.has(tool.name)) }), [reply]);
  const running = reply.status === 'running';
  const waiting = reply.status === 'waiting';
  const thinking = reply.thoughts.map((thought) => thought.text.trim()).filter(Boolean).join('\n\n');
  const stillThinking = running && !reply.answer && reply.tools.length === 0;
  const turnId = reply.turnId;
  // Read Aloud in your voice at DeepTutor's speed (Settings → Audio); the newest reply is read when it's done, if you asked.
  const prefs = useDevicePrefs();
  const readId = `dt-${reply.turnId ?? reply.assistantMessageId ?? ''}`;
  useAutoReadAloud({ id: readId, writing: running || waiting, finished: reply.status === 'completed', markdown: reply.answer, enabled: last && prefs.deepTutorAutoPlay, rate: prefs.deepTutorRate });

  return (
    <View style={styles.wrap}>
      {speaker?.face ? (
        <View style={styles.speakerRow}>
          {speaker.face}
          <Text style={[styles.speaker, styles.speakerName, { color: palette.text }]} numberOfLines={1}>
            {speaker.name}
          </Text>
        </View>
      ) : (
        <Text style={[styles.speaker, { color: palette.text }]}>{speaker?.name ?? 'DeepTutor'}</Text>
      )}
      <DtStages stages={reply.stages} running={running} />
      {thinking ? (
        <Disclosure icon="light-bulb" label={stillThinking ? 'Thinking…' : 'Thought'} busy={stillThinking}>
          <Markdown text={thinking} muted />
        </Disclosure>
      ) : null}
      {reply.visual ? (
        // Visualize's text is the drawing's code; the drawing says it better.
        <DtVisualView visual={reply.visual} onOpenWeb={onOpenWeb} />
      ) : (
        segments.map((segment, index) =>
          segment.kind === 'text' ? (
            <Markdown key={`t${index}`} text={segment.text} baseUrl={baseUrl} />
          ) : (
            <View key={`s${index}`}>
              {segment.tools.map((tool) => (
                <ToolStepView key={tool.id} tool={tool} />
              ))}
            </View>
          ),
        )
      )}
      {reply.mastery.built ? (
        <Text style={[styles.faint, { color: palette.textMuted }]}>
          {`Drew the outline: ${reply.mastery.built.modules} ${reply.mastery.built.modules === 1 ? 'module' : 'modules'}, ${reply.mastery.built.points} knowledge ${reply.mastery.built.points === 1 ? 'point' : 'points'}.`}
        </Text>
      ) : null}
      {reply.mastery.mode ? <Text style={[styles.faint, { color: palette.textMuted }]}>{`Switched this chat to ${MODE_NAMES[reply.mastery.mode] ?? reply.mastery.mode}.`}</Text> : null}
      {reply.mastery.questions.map((question) => {
        const grade = mastery?.grades[question.id];
        const open = !(grade?.final ?? false) && !mastery?.skipped.includes(question.id);
        return (
          <DtMasteryCard
            key={question.id}
            question={question}
            grade={grade}
            skipped={mastery?.skipped.includes(question.id) ?? false}
            rejected={mastery?.rejected.includes(question.id) ?? false}
            onAnswer={open && mastery?.onAnswer ? (answer) => mastery.onAnswer!(question, answer) : undefined}
            onSkip={open && mastery?.onSkip ? () => mastery.onSkip!(question) : undefined}
            stateKey={stateKey}
          />
        );
      })}
      {reply.ask ? <DtAskView ask={reply.ask} answers={reply.askAnswers} waiting={waiting} stateKey={stateKey} onSubmit={onAnswer} /> : null}
      {reply.quiz.length > 0 ? (
        <DtQuizView
          questions={reply.quiz}
          stateKey={stateKey}
          onSubmit={onSaveQuiz && turnId && !running ? (answers) => onSaveQuiz(turnId, reply.quiz, answers) : undefined}
        />
      ) : null}
      {reply.outline ? <DtOutlineView outline={reply.outline} onStart={last && onStartResearch && !running ? () => onStartResearch(reply.outline!) : undefined} /> : null}
      {running ? (
        <View style={styles.activity}>
          <ActivityIndicator size="small" color={palette.textMuted} />
          <Text style={[styles.activityText, { color: palette.textMuted }]} numberOfLines={2}>
            {reply.activity ?? 'Working…'}
          </Text>
        </View>
      ) : null}
      {waiting && !reply.ask ? (
        <Text style={[styles.faint, { color: palette.textMuted }]}>DeepTutor is waiting for your answer in the web app.</Text>
      ) : null}
      {reply.error ? (
        <View style={[styles.error, { borderColor: palette.danger }]}>
          <Icon name="exclamation-triangle" size={16} color={palette.danger} />
          <Text style={[styles.errorText, { color: palette.danger }]}>{reply.error}</Text>
        </View>
      ) : null}
      {reply.status === 'cancelled' ? <Text style={[styles.faint, { color: palette.textFaint }]}>Stopped.</Text> : null}
      {reply.sources.length > 0 ? <SourceList sources={reply.sources} /> : null}
      {!running && !waiting ? (
        <View style={styles.actions}>
          {reply.answer.trim() ? (
            <IconButton
              icon="clipboard-document"
              label="Copy response"
              size={18}
              color={palette.textMuted}
              onPress={() => void Clipboard.setStringAsync(reply.answer).then(() => toast('Copied to clipboard'))}
            />
          ) : null}
          {reply.answer.trim() ? <ReadAloudButton id={readId} markdown={reply.answer} rate={prefs.deepTutorRate} /> : null}
          {last && onRegenerate ? <IconButton icon="arrow-path" label="Regenerate" size={18} color={palette.textMuted} onPress={onRegenerate} /> : null}
        </View>
      ) : null}
    </View>
  );
});

/** Your message, as a bubble on the right, with what it went with underneath. */
export function DtUserBubble({
  text: message,
  attachments = [],
  references = [],
}: {
  text: string;
  attachments?: SentAttachment[];
  references?: { key: string; icon: IconName; label: string }[];
}) {
  const palette = usePalette();
  return (
    <View style={styles.userWrap}>
      {message.trim() ? (
        <View style={[styles.bubble, { backgroundColor: palette.bubble }]}>
          <Text selectable style={[styles.userText, { color: palette.text }]}>
            {message.trim()}
          </Text>
        </View>
      ) : null}
      <DtSentExtras attachments={attachments} references={references} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 18 },
  speaker: { fontFamily: fonts.semibold, fontSize: 15, marginBottom: 4 },
  speakerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  speakerName: { flexShrink: 1, marginBottom: 0 },
  activity: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 6 },
  activityText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 14 },
  faint: { fontFamily: fonts.regular, fontSize: 13, marginVertical: 4 },
  error: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginVertical: 8, padding: 12, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  errorText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  sources: { marginTop: 10, gap: 6 },
  sourcesTitle: { fontFamily: fonts.medium, fontSize: 13 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  sourceIndex: { fontFamily: fonts.medium, fontSize: 12, width: 16, textAlign: 'center' },
  sourceText: { flex: 1 },
  sourceTitle: { fontFamily: fonts.regular, fontSize: 14 },
  sourceHost: { fontFamily: fonts.regular, fontSize: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4, marginLeft: -8 },
  userWrap: { marginTop: 18, alignItems: 'flex-end' },
  bubble: { maxWidth: '85%', borderRadius: radius.xl, paddingHorizontal: 14, paddingVertical: 10 },
  userText: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
});
