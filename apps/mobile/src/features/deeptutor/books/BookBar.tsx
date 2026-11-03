import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { useDtBook } from '@/features/deeptutor/queries';
import { fonts, usePalette } from '@/theme';

/** Above a chat about a book's page: the page and its book (tap to read it). The tutor reads that page with each message. */
export function BookBar({ bookId, pageId }: { bookId: string; pageId: string }) {
  const palette = usePalette();
  const book = useDtBook(bookId);
  const page = book.data?.pages.find((item) => item.id === pageId);
  const missing = book.isError;
  return (
    <View style={[styles.wrap, { borderBottomColor: palette.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens the page"
        disabled={missing || !pageId}
        onPress={() => router.push({ pathname: '/learn/books/[id]/[page]', params: { id: bookId, page: pageId } })}
        style={styles.top}
        hitSlop={4}>
        <Icon name="book-open" size={16} color={palette.textMuted} />
        <View style={styles.text}>
          <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
            {missing ? 'A book that is no longer here' : page?.title || 'Book page'}
          </Text>
          {book.data?.book.title ? (
            <Text style={[styles.book, { color: palette.textMuted }]} numberOfLines={1}>
              {book.data.book.title}
            </Text>
          ) : null}
        </View>
        {missing ? null : <Icon name="chevron-right" size={14} color={palette.textFaint} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, gap: 1 },
  title: { fontFamily: fonts.semibold, fontSize: 15 },
  book: { fontFamily: fonts.regular, fontSize: 12 },
});
