import { bookView, deleteBook, exportBook, isOverviewPage, landingPage, type DtBookDetail, type DtBookLive, type DtBookPage } from '@maviechat/deeptutor-protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { BookActivity, BookProblems } from '@/features/deeptutor/books/BookActivity';
import { BOOK_STATUS_LABELS, bookErrorText, PAGE_STATUS_LABELS } from '@/features/deeptutor/books/labels';
import { OutlineEditor } from '@/features/deeptutor/books/OutlineEditor';
import { ProposalView } from '@/features/deeptutor/books/ProposalView';
import { useBookRefresh, useBookWatch } from '@/features/deeptutor/books/useBooks';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useDtBook } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

const openPage = (bookId: string, pageId: string) => router.push({ pathname: '/learn/books/[id]/[page]', params: { id: bookId, page: pageId } });

/** A chapter in the contents: its number (the overview has a map), title, and how far it's written. */
function ContentsRow({ detail, page, number, live }: { detail: DtBookDetail; page: DtBookPage; number: number | null; live: DtBookLive }) {
  const palette = usePalette();
  const writing = page.status === 'planning' || page.status === 'generating' || Boolean(live.pages[page.id]);
  const visited = detail.progress.visited.includes(page.id);
  const bookmarked = detail.progress.bookmarked.includes(page.id);
  const failed = page.status === 'error' || page.status === 'partial';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${page.title}, ${writing ? 'being written' : (PAGE_STATUS_LABELS[page.status] ?? page.status)}${bookmarked ? ', bookmarked' : ''}`}
      onPress={() => openPage(detail.book.id, page.id)}
      style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, page.parentPageId ? styles.deeper : null, pressed && { backgroundColor: palette.surface }]}>
      {number === null ? (
        <Icon name={page.parentPageId ? 'arrow-down' : 'map'} size={16} color={palette.textMuted} />
      ) : (
        <Text style={[styles.number, { color: palette.textMuted }]}>{number}</Text>
      )}
      <Text style={[styles.rowTitle, { color: page.status === 'pending' && !writing ? palette.textMuted : palette.text }]} numberOfLines={2}>
        {page.title || 'Untitled chapter'}
      </Text>
      {bookmarked ? <Icon name="bookmark" size={15} color={palette.textMuted} /> : null}
      {writing ? (
        <ActivityIndicator size="small" color={palette.textMuted} />
      ) : failed ? (
        <Icon name="exclamation-triangle" size={16} color={palette.danger} />
      ) : page.status === 'ready' ? (
        <View style={[styles.dot, { backgroundColor: visited ? palette.textFaint : palette.success }]} />
      ) : (
        <View style={[styles.ring, { borderColor: palette.textFaint }]} />
      )}
    </Pressable>
  );
}

/** The book in reading: where the writing is, where you were, and its chapters. */
function Contents({ detail, live }: { detail: DtBookDetail; live: DtBookLive }) {
  const palette = usePalette();
  const refresh = useBookRefresh();
  const { book, pages } = detail;
  const resume = landingPage(detail);
  const started = detail.progress.visited.length > 0;
  // Chapters are numbered; the overview and deep dives aren't.
  const numbers = new Map<string, number>();
  for (const page of pages) if (!isOverviewPage(detail, page) && !page.parentPageId) numbers.set(page.id, numbers.size + 1);
  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={() => refresh(book.id)} />}>
      <Text style={[styles.title, { color: palette.text }]}>{book.title || 'Untitled book'}</Text>
      {book.description ? <Text style={[styles.note, { color: palette.textMuted }]}>{book.description}</Text> : null}
      <Text style={[styles.meta, { color: palette.textFaint }]}>
        {[
          book.status !== 'ready' ? (BOOK_STATUS_LABELS[book.status] ?? book.status) : '',
          book.shared ? (book.canEdit ? 'Shared with you · you can edit' : 'Shared with you · read only') : '',
          book.reading.percent > 0 ? `${book.reading.percent}% read` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <BookActivity detail={detail} live={live} />
      <BookProblems detail={detail} />
      {resume ? <Button label={started ? `Continue: ${resume.title || 'Reading'}` : 'Start Reading'} onPress={() => openPage(book.id, resume.id)} /> : null}
      {pages.length === 0 ? <Text style={[styles.note, { color: palette.textMuted }]}>This book has no pages yet.</Text> : null}
      <View>
        {pages.map((page) => (
          <ContentsRow key={page.id} detail={detail} page={page} number={numbers.get(page.id) ?? null} live={live} />
        ))}
      </View>
      {book.lazy && book.canEdit ? <Text style={[styles.hint, { color: palette.textFaint }]}>Each chapter is written when you first open it.</Text> : null}
    </ScrollView>
  );
}

/** A book: its proposal or outline while you set it up, then its contents. */
export default function Book() {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useDtAuthed();
  const refresh = useBookRefresh();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const book = useDtBook(id);
  const live = useBookWatch(id);
  const detail = book.data;
  const view = detail ? bookView(detail) : null;

  const share = async () => {
    try {
      const markdown = await exportBook(client, id);
      await Share.share({ message: markdown, title: detail?.book.title || 'Book' });
    } catch (error) {
      toast(`Couldn't export it: ${describeError(error)}`, 'error');
    }
  };
  const remove = () =>
    Alert.alert('Delete this book?', 'The book and your progress in it are deleted. Its chats stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteBook(client, id)
            .then(() => {
              refresh(id);
              router.back();
            })
            .catch((error: unknown) => toast(`Couldn't delete it: ${bookErrorText(error)}`, 'error')),
      },
    ]);
  const menu: MenuItem[] = [
    ...(view === 'reader' ? [{ key: 'export', label: 'Share as Markdown', icon: 'arrow-up-on-square' as const, onPress: () => void share() }] : []),
    { key: 'web', label: 'Open in DeepTutor Web App', icon: 'arrow-top-right-on-square', onPress: () => router.push({ pathname: '/learn/web', params: { path: `/learning/books/${encodeURIComponent(id)}`, title: detail?.book.title || 'Book' } }) },
    ...(detail?.book.canDelete ? [{ key: 'delete', label: 'Delete Book', icon: 'trash' as const, destructive: true, onPress: remove }] : []),
  ];

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title={view === 'proposal' ? 'New Book' : view === 'outline' ? 'Outline' : detail?.book.title || 'Book'} menu={menu} />
      {book.isLoading ? (
        <ActivityIndicator style={styles.loading} color={palette.textMuted} />
      ) : book.isError || !detail ? (
        <Pressable accessibilityRole="button" onPress={() => refresh(id)} style={styles.content}>
          <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't open this book: ${describeError(book.error)}. Tap to try again.`}</Text>
        </Pressable>
      ) : view === 'proposal' ? (
        <ProposalView key={`${session.baseUrl} ${id}`} detail={detail} live={live} />
      ) : view === 'outline' && detail.spine ? (
        <OutlineEditor key={`${session.baseUrl} ${id}`} detail={detail} spine={detail.spine} />
      ) : (
        <Contents detail={detail} live={live} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { marginTop: 32 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  hint: { fontFamily: fonts.regular, fontSize: 12 },
  meta: { fontFamily: fonts.regular, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  deeper: { paddingLeft: 20 },
  number: { fontFamily: fonts.medium, fontSize: 14, minWidth: 18, textAlign: 'center' },
  rowTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 4 },
  ring: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, marginHorizontal: 3 },
});
