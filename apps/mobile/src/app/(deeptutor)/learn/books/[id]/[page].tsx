import {
  compileBookPage,
  DtBookActionError,
  DtHttpError,
  getBook,
  randomId,
  recordPageVisit,
  recordQuizAttempt,
  regenerateBookBlock,
  toggleBookmark,
  writeDeepDive,
  type DtBook,
  type DtBookDetail,
  type DtBookProgress,
  type DtQuizAttempt,
  type DtQuizQuestion,
} from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { BookActivity } from '@/features/deeptutor/books/BookActivity';
import { BookBlock, type BlockActions } from '@/features/deeptutor/books/BookBlocks';
import { BLOCK_TYPE_SINGULAR, bookErrorText, PAGE_STATUS_LABELS } from '@/features/deeptutor/books/labels';
import { openPageChat } from '@/features/deeptutor/books/pageChat';
import { useBookRefresh, useBookSocket, useBookWatch } from '@/features/deeptutor/books/useBooks';
import type { QuizAnswer } from '@/features/deeptutor/chat/quiz';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useDtBook, useDtBookPage } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const isStale = (error: unknown) =>
  (error instanceof DtBookActionError || error instanceof DtHttpError) && error.status === 409 && (error.code ?? '').startsWith('book_revision');
const lostTouch = (error: unknown) => error instanceof DtBookActionError && (error.code === 'disconnected' || error.code === 'timeout');

/**
 * A book's page: what it's for, then its blocks, written natively; while it's being written, the
 * blocks arrive one by one. A chapter not written yet is written when you open it ("first chapter
 * only" books), or on request.
 */
