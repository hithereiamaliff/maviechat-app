import { deleteSavedQuestion, listSavedQuestions, updateSavedQuestion, type DtSavedQuestion } from '@maviechat/deeptutor-protocol';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { SideScroll } from '@/components/SideScroll';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { correctKeys } from '@/features/deeptutor/practice/round';
import { sessionDate, useDtQuestionBankStats, useDtQuestionCategories } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { useDebounced } from '@/lib/useDebounced';
import { Markdown } from '@/markdown/Markdown';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const PAGE_SIZE = 50;

type Filter = { kind: 'all' } | { kind: 'mistakes' } | { kind: 'bookmarked' } | { kind: 'category'; id: number; name: string };

/** A question as one or two plain lines for the list (Markdown and maths marks dropped). */
function plain(text: string): string {
  return text
    .replace(/\$\$?|\\\(|\\\)|\\\[|\\\]/g, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** DeepTutor's question bank: every question saved from your quizzes, how you answered, and a way to practise each. */
export default function QuestionBank() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const stats = useDtQuestionBankStats();
  const categories = useDtQuestionCategories();
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 300);
  const [open, setOpen] = useState<DtSavedQuestion | null>(null);

  const list = useInfiniteQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'practice', 'questions', filter, query],
    queryFn: ({ pageParam }) =>
      listSavedQuestions(client, {
        mistakesOnly: filter.kind === 'mistakes',
        bookmarked: filter.kind === 'bookmarked' ? true : undefined,
        categoryId: filter.kind === 'category' ? filter.id : undefined,
        search: query,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < last.total && last.items.length > 0 ? loaded : undefined;
    },
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'practice'] });

  const toggleBookmark = (question: DtSavedQuestion) => {
    const bookmarked = !question.bookmarked;
    void updateSavedQuestion(client, question.id, { bookmarked })
      .then(() => {
        setOpen((current) => (current?.id === question.id ? { ...current, bookmarked } : current));
        refresh();
      })
      .catch((error: unknown) => toast(`Couldn't change it: ${describeError(error)}`, 'error'));
  };
  const remove = (question: DtSavedQuestion) =>
    Alert.alert('Delete this question?', 'It leaves your question bank and practice.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteSavedQuestion(client, question.id)
            .then(() => {
              setOpen(null);
              refresh();
            })
            .catch((error: unknown) => toast(`Couldn't delete it: ${describeError(error)}`, 'error')),
      },
    ]);
  const practise = (question: DtSavedQuestion) => {
    setOpen(null);
    router.replace({ pathname: '/learn/practice', params: { entry: String(question.id) } });
  };

  const filters: Filter[] = [
    { kind: 'all' },
    { kind: 'mistakes' },
    { kind: 'bookmarked' },
    ...(categories.data ?? []).map((category): Filter => ({ kind: 'category', id: category.id, name: category.name })),
  ];
  const filterLabel = (item: Filter) =>
    item.kind === 'all' ? 'All' : item.kind === 'mistakes' ? 'Mistakes' : item.kind === 'bookmarked' ? 'Bookmarked' : item.name;
  const sameFilter = (a: Filter, b: Filter) => a.kind === b.kind && (a.kind !== 'category' || (b.kind === 'category' && a.id === b.id));

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Question Bank" />
      <View style={styles.bar}>
        <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search questions"
            placeholderTextColor={palette.textFaint}
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, { color: palette.text }]}
          />
          {search ? <IconButton icon="x-mark" label="Clear search" size={16} color={palette.textMuted} onPress={() => setSearch('')} /> : null}
        </View>
        <SideScroll showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {filters.map((item) => {
            const selected = sameFilter(item, filter);
            return (
              <Pressable
                key={item.kind === 'category' ? `c${item.id}` : item.kind}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFilter(item)}
                style={[styles.chip, { borderColor: palette.border, backgroundColor: selected ? palette.surfaceStrong : palette.background }]}>
                <Text style={[styles.chipText, { color: palette.text }]}>{filterLabel(item)}</Text>
              </Pressable>
            );
          })}
        </SideScroll>
        {stats.data ? (
          <Text style={[styles.counts, { color: palette.textFaint }]}>
            {`${stats.data.total} saved · ${stats.data.wrong} wrong · ${stats.data.bookmarked} bookmarked`}
          </Text>
        ) : null}
      </View>
      <FlashList
        data={items}
        keyExtractor={(item) => String(item.id)}
        keyboardShouldPersistTaps="handled"
        refreshing={false}
        onRefresh={refresh}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListEmptyComponent={
          list.isLoading ? (
            <ActivityIndicator style={styles.loading} color={palette.textMuted} />
          ) : (
            <Text style={[styles.empty, { color: palette.textMuted }]}>
              {list.isError
                ? `Couldn't load the question bank: ${describeError(list.error)}`
                : query || filter.kind !== 'all'
                  ? 'No questions match.'
                  : 'No saved questions yet. Answer a quiz (Quiz mode) and tap Submit Answers to save them here.'}
            </Text>
          )
        }
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Shows the question and its answer"
            onPress={() => setOpen(item)}
            style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <Icon name={item.is_correct ? 'check' : 'x-mark'} size={16} color={item.is_correct ? palette.success : palette.danger} strokeWidth={2.2} />
            <View style={styles.rowText}>
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
                {plain(item.question)}
              </Text>
              <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
                {[item.session_title, sessionDate(item.updated_at ?? item.created_at)].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {item.bookmarked ? <Icon name="bookmark" size={15} color={palette.textMuted} /> : null}
          </Pressable>
        )}
      />
      <QuestionSheet question={open} onClose={() => setOpen(null)} onBookmark={toggleBookmark} onDelete={remove} onPractise={practise} />
    </View>
  );
}

