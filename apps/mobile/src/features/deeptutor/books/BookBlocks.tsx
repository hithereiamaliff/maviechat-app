import {
  animationVideo,
  blockBridge,
  blockMarkdown,
  blockVisual,
  bookQuizQuestions,
  calloutOf,
  codeOf,
  conceptMapCounts,
  conceptMapIndex,
  conceptMapMermaid,
  deepDivesOf,
  flashCardsOf,
  noteOf,
  sectionOf,
  timelineOf,
  type DtBookBlock,
  type DtQuizAttempt,
  type DtQuizQuestion,
} from '@maviechat/deeptutor-protocol';
import { memo, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { QuizItem } from '@/features/deeptutor/chat/DtModeViews';
import { NO_ANSWER, type QuizAnswer } from '@/features/deeptutor/chat/quiz';
import { visualHtml } from '@/features/deeptutor/chat/visualHtml';
import { CodeBlock } from '@/markdown/CodeBlock';
import { Markdown } from '@/markdown/Markdown';
import { WebFrame } from '@/markdown/WebFrame';
import { mermaidPage, withMath } from '@/markdown/webPages';
import { fonts, radius, usePalette } from '@/theme';
import { BLOCK_TYPE_SINGULAR, blockLabel } from './labels';

/** What a page's blocks can do beyond showing themselves. */
export interface BlockActions {
  canEdit: boolean;
  /** Your recorded quiz answers on this page, the latest per question. */
  attempts: DtQuizAttempt[];
  onQuizAnswer(blockId: string, question: DtQuizQuestion, answer: QuizAnswer): void;
  /** Writes a failed block again; null while that isn't possible (paused, or already retrying). */
  onRetry: ((blockId: string) => void) | null;
  retrying: string | null;
  onOpenPage(pageId: string): void;
  /** Writes a deeper page on a topic (minutes); null when you can't. */
  onDeepDive: ((blockId: string, topic: string) => void) | null;
  deepDiving: string | null;
  onOpenVideo(url: string): void;
}

const CALLOUT_ICONS: Record<string, IconName> = {
  key_idea: 'light-bulb',
  insight: 'light-bulb',
  connection: 'link',
  common_pitfall: 'exclamation-triangle',
  summary: 'list-bullet',
  tip: 'sparkles',
};
const CALLOUT_LABELS: Record<string, string> = { key_idea: 'Key idea', insight: 'Key idea', connection: 'Key idea', common_pitfall: 'Common pitfall', summary: 'Summary', tip: 'Tip' };

function Section({ block }: { block: DtBookBlock }) {
  const palette = usePalette();
  const section = sectionOf(block);
  return (
    <View style={styles.block}>
      {section.intro ? <Markdown text={section.intro} /> : null}
      {section.parts.map((part, index) => (
        <Markdown key={index} text={part} />
      ))}
      {section.takeaway ? (
        <View style={[styles.takeaway, { backgroundColor: palette.surface }]}>
          <Text style={[styles.smallLabel, { color: palette.textMuted }]}>Key takeaway</Text>
          <Text style={[styles.body, { color: palette.text }]}>{section.takeaway}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Callout({ block }: { block: DtBookBlock }) {
  const palette = usePalette();
  const callout = calloutOf(block);
  const warning = callout.variant === 'common_pitfall';
  return (
    <View style={[styles.callout, { borderLeftColor: warning ? palette.danger : palette.textMuted, backgroundColor: palette.surface }]}>
      <View style={styles.calloutTop}>
        <Icon name={CALLOUT_ICONS[callout.variant] ?? 'light-bulb'} size={15} color={warning ? palette.danger : palette.textMuted} />
        <Text style={[styles.smallLabel, { color: warning ? palette.danger : palette.textMuted }]}>{callout.label || CALLOUT_LABELS[callout.variant] || 'Note'}</Text>
      </View>
      <Markdown text={callout.body} />
    </View>
  );
}

/** A page's quick check: your answers are kept with your progress (and come back when you return). */
function Quiz({ block, actions }: { block: DtBookBlock; actions: BlockActions }) {
  const palette = usePalette();
  const questions = useMemo(() => bookQuizQuestions(block), [block]);
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>({});
  const kept = (question: DtQuizQuestion): QuizAnswer => {
    const attempt = actions.attempts.find((item) => item.blockId === block.id && item.questionId === question.id);
    if (!attempt) return NO_ANSWER;
    return { value: attempt.answer.startsWith('self:') ? '' : attempt.answer, checked: true, correct: attempt.correct };
  };
  return (
    <View style={styles.block}>
      <Text style={[styles.blockTitle, { color: palette.text }]}>Quick check</Text>
      {questions.map((question, index) => (
        <QuizItem
          key={question.id}
          question={question}
          number={index + 1}
          answer={answers[question.id] ?? kept(question)}
          setAnswer={(answer) => {
            setAnswers((current) => ({ ...current, [question.id]: answer }));
            if (answer.checked && answer.correct !== null) actions.onQuizAnswer(block.id, question, answer);
          }}
        />
      ))}
    </View>
  );
}

function FlashCards({ block }: { block: DtBookBlock }) {
  const palette = usePalette();
  const cards = flashCardsOf(block);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[Math.min(index, cards.length - 1)];
  if (!card) return null;
  const go = (by: number) => {
    setIndex((current) => Math.max(0, Math.min(cards.length - 1, current + by)));
    setFlipped(false);
  };
  return (
    <View style={styles.block}>
      <View style={styles.cardsTop}>
        <Text style={[styles.blockTitle, { color: palette.text }]}>Flash cards</Text>
        <Text style={[styles.meta, { color: palette.textMuted }]}>{`${index + 1} / ${cards.length}`}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityHint={flipped ? 'Shows the front' : 'Shows the back'}
        onPress={() => setFlipped(!flipped)}
        style={[styles.flashCard, { borderColor: palette.border, backgroundColor: flipped ? palette.surface : palette.background }]}>
        <Text style={[styles.smallLabel, { color: palette.textFaint }]}>{flipped ? 'Back' : 'Front'}</Text>
        <Text style={[styles.cardText, { color: palette.text }]}>{flipped ? card.back : card.front}</Text>
        {!flipped && card.hint ? <Text style={[styles.meta, { color: palette.textMuted }]}>{`Hint: ${card.hint}`}</Text> : null}
      </Pressable>
      <View style={styles.cardButtons}>
        <Button label="Previous" variant="secondary" onPress={() => go(-1)} disabled={index === 0} />
        <Button label={flipped ? 'Front' : 'Flip'} variant="secondary" onPress={() => setFlipped(!flipped)} />
        <Button label="Next" variant="secondary" onPress={() => go(1)} disabled={index >= cards.length - 1} />
      </View>
    </View>
  );
}

function Timeline({ block }: { block: DtBookBlock }) {
  const palette = usePalette();
  const events = timelineOf(block);
  if (!events.length) return null;
  return (
    <View style={styles.block}>
      {events.map((event, index) => (
        <View key={`${event.date}-${index}`} style={styles.event}>
          <View style={styles.rail}>
            <View style={[styles.railDot, { backgroundColor: palette.text }]} />
            {index < events.length - 1 ? <View style={[styles.railLine, { backgroundColor: palette.border }]} /> : null}
          </View>
          <View style={styles.eventText}>
            {event.date ? <Text style={[styles.meta, { color: palette.textMuted }]}>{event.date}</Text> : null}
            {event.title ? <Text style={[styles.eventTitle, { color: palette.text }]}>{event.title}</Text> : null}
            {event.description ? <Text style={[styles.body, { color: palette.text }]}>{event.description}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** A figure (SVG, Mermaid or a chart) or an interactive page, in a sandboxed web view. */
function Visual({ block }: { block: DtBookBlock }) {
  const palette = usePalette();
  const dark = useColorScheme() === 'dark';
  const visual = useMemo(() => blockVisual(block), [block]);
  const html = useMemo(() => {
    const page = visual.data ? visualHtml(visual, dark) : null;
    return page && visual.renderType === 'html' ? withMath(page) : page;
  }, [visual, dark]);
  const interactive = visual.renderType === 'html';
  return (
    <View style={styles.block}>
      {html ? (
        <WebFrame html={html} initialHeight={interactive ? 560 : visual.renderType === 'chartjs' ? 320 : 240} maxHeight={interactive ? 2400 : 900} />
      ) : (
        <View style={[styles.placeholder, { backgroundColor: palette.surface }]}>
          <Text style={[styles.meta, { color: palette.textMuted }]}>{`This ${interactive ? 'interactive page' : 'figure'} can't be shown here. It shows in the DeepTutor web app.`}</Text>
        </View>
      )}
      {visual.description ? <Markdown text={visual.description} muted /> : null}
    </View>
  );
}

function ConceptMap({ block, actions }: { block: DtBookBlock; actions: BlockActions }) {
  const palette = usePalette();
  const dark = useColorScheme() === 'dark';
  const code = useMemo(() => conceptMapMermaid(block), [block]);
  const counts = conceptMapCounts(block);
  const index = conceptMapIndex(block);
  return (
    <View style={styles.block}>
      <Text style={[styles.blockTitle, { color: palette.text }]}>
        {counts.chapters
          ? `Chapter map · ${counts.nodes} ${counts.nodes === 1 ? 'chapter' : 'chapters'} · ${counts.edges} ${counts.edges === 1 ? 'link' : 'links'}`
          : `Concept map · ${counts.nodes} ${counts.nodes === 1 ? 'concept' : 'concepts'}`}
      </Text>
      {code ? <WebFrame html={mermaidPage(code, dark)} initialHeight={320} maxHeight={1200} /> : null}
      {index.map((chapter, position) => (
        <Pressable
          key={`${chapter.pageId}-${position}`}
          accessibilityRole="button"
          disabled={!chapter.pageId}
          onPress={() => actions.onOpenPage(chapter.pageId)}
          style={({ pressed }) => [styles.indexRow, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
          <Text style={[styles.number, { color: palette.textMuted }]}>{position + 1}</Text>
          <View style={styles.grow}>
            <Text style={[styles.eventTitle, { color: palette.text }]}>{chapter.title}</Text>
            {chapter.summary ? (
              <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={2}>
                {chapter.summary}
              </Text>
            ) : null}
          </View>
          {chapter.pageId ? <Icon name="chevron-right" size={16} color={palette.textMuted} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

function DeepDive({ block, actions }: { block: DtBookBlock; actions: BlockActions }) {
  const palette = usePalette();
  const topics = deepDivesOf(block);
  if (!topics.length) return null;
  return (
    <View style={[styles.deepDive, { borderColor: palette.border }]}>
      <Text style={[styles.blockTitle, { color: palette.text }]}>Go deeper</Text>
      {topics.map((topic) => {
        const writing = actions.deepDiving === topic.topic;
        const open = Boolean(topic.pageId);
        const enabled = open || (actions.onDeepDive !== null && !actions.deepDiving);
        return (
          <Pressable
            key={topic.topic}
            accessibilityRole="button"
            accessibilityHint={open ? 'Opens its page' : 'Writes a new page on it'}
            disabled={!enabled}
            onPress={() => (open ? actions.onOpenPage(topic.pageId) : actions.onDeepDive?.(block.id, topic.topic))}
            style={({ pressed }) => [styles.topic, { borderTopColor: palette.border }, pressed && { backgroundColor: palette.surface }, !enabled && !writing && { opacity: 0.6 }]}>
            <View style={styles.grow}>
              <Text style={[styles.eventTitle, { color: palette.text }]}>{topic.topic}</Text>
              {topic.rationale ? <Text style={[styles.meta, { color: palette.textMuted }]}>{topic.rationale}</Text> : null}
            </View>
            {writing ? (
              <ActivityIndicator size="small" color={palette.textMuted} />
            ) : open ? (
              <Text style={[styles.link, { color: palette.link }]}>Open</Text>
            ) : actions.onDeepDive ? (
              <Icon name="plus" size={18} color={palette.textMuted} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function Animation({ block, actions }: { block: DtBookBlock; actions: BlockActions }) {
  const palette = usePalette();
  const video = animationVideo(block);
  return (
    <View style={styles.block}>
      {video.url ? <Button label="Play the Animation" variant="secondary" onPress={() => actions.onOpenVideo(video.url)} /> : null}
      {video.caption ? <Markdown text={video.caption} muted /> : null}
      {!video.url ? <Text style={[styles.meta, { color: palette.textMuted }]}>This animation has no video.</Text> : null}
    </View>
  );
}

/** A block still being written, or one that failed (with a retry for editors). */
function Unfinished({ block, actions }: { block: DtBookBlock; actions: BlockActions }) {
  const palette = usePalette();
  if (block.status !== 'error') {
    return (
      <View style={[styles.writing, { backgroundColor: palette.surface }]}>
        <ActivityIndicator size="small" color={palette.textMuted} />
        <Text style={[styles.meta, { color: palette.textMuted }]}>{`Writing ${BLOCK_TYPE_SINGULAR[block.type] ?? blockLabel(block.type)}…`}</Text>
      </View>
    );
  }
  const retryable = block.failure?.retryable !== false;
  const retrying = actions.retrying === block.id;
  return (
    <View style={[styles.failed, { borderColor: palette.danger }]}>
      <Text style={[styles.eventTitle, { color: palette.danger }]}>{`${blockLabel(block.type)}: couldn't be written`}</Text>
      {block.failure?.kind ? <Text style={[styles.meta, { color: palette.textMuted }]}>{`${block.failure.kind.replace(/_/g, ' ')}${retryable ? '' : ' · not retryable'}`}</Text> : null}
      {block.failure?.message || block.error ? (
        <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={4}>
          {block.failure?.message || block.error}
        </Text>
      ) : null}
      {actions.canEdit && retryable && actions.onRetry ? (
        <Button label={retrying ? 'Writing It Again…' : 'Try Again'} variant="secondary" loading={retrying} disabled={actions.retrying !== null} onPress={() => actions.onRetry?.(block.id)} />
      ) : null}
    </View>
  );
}

function Body({ block, actions }: { block: DtBookBlock; actions: BlockActions }) {
  const palette = usePalette();
  switch (block.type) {
    case 'section':
      return <Section block={block} />;
    case 'text':
      return <Markdown text={blockMarkdown(block)} />;
    case 'callout':
      return <Callout block={block} />;
    case 'quiz':
      return <Quiz block={block} actions={actions} />;
    case 'flash_cards':
      return <FlashCards block={block} />;
    case 'code': {
      const code = codeOf(block);
      return (
        <View style={styles.block}>
          <CodeBlock code={code.code} lang={code.language} />
          {code.explanation ? <Text style={[styles.meta, { color: palette.textMuted }]}>{code.explanation}</Text> : null}
        </View>
      );
    }
    case 'timeline':
      return <Timeline block={block} />;
    case 'figure':
    case 'interactive':
      return <Visual block={block} />;
    case 'concept_graph':
      return <ConceptMap block={block} actions={actions} />;
    case 'deep_dive':
      return <DeepDive block={block} actions={actions} />;
    case 'animation':
      return <Animation block={block} actions={actions} />;
    case 'user_note':
      return (
        <View style={[styles.note, { borderColor: palette.border }]}>
          <Text style={[styles.smallLabel, { color: palette.textMuted }]}>Your note</Text>
          {noteOf(block) ? <Markdown text={noteOf(block)} /> : <Text style={[styles.meta, { color: palette.textFaint }]}>Empty note.</Text>}
        </View>
      );
    default:
      return <Text style={[styles.meta, { color: palette.textMuted }]}>{`This kind of block (${blockLabel(block.type)}) shows in the DeepTutor web app.`}</Text>;
  }
}

/** One block of a page: its bridge from the block before, then its content (or how its writing went). */
export const BookBlock = memo(function BookBlock({ block, actions }: { block: DtBookBlock; actions: BlockActions }) {
  if (block.status === 'hidden') return null;
  if (block.status !== 'ready') return <Unfinished block={block} actions={actions} />;
  const bridge = blockBridge(block);
  return (
    <View style={styles.block}>
      {bridge ? <Markdown text={bridge} muted /> : null}
      <Body block={block} actions={actions} />
    </View>
  );
});

const styles = StyleSheet.create({
  block: { gap: 10 },
  grow: { flex: 1, gap: 2 },
  blockTitle: { fontFamily: fonts.semibold, fontSize: 16 },
  smallLabel: { fontFamily: fonts.medium, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  link: { fontFamily: fonts.medium, fontSize: 14 },
  number: { fontFamily: fonts.medium, fontSize: 14, minWidth: 18, textAlign: 'center' },
  takeaway: { borderRadius: radius.md, padding: 12, gap: 4 },
  callout: { borderLeftWidth: 3, borderRadius: radius.md, padding: 12, gap: 6 },
  calloutTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardsTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  flashCard: { minHeight: 150, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 16, gap: 8, justifyContent: 'center' },
  cardText: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 24 },
  cardButtons: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  event: { flexDirection: 'row', gap: 12 },
  rail: { width: 10, alignItems: 'center' },
  railDot: { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
  railLine: { flex: 1, width: 1.5, marginTop: 2 },
  eventText: { flex: 1, gap: 2, paddingBottom: 14 },
  eventTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  placeholder: { borderRadius: radius.md, padding: 14 },
  indexRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  deepDive: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingTop: 12, paddingHorizontal: 12, gap: 8, overflow: 'hidden' },
  topic: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  writing: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.md, padding: 12 },
  failed: { borderWidth: 1, borderRadius: radius.md, padding: 12, gap: 6 },
  note: { borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.md, padding: 12, gap: 6 },
});