export default function BookPage() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const socket = useBookSocket();
  const refresh = useBookRefresh();
  const params = useLocalSearchParams<{ id: string; page: string }>();
  const bookId = typeof params.id === 'string' ? params.id : '';
  const pageId = typeof params.page === 'string' ? params.page : '';
  const book = useDtBook(bookId);
  const page = useDtBookPage(bookId, pageId);
  const live = useBookWatch(bookId);
  // The page this screen asked DeepTutor to write (you may have turned the page since).
  const [compiling, setCompiling] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [deepDiving, setDeepDiving] = useState<string | null>(null);
  const bookKey = useMemo(() => [DT_QUERY_ROOT, session.baseUrl, 'books', 'book', bookId], [session.baseUrl, bookId]);
  const detail = book.data;
  const current = page.data;
  const summary = detail?.pages.find((item) => item.id === pageId);
  const status = current?.status ?? summary?.status ?? '';
  const writing = live.pages[pageId];
  const canEdit = detail?.book.canEdit ?? false;
  const paused = detail?.book.status === 'paused';
  const lazy = detail?.book.lazy ?? false;
  const isWriting = compiling === pageId || Boolean(writing) || status === 'planning' || status === 'generating';
  const pages = detail?.pages ?? [];
  const index = pages.findIndex((item) => item.id === pageId);
  const previous = index > 0 ? pages[index - 1] : undefined;
  const next = index >= 0 ? pages[index + 1] : undefined;
  const bookmarked = detail?.progress.bookmarked.includes(pageId) ?? false;

  const keepProgress = (progress: DtBookProgress) => queryClient.setQueryData<DtBookDetail>(bookKey, (old) => (old ? { ...old, progress } : old));

  /** Runs a change that names the book's revision; if the book changed meanwhile, once more with the fresh one. */
  const withRevision = async <T,>(run: (fresh: DtBook) => Promise<T>): Promise<T> => {
    if (!detail) throw new Error('The book is still loading.');
    try {
      return await run(detail.book);
    } catch (error) {
      if (!isStale(error)) throw error;
      const fresh = await queryClient.fetchQuery({ queryKey: bookKey, queryFn: () => getBook(client, bookId), staleTime: 0 });
      return run(fresh.book);
    }
  };

  const write = async (force: boolean) => {
    const target = pageId;
    setCompiling(target);
    try {
      await withRevision((fresh) => compileBookPage(socket, fresh, target, force));
    } catch (error) {
      if (!lostTouch(error)) toast(`Couldn't write it: ${bookErrorText(error)}`, 'error');
    } finally {
      setCompiling((now) => (now === target ? null : now));
      refresh(bookId);
    }
  };

  // A "first chapter only" book writes a chapter when it's first opened (as DeepTutor's own reader does).
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!detail || !current || !canEdit || paused || !lazy || current.status !== 'pending' || asked.current.has(pageId)) return;
    asked.current.add(pageId);
    // Its progress shows from the book's events; a failure shows when the page is read again.
    void compileBookPage(socket, detail.book, pageId)
      .catch(() => undefined)
      .finally(() => refresh(bookId));
  }, [detail, current, canEdit, paused, lazy, pageId, socket, refresh, bookId]);

  // Where you are: recorded once per page shown.
  const visited = useRef(new Set<string>());
  useEffect(() => {
    if (!detail || !current || visited.current.has(pageId)) return;
    visited.current.add(pageId);
    recordPageVisit(client, bookId, pageId)
      .then((progress) => queryClient.setQueryData<DtBookDetail>(bookKey, (old) => (old ? { ...old, progress } : old)))
      .catch(() => visited.current.delete(pageId));
  }, [detail, current, pageId, bookId, client, queryClient, bookKey]);

  const bookmark = async () => {
    try {
      keepProgress(await toggleBookmark(client, bookId, pageId));
    } catch (error) {
      toast(`Couldn't change the bookmark: ${describeError(error)}`, 'error');
    }
  };

  const rewrite = () =>
    Alert.alert('Write this page again?', 'DeepTutor writes every block of this page again (your notes stay). It takes a few minutes.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Write Again', onPress: () => void write(true) },
    ]);

  // The latest answer to each question, as the quiz shows it.
  const attempts = useMemo(() => {
    const latest = new Map<string, DtQuizAttempt>();
    for (const attempt of detail?.progress.quizAttempts ?? []) if (attempt.pageId === pageId) latest.set(`${attempt.blockId} ${attempt.questionId}`, attempt);
    return [...latest.values()];
  }, [detail?.progress.quizAttempts, pageId]);

  const handlers = useRef({ write, withRevision });
  useEffect(() => {
    handlers.current = { write, withRevision };
  });

  const actions = useMemo<BlockActions>(
    () => ({
      canEdit,
      attempts,
      onQuizAnswer: (blockId: string, question: DtQuizQuestion, answer: QuizAnswer) => {
        const submissionId = randomId();
        const send = (tries: number): Promise<void> =>
          recordQuizAttempt(client, {
            bookId,
            pageId,
            blockId,
            questionId: question.id,
            answer: answer.value || (answer.correct ? 'self:correct' : 'self:incorrect'),
            correct: answer.correct,
            submissionId,
          })
            .then((progress) => {
              queryClient.setQueryData<DtBookDetail>(bookKey, (old) => (old ? { ...old, progress } : old));
            })
            .catch((error: unknown) => (tries > 0 ? send(tries - 1) : toast(`Couldn't keep your answer: ${describeError(error)}`, 'error')));
        void send(1);
      },
      onRetry: canEdit && !paused && !retrying ? (blockId: string) => {
        setRetrying(blockId);
        handlers.current
          .withRevision((fresh) => regenerateBookBlock(socket, fresh, pageId, blockId))
          .catch((error: unknown) => (lostTouch(error) ? undefined : toast(`Couldn't write it again: ${bookErrorText(error)}`, 'error')))
          .finally(() => {
            setRetrying(null);
            refresh(bookId);
          });
      } : null,
      retrying,
      onOpenPage: (target: string) => router.setParams({ page: target }),
      onDeepDive:
        canEdit && !paused
          ? (blockId: string, topic: string) =>
              Alert.alert(`Go deeper: ${topic}?`, 'DeepTutor writes a whole new page on it, added at the end of the book. It takes a few minutes.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Write It',
                  onPress: () => {
                    setDeepDiving(topic);
                    handlers.current
                      .withRevision((fresh) => writeDeepDive(client, { book: fresh, pageId, topic, blockId }))
                      .then((written) => router.setParams({ page: written.id }))
                      .catch((error: unknown) => toast(`Couldn't write it: ${describeError(error)}. It may still appear in the contents in a few minutes.`, 'error'))
                      .finally(() => {
                        setDeepDiving(null);
                        refresh(bookId);
                      });
                  },
                },
              ])
          : null,
      deepDiving,
      onOpenVideo: (url: string) => router.push({ pathname: '/learn/web', params: { path: url, title: 'Animation' } }),
    }),
    [canEdit, attempts, paused, retrying, deepDiving, client, bookId, pageId, queryClient, bookKey, toast, socket, refresh],
  );

  const blocks = useMemo(() => {
    const list = current?.blocks ?? [];
    // The overview's map lists the chapters already; its Markdown copy of that list isn't shown twice.
    const mapped = list.some((block) => block.type === 'concept_graph');
    return mapped ? list.filter((block) => block.params.role !== 'chapter_index' && block.payload.role !== 'chapter_index') : list;
  }, [current?.blocks]);
  const failed = blocks.filter((block) => block.status === 'error').length;
  const writingText = writing?.planning
    ? 'Planning the blocks…'
    : writing?.current && writing.planned.length
      ? `Writing ${BLOCK_TYPE_SINGULAR[writing.current] ?? writing.current.replace(/_/g, ' ')} (${Math.min(writing.done + 1, writing.planned.length)} of ${writing.planned.length})…`
      : 'Writing this chapter…';
  const title = current?.title || summary?.title || 'Page';

  const menu: MenuItem[] = [
    { key: 'bookmark', label: bookmarked ? 'Remove Bookmark' : 'Bookmark This Page', icon: bookmarked ? 'bookmark-slash' : 'bookmark', onPress: () => void bookmark() },
    ...(detail ? [{ key: 'chat', label: 'Ask the Tutor About It', icon: 'chat-bubble-left-right' as const, onPress: () => openPageChat(detail, pageId) }] : []),
    { key: 'contents', label: 'Contents', icon: 'list-bullet', onPress: () => router.navigate({ pathname: '/learn/books/[id]', params: { id: bookId } }) },
    ...(canEdit && !paused && (status === 'ready' || status === 'partial') && !isWriting
      ? [{ key: 'rewrite', label: 'Write This Page Again', icon: 'arrow-path' as const, onPress: rewrite }]
      : []),
    {
      key: 'web',
      label: 'Open in DeepTutor Web App',
      icon: 'arrow-top-right-on-square',
      onPress: () => router.push({ pathname: '/learn/web', params: { path: `/learning/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(pageId)}`, title } }),
    },
  ];

  const pending = (
    <View style={[styles.state, { backgroundColor: palette.surface }]}>
      <Text style={[styles.stateTitle, { color: palette.text }]}>This chapter isn&apos;t written yet.</Text>
      <Text style={[styles.note, { color: palette.textMuted }]}>
        {paused
          ? 'The writing is paused. Resume it to write this chapter.'
          : !canEdit
            ? 'It appears here once it has been written.'
            : lazy
              ? 'It is written when you open it.'
              : 'DeepTutor writes the chapters in order; this one is waiting its turn.'}
      </Text>
      {canEdit && !paused ? <Button label={lazy ? 'Write This Chapter' : 'Write It Now'} variant="secondary" onPress={() => void write(false)} /> : null}
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title={title} menu={menu} />
      {book.isLoading || page.isLoading ? (
        <ActivityIndicator style={styles.loading} color={palette.textMuted} />
      ) : !detail || !current ? (
        <Pressable accessibilityRole="button" onPress={() => refresh(bookId)} style={styles.content}>
          <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't open this page: ${describeError(page.error ?? book.error)}. Tap to try again.`}</Text>
        </Pressable>
      ) : (
        <ScrollView key={pageId} contentContainerStyle={styles.content}>
          <BookActivity detail={detail} live={live} />
          <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
          {status !== 'ready' && !isWriting ? <Text style={[styles.meta, { color: palette.textMuted }]}>{PAGE_STATUS_LABELS[status] ?? status}</Text> : null}
          {current.objectives.length ? (
            <View style={[styles.objectives, { borderColor: palette.border }]}>
              <Text style={[styles.label, { color: palette.textMuted }]}>In this chapter</Text>
              {current.objectives.map((objective, at) => (
                <Text key={`${at}-${objective}`} style={[styles.note, { color: palette.text }]}>{`• ${objective}`}</Text>
              ))}
            </View>
          ) : null}

          {blocks.length === 0 ? (
            isWriting ? (
              <View style={[styles.state, styles.row, { backgroundColor: palette.surface }]}>
                <ActivityIndicator color={palette.textMuted} />
                <Text style={[styles.note, styles.grow, { color: palette.text }]}>{writingText}</Text>
              </View>
            ) : status === 'pending' ? (
              pending
            ) : status === 'error' ? (
              <View style={[styles.state, { borderColor: palette.danger, borderWidth: 1 }]}>
                <Text style={[styles.stateTitle, { color: palette.danger }]}>This chapter couldn&apos;t be written.</Text>
                {current.error ? <Text style={[styles.note, { color: palette.textMuted }]}>{current.error}</Text> : null}
                {canEdit && !paused ? <Button label="Try Again" variant="secondary" onPress={() => void write(false)} /> : null}
              </View>
            ) : (
              <Text style={[styles.note, { color: palette.textMuted }]}>This chapter is empty.</Text>
            )
          ) : (
            <>
              {isWriting ? (
                <View style={[styles.state, styles.row, { backgroundColor: palette.surface }]}>
                  <ActivityIndicator size="small" color={palette.textMuted} />
                  <Text style={[styles.meta, styles.grow, { color: palette.textMuted }]}>{writingText}</Text>
                </View>
              ) : failed ? (
                <View style={[styles.state, { borderColor: palette.danger, borderWidth: 1 }]}>
                  <Text style={[styles.stateTitle, { color: palette.text }]}>{`${failed} ${failed === 1 ? 'part' : 'parts'} of this chapter couldn't be written.`}</Text>
                  {canEdit && !paused ? <Button label="Try Them Again" variant="secondary" onPress={() => void write(false)} /> : null}
                </View>
              ) : null}
              {blocks.map((block) => (
                <BookBlock key={block.id} block={block} actions={actions} />
              ))}
            </>
          )}

          {blocks.length > 0 && !isWriting ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => openPageChat(detail, pageId)}
              style={({ pressed }) => [styles.ask, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <Icon name="chat-bubble-left-right" size={18} color={palette.text} />
              <Text style={[styles.askText, { color: palette.text }]}>{detail.book.pageChats[pageId] ? 'Back to Your Chat About This Page' : 'Ask the Tutor About This Page'}</Text>
            </Pressable>
          ) : null}

          <View style={styles.footer}>
            {previous ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Previous: ${previous.title}`} onPress={() => router.setParams({ page: previous.id })} style={styles.turn}>
                <Text style={[styles.label, { color: palette.textMuted }]}>Previous</Text>
                <Text style={[styles.turnTitle, { color: palette.link }]} numberOfLines={2}>
                  {previous.title}
                </Text>
              </Pressable>
            ) : (
              <View style={styles.turn} />
            )}
            {next ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Next: ${next.title}`} onPress={() => router.setParams({ page: next.id })} style={[styles.turn, styles.turnNext]}>
                <Text style={[styles.label, { color: palette.textMuted }]}>Next</Text>
                <Text style={[styles.turnTitle, styles.right, { color: palette.link }]} numberOfLines={2}>
                  {next.title}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { marginTop: 32 },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28 },
  meta: { fontFamily: fonts.regular, fontSize: 13 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fonts.medium, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  objectives: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 12, gap: 4 },
  state: { borderRadius: radius.lg, padding: 14, gap: 8 },
  stateTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  ask: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingVertical: 12, marginTop: 8 },
  askText: { fontFamily: fonts.medium, fontSize: 15 },
  footer: { flexDirection: 'row', gap: 16, marginTop: 8 },
  turn: { flex: 1, gap: 2, paddingVertical: 8 },
  turnNext: { alignItems: 'flex-end' },
  turnTitle: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
  right: { textAlign: 'right' },
});
