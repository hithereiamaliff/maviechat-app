import { deleteBook, type DtBook } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MenuButton } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { BOOK_STATUS_LABELS, bookErrorText } from '@/features/deeptutor/books/labels';
import { useBookRefresh } from '@/features/deeptutor/books/useBooks';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { sessionDate, useDtBooks } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const IN_PROGRESS = new Set(['draft', 'spine_ready', 'compiling', 'paused']);

/** What tapping a book does next, in words. */
function nextStep(book: DtBook): string {
  if (book.status === 'draft' || book.status === 'spine_ready') return book.canEdit ? 'Continue setup' : 'Not written yet';
  return book.reading.visitedPages > 0 ? 'Continue reading' : 'Start reading';
}

/** Your books and those shared with you, newest first: where each is, and how far you've read. */
export default function Books() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const refresh = useBookRefresh();
  const books = useDtBooks();
  const [query, setQuery] = useState('');
  const list = books.data?.books ?? [];
  const canCreate = books.data?.canCreate ?? false;
  const wanted = query.trim().toLocaleLowerCase();
  const shown = wanted ? list.filter((book) => `${book.title} ${book.description}`.toLocaleLowerCase().includes(wanted)) : list;
  const ready = list.filter((book) => book.status === 'ready').length;
  const going = list.filter((book) => IN_PROGRESS.has(book.status)).length;

  const remove = (book: DtBook) =>
    Alert.alert('Delete this book?', `"${book.title || 'Untitled book'}" and your progress in it are deleted. Its chats stay.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteBook(client, book.id)
            .then(() => refresh(book.id))
            .catch((error: unknown) => toast(`Couldn't delete it: ${bookErrorText(error)}`, 'error')),
      },
    ]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Books" accessory={canCreate ? <IconButton icon="plus" label="New Book" onPress={() => router.push('/learn/books/new')} /> : undefined} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={() => refresh(null)} />}>
        {list.length > 3 ? (
          <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search books"
              placeholderTextColor={palette.textFaint}
              autoCorrect={false}
              style={[styles.searchInput, { color: palette.text }]}
              accessibilityLabel="Search books"
            />
          </View>
        ) : null}
        {list.length ? (
          <Text style={[styles.summary, { color: palette.textMuted }]}>
            {[`${list.length} ${list.length === 1 ? 'book' : 'books'}`, ready ? `${ready} ready` : '', going ? `${going} in progress` : ''].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        {books.isLoading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
        {books.isError ? (
          <Pressable accessibilityRole="button" onPress={() => refresh(null)}>
            <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't load your books: ${describeError(books.error)}. Tap to try again.`}</Text>
          </Pressable>
        ) : null}
        {!books.isLoading && !books.isError && list.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: palette.text }]}>No books yet</Text>
            <Text style={[styles.note, { color: palette.textMuted }]}>
              {canCreate
                ? 'Say what you want to learn, and DeepTutor writes a book on it: you agree the chapters first, then every page is written in full.'
                : "Books shared with you will show here. This account can't write new ones."}
            </Text>
            {canCreate ? <Button label="New Book" onPress={() => router.push('/learn/books/new')} /> : null}
          </View>
        ) : null}
        {wanted && shown.length === 0 && list.length ? <Text style={[styles.note, { color: palette.textMuted }]}>No books match.</Text> : null}
        {shown.map((book) => (
          <Pressable
            key={book.id}
            accessibilityRole="button"
            accessibilityHint={nextStep(book)}
            onPress={() => router.push({ pathname: '/learn/books/[id]', params: { id: book.id } })}
            style={({ pressed }) => [styles.card, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <View style={styles.cardTop}>
              <View style={styles.cardText}>
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
                  {book.title || 'Untitled book'}
                </Text>
                {book.description ? (
                  <Text style={[styles.subtitle, { color: palette.textMuted }]} numberOfLines={2}>
                    {book.description}
                  </Text>
                ) : null}
              </View>
              {book.canDelete ? (
                <MenuButton
                  label={`Options for ${book.title || 'this book'}`}
                  size={18}
                  color={palette.textMuted}
                  items={[{ key: 'delete', label: 'Delete Book', icon: 'trash', destructive: true, onPress: () => remove(book) }]}
                />
              ) : null}
            </View>
            {book.status !== 'ready' || book.shared ? (
              <View style={styles.pills}>
                {book.status !== 'ready' ? (
                  <View style={[styles.pill, { backgroundColor: book.status === 'paused' || book.status === 'error' ? palette.surfaceStrong : palette.surface }]}>
                    <Text style={[styles.pillText, { color: book.status === 'error' ? palette.danger : palette.textMuted }]}>{BOOK_STATUS_LABELS[book.status] ?? book.status}</Text>
                  </View>
                ) : null}
                {book.shared ? (
                  <View style={[styles.pill, { backgroundColor: palette.surface }]}>
                    <Text style={[styles.pillText, { color: palette.textMuted }]}>{book.canEdit ? 'Shared · you can edit' : 'Shared · read only'}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {book.reading.percent > 0 ? (
              <View style={[styles.track, { backgroundColor: palette.surfaceStrong }]} accessibilityLabel={`${book.reading.percent}% read`}>
                <View style={[styles.fill, { width: `${book.reading.percent}%`, backgroundColor: palette.success }]} />
              </View>
            ) : null}
            <View style={styles.footer}>
              <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
                {[
                  book.chapterCount ? `${book.chapterCount} ${book.chapterCount === 1 ? 'chapter' : 'chapters'}` : '',
                  book.reading.percent > 0 ? `${book.reading.percent}% read` : '',
                  sessionDate(book.updatedAt),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <Text style={[styles.next, { color: palette.link }]}>{nextStep(book)}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 40, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  summary: { fontFamily: fonts.regular, fontSize: 13 },
  loading: { marginTop: 32 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  empty: { gap: 10, marginTop: 24 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 18 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 14, gap: 8 },
  cardTop: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  cardText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.semibold, fontSize: 16 },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontFamily: fonts.medium, fontSize: 12 },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { flex: 1, fontFamily: fonts.regular, fontSize: 12 },
  next: { fontFamily: fonts.medium, fontSize: 13 },
});
