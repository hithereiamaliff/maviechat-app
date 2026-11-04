import { childPages, noteTitle, topLevelPages, type DtNoteSummary } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useNoteActions } from '@/features/deeptutor/notes/actions';
import { NoteRow } from '@/features/deeptutor/notes/NoteRow';
import { useDueCards, useNotePages, useNotesRefresh } from '@/features/deeptutor/notes/queries';
import { describeError } from '@/lib/errors';
import { fonts, radius, usePalette } from '@/theme';

/**
 * Co-Writer's library, as DeepTutor's "Learning notebook" page has it: pinned pages, then the
 * rest by when they changed (top-level ones; a search reaches every page, naming its parent);
 * flashcards due; a new page (written in DeepTutor's editor) or a Word file imported.
 */
export default function Notebook() {
  const palette = usePalette();
  const pages = useNotePages();
  const due = useDueCards();
  const refresh = useNotesRefresh();
  const actions = useNoteActions();
  const [query, setQuery] = useState('');
  const all = pages.data ?? [];
  const byId = new Map(all.map((page) => [page.id, page]));
  const needle = query.trim().toLowerCase();
  const shown = needle ? all.filter((page) => noteTitle(page).toLowerCase().includes(needle) || page.preview.toLowerCase().includes(needle)) : topLevelPages(all);
  const pinned = shown.filter((page) => page.pinned);
  const rest = shown.filter((page) => !page.pinned);
  const dueCount = due.data?.length ?? 0;

  const row = (page: DtNoteSummary) => {
    const subpages = childPages(all, page.id).length;
    const parent = needle && page.parentId ? byId.get(page.parentId) : undefined;
    return (
      <NoteRow
        key={page.id}
        page={page}
        subpages={subpages}
        parent={parent ? noteTitle(parent) : undefined}
        onPress={() => router.push({ pathname: '/learn/notes/[id]', params: { id: page.id } })}
        menu={[
          { key: 'pin', label: page.pinned ? 'Unpin' : 'Pin to Top', icon: 'bookmark', onPress: () => actions.setPinned(page, !page.pinned) },
          { key: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: () => actions.remove(page, subpages) },
        ]}
      />
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader
        title="Learning Notebook"
        menu={[
          { key: 'import', label: 'Import Word', icon: 'arrow-up-on-square', onPress: () => void actions.importWord() },
          { key: 'anki', label: 'Export Flashcards for Anki', icon: 'arrow-down', onPress: () => void actions.exportAnki() },
          { key: 'web', label: 'Open on the Web', icon: 'globe-alt', onPress: () => router.push({ pathname: '/learn/web', params: { path: '/co-writer', title: 'Co-Writer' } }) },
        ]}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        <View style={styles.buttons}>
          <View style={styles.flex}>
            <Button label="New Page" onPress={() => void actions.create()} />
          </View>
          {dueCount ? (
            <View style={styles.flex}>
              <Button label={`Review ${dueCount} ${dueCount === 1 ? 'Card' : 'Cards'}`} variant="secondary" onPress={() => router.push('/learn/notes/review')} />
            </View>
          ) : null}
        </View>
        <Text style={[styles.note, { color: palette.textFaint }]}>Pages are written in DeepTutor’s editor; here you read them, keep them in order, and review their flashcards.</Text>
        {all.length ? (
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${all.length} ${all.length === 1 ? 'page' : 'pages'}`}
            placeholderTextColor={palette.textFaint}
            clearButtonMode="while-editing"
            accessibilityLabel="Search pages"
            style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
        ) : null}
        {pages.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {pages.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load your notebook: ${describeError(pages.error)}`}</Text> : null}
        {pages.data && !all.length ? (
          <View style={[styles.emptyCard, { borderColor: palette.border }]}>
            <Icon name="pencil-square" size={28} color={palette.textFaint} />
            <Text style={[styles.emptyText, { color: palette.textMuted }]}>Your notebook is empty: start a page, or import a Word file.</Text>
          </View>
        ) : null}
        {needle && !shown.length ? <Text style={[styles.note, styles.center, { color: palette.textMuted }]}>Nothing matches.</Text> : null}
        {pinned.length ? <Text style={[styles.section, { color: palette.textMuted }]}>Pinned</Text> : null}
        {pinned.map(row)}
        {rest.length && !needle ? <Text style={[styles.section, { color: palette.textMuted }]}>Recently edited</Text> : null}
        {rest.map(row)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  buttons: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  center: { textAlign: 'center' },
  search: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  emptyCard: { alignItems: 'center', gap: 8, padding: 24, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, borderStyle: 'dashed' },
  emptyText: { fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 8, marginLeft: 4 },
});
