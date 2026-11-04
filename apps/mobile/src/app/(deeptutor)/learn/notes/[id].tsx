import { childPages, coverColor, noteTitle, pageTrail } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import type { MenuItem } from '@/components/Menu';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { editOnWeb, useNoteActions } from '@/features/deeptutor/notes/actions';
import { DitoSection } from '@/features/deeptutor/notes/DitoSection';
import { NoteRow } from '@/features/deeptutor/notes/NoteRow';
import { useNoteBacklinks, useNotePage, useNotePages, useNotesRefresh } from '@/features/deeptutor/notes/queries';
import { describeError } from '@/lib/errors';
import { Markdown } from '@/markdown/Markdown';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

/**
 * A Co-Writer page to read: where it sits, its icon, cover and title, then the page itself (from
 * DeepTutor's Markdown copy of its blocks), its subpages and the pages that link to it. Editing
 * opens DeepTutor's editor; coming back reads the page again.
 */
export default function NotePageScreen() {
  const palette = usePalette();
  const { session } = useDtAuthed();
  const id = one(useLocalSearchParams<{ id: string }>().id);
  const page = useNotePage(id);
  const pages = useNotePages();
  const backlinks = useNoteBacklinks(id);
  const refresh = useNotesRefresh();
  const actions = useNoteActions();
  const editing = useRef(false);
  const queryClient = useQueryClient();
  const shownOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      // Back on the page (from DeepTutor's editor, or a conversation with Dito): it, its
      // conversations and Dito's suggestions may have changed.
      if (shownOnce.current || editing.current) void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'notes'] });
      shownOnce.current = true;
      editing.current = false;
    }, [queryClient, session.baseUrl]),
  );
  const data = page.data;
  const all = pages.data ?? [];
  const trail = pageTrail(all, id);
  const subpages = childPages(all, id);
  const edit = () => {
    if (!data) return;
    editing.current = true;
    editOnWeb(data);
  };
  const menu: MenuItem[] = data
    ? [
        { key: 'edit', label: 'Edit on the Web', icon: 'pencil-square', onPress: edit },
        { key: 'sub', label: 'New Subpage', icon: 'plus', onPress: () => void actions.create(id) },
        { key: 'pin', label: data.pinned ? 'Unpin' : 'Pin to Top', icon: 'bookmark', onPress: () => actions.setPinned(data, !data.pinned) },
        { key: 'md', label: 'Export Markdown', icon: 'arrow-down', onPress: () => actions.exportMarkdown(data) },
        { key: 'word', label: 'Export Word', icon: 'document-text', onPress: () => void actions.exportWord(data) },
        { key: 'anki', label: 'Export Flashcards for Anki', icon: 'rectangle-stack', onPress: () => void actions.exportAnki(data) },
        { key: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: () => actions.remove(data, subpages.length, () => router.back()) },
      ]
    : [];

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title={data ? noteTitle(data) : 'Page'} menu={menu} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        {page.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {page.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t open it: ${describeError(page.error)}`}</Text> : null}
        {data ? (
          <>
            {trail.length ? (
              <View style={styles.trail}>
                {trail.map((parent) => (
                  <Pressable key={parent.id} accessibilityRole="link" onPress={() => router.push({ pathname: '/learn/notes/[id]', params: { id: parent.id } })} hitSlop={4}>
                    <Text style={[styles.crumb, { color: palette.link }]}>{`${noteTitle(parent)} ›`}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {data.cover ? <View style={[styles.cover, { backgroundColor: coverColor(data.cover) || palette.surfaceStrong }]} /> : null}
            {data.icon ? <Text style={styles.icon}>{data.icon}</Text> : null}
            <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
              {noteTitle(data)}
            </Text>
            {data.blocks === null ? <Text style={[styles.note, { color: palette.textFaint }]}>An older page, in Markdown: DeepTutor’s editor turns it into blocks when you open it there.</Text> : null}
            {data.content.trim() ? <Markdown text={data.content} baseUrl={session.baseUrl} token={session.token ?? undefined} /> : <Text style={[styles.note, { color: palette.textFaint }]}>An empty page.</Text>}
            <Button label="Edit on the Web" variant="secondary" onPress={edit} />
            <DitoSection page={data} />
            {subpages.length ? <Text style={[styles.section, { color: palette.textMuted }]}>Subpages</Text> : null}
            {subpages.map((child) => (
              <NoteRow key={child.id} page={child} subpages={childPages(all, child.id).length} onPress={() => router.push({ pathname: '/learn/notes/[id]', params: { id: child.id } })} />
            ))}
            {backlinks.data?.length ? <Text style={[styles.section, { color: palette.textMuted }]}>Linked from</Text> : null}
            {backlinks.data?.map((link) => <NoteRow key={link.id} page={link} onPress={() => router.push({ pathname: '/learn/notes/[id]', params: { id: link.id } })} />)}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  trail: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  crumb: { fontFamily: fonts.regular, fontSize: 13 },
  cover: { height: 56, borderRadius: 10 },
  icon: { fontSize: 36 },
  title: { fontFamily: fonts.semibold, fontSize: 24, lineHeight: 30 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 12, marginLeft: 4 },
});