function QuestionSheet({
  question,
  onClose,
  onBookmark,
  onDelete,
  onPractise,
}: {
  question: DtSavedQuestion | null;
  onClose: () => void;
  onBookmark: (question: DtSavedQuestion) => void;
  onDelete: (question: DtSavedQuestion) => void;
  onPractise: (question: DtSavedQuestion) => void;
}) {
  const palette = usePalette();
  const { session } = useDtAuthed();
  const right = question ? correctKeys(question) : [];
  const yours = (question?.user_answer ?? '').split(/[,;\s]+/).map((part) => part.trim().toUpperCase());
  return (
    <Modal visible={question !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {question ? (
        <View style={[styles.screen, { backgroundColor: palette.background }]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: palette.text }]} accessibilityRole="header">
              {question.is_correct ? 'Answered right' : 'Answered wrong'}
            </Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
              <Text style={[styles.done, { color: palette.link }]}>Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <Markdown text={question.question} baseUrl={session.baseUrl} />
            {Object.keys(question.options ?? {}).length > 0 ? (
              <View style={styles.options}>
                {Object.entries(question.options ?? {})
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, text]) => {
                    const isRight = right.includes(key);
                    const picked = yours.includes(key);
                    return (
                      <View key={key} style={[styles.option, { borderColor: isRight ? palette.success : picked ? palette.danger : palette.border }]}>
                        <Text style={[styles.optionKey, { color: palette.textMuted }]}>{key}</Text>
                        <Text style={[styles.optionText, { color: palette.text }]}>{text}</Text>
                        {picked ? <Text style={[styles.tag, { color: palette.textMuted }]}>yours</Text> : null}
                        {isRight ? <Icon name="check" size={16} color={palette.success} strokeWidth={2.2} /> : null}
                      </View>
                    );
                  })}
              </View>
            ) : (
              <>
                <Text style={[styles.section, { color: palette.textMuted }]}>Your answer</Text>
                <Text style={[styles.body, { color: palette.text }]}>{question.user_answer?.trim() || 'No answer saved.'}</Text>
                {question.correct_answer ? (
                  <>
                    <Text style={[styles.section, { color: palette.textMuted }]}>{"DeepTutor's answer"}</Text>
                    <Markdown text={question.correct_answer} baseUrl={session.baseUrl} />
                  </>
                ) : null}
              </>
            )}
            {question.explanation ? (
              <>
                <Text style={[styles.section, { color: palette.textMuted }]}>Explanation</Text>
                <Markdown text={question.explanation} baseUrl={session.baseUrl} muted />
              </>
            ) : null}
            {question.session_id ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onClose();
                  router.replace({ pathname: '/learn/[id]', params: { id: question.session_id as string } });
                }}
                hitSlop={6}>
                <Text style={[styles.source, { color: palette.link }]}>{`From the chat “${question.session_title || 'Quiz'}”`}</Text>
              </Pressable>
            ) : null}
            <View style={styles.actions}>
              <Button label="Practise This Question" onPress={() => onPractise(question)} />
              <View style={styles.actionRow}>
                <Pressable accessibilityRole="button" onPress={() => onBookmark(question)} hitSlop={6}>
                  <Text style={[styles.link, { color: palette.link }]}>{question.bookmarked ? 'Remove Bookmark' : 'Bookmark'}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => onDelete(question)} hitSlop={6}>
                  <Text style={[styles.link, { color: palette.danger }]}>Delete</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6, gap: 8 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingLeft: 10, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  chips: { gap: 8 },
  chip: { height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  counts: { fontFamily: fonts.regular, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 3 },
  title: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  loading: { marginVertical: 24 },
  empty: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 32, paddingHorizontal: 32 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  sheetContent: { paddingHorizontal: 20, paddingBottom: 48, gap: 12 },
  options: { gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  optionKey: { fontFamily: fonts.semibold, fontSize: 14, width: 18 },
  optionText: { flex: 1, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  tag: { fontFamily: fonts.regular, fontSize: 12 },
  section: { fontFamily: fonts.medium, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 6 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  source: { fontFamily: fonts.medium, fontSize: 14 },
  actions: { gap: 14, marginTop: 10 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  link: { fontFamily: fonts.medium, fontSize: 15 },
});
