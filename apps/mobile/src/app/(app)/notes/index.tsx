import { noteHtml } from '@maviechat/owui-markdown';
import { createNote, newNoteTitle, noteLink, noteTitle, type NoteSummary, type NoteView, type OwuiClient } from '@maviechat/owui-protocol';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { groupNotes, notePreview, noteWhen } from '@/features/notes/noteText';
import { useNotesList, useNotesOn, useNotesRefresh } from '@/features/notes/queries';
import { useNoteActions } from '@/features/notes/useNoteActions';
import { plural } from '@/features/workspace/EditorParts';
import { ListControls } from '@/features/workspace/ListControls';
import { ListState, listStyles, WorkspaceList, WorkspaceRow } from '@/features/workspace/WorkspaceList';
import { setDevicePrefs, useDevicePrefs } from '@/lib/devicePrefs';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { useDebounced } from '@/lib/useDebounced';
import { fonts, radius, usePalette } from '@/theme';

type Row = { kind: 'group'; key: string; label: string } | { kind: 'note'; key: string; note: NoteSummary } | { kind: 'pair'; key: string; notes: NoteSummary[] };

/** A new note, named with today's date as the web names one. */
const makeNote = (client: OwuiClient) => createNote(client, { title: newNoteTitle(new Date()) });

/** Markdown and text files picked in Files, read on the phone (5 MB each at most). */
async function pickNoteFiles(): Promise<{ name: string; text: string }[] | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
  if (picked.canceled) return null;
  const files = picked.assets.filter((asset) => /\.(md|markdown|txt)$/i.test(asset.name));
  if (files.length < picked.assets.length) throw new Error('only .md and .txt files can be notes');
  if (files.some((asset) => (asset.size ?? 0) > 5 * 1024 * 1024)) throw new Error('a file is too big to import on the phone');
  return Promise.all(files.map(async (asset) => ({ name: asset.name.replace(/\.(md|markdown|txt)$/i, ''), text: await new File(asset.uri).text() })));
}

/**
 * Open WebUI's Notes: search (words in the title or the text), whose (all, yours, shared with you),
 * the ones shared with you to read only, newest first or by name, more as you scroll, under the
 * web's date headings, as a list or as a grid of cards (kept on this phone, as the web keeps it per
 * browser). New makes a note named with today's date and opens it, as on the web; Import makes
 * notes from .md and .txt files. Each note's menu pins it to the sidebar, shares, copies,
 * downloads or deletes it.
 */
export default function Notes() {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useAuthed();
  const on = useNotesOn();
  const refresh = useNotesRefresh();
  const actions = useNoteActions();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const [view, setView] = useState<NoteView>('');
  const [byName, setByName] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const shownReadOnly = readOnly && view !== 'created';
  const notes = useNotesList({ query: debounced, view, readOnly: shownReadOnly, orderBy: byName ? 'name' : 'updated_at', direction: byName ? 'asc' : 'desc' });
  const items = useMemo(() => notes.data?.pages.flatMap((page) => page.items) ?? [], [notes.data]);
  const [now] = useState(() => new Date().getTime());
  const grid = useDevicePrefs().notesGrid;
  const rows = useMemo<Row[]>(
    () =>
      groupNotes(items, new Date(now)).flatMap(({ group, notes: inGroup }) => {
        const heading: Row = { kind: 'group', key: `g-${group.key}`, label: group.label };
        if (!grid) return [heading, ...inGroup.map((note): Row => ({ kind: 'note', key: note.id, note }))];
        const pairs: Row[] = [];
        for (let start = 0; start < inGroup.length; start += 2) pairs.push({ kind: 'pair', key: `p-${inGroup[start]?.id ?? start}`, notes: inGroup.slice(start, start + 2) });
        return [heading, ...pairs];
      }),
    [items, grid, now],
  );

  const newNote = () => {
    if (busy) return;
    setBusy(true);
    void makeNote(client)
      .then((note) => {
        refresh();
        router.push({ pathname: '/notes/[id]', params: { id: note.id, new: '1' } });
      }, (error: unknown) => toast(`Couldn’t make a note: ${describeError(error)}`, 'error'))
      .finally(() => setBusy(false));
  };
  const importNotes = async () => {
    let files: { name: string; text: string }[] | null;
    try {
      files = await pickNoteFiles();
    } catch (error) {
      return toast(`Couldn’t read them: ${describeError(error)}`, 'error');
    }
    if (!files?.length) return;
    setBusy(true);
    const failed: string[] = [];
    for (const file of files) {
      try {
        await createNote(client, { title: file.name, md: file.text, html: noteHtml(file.text) });
      } catch (error) {
        failed.push(`${file.name}: ${describeError(error)}`);
      }
    }
    setBusy(false);
    refresh();
    if (!failed.length) toast(`Imported ${plural(files.length, 'note')}`);
    else toast(`Imported ${files.length - failed.length} of ${files.length}. ${failed[0]}`, 'error');
  };
  const more: MenuItem[] = [
    grid
      ? { key: 'view', label: 'Show as List', icon: 'list-bullet', onPress: () => setDevicePrefs({ notesGrid: false }) }
      : { key: 'view', label: 'Show as Grid', icon: 'squares-2x2', onPress: () => setDevicePrefs({ notesGrid: true }) },
    { key: 'import', label: 'Import .md or .txt…', icon: 'arrow-up-tray', onPress: () => void importNotes() },
    ...(view !== 'created'
      ? [{ key: 'read-only', label: readOnly ? 'Show Notes You Can Edit' : 'Show Read-Only Notes', icon: readOnly ? ('pencil-square' as const) : ('eye' as const), onPress: () => setReadOnly(!readOnly) }]
      : []),
  ];

  const header = (
    <View style={listStyles.top}>
      <ListControls query={query} setQuery={setQuery} placeholder="Search notes" view={view} setView={setView} byName={byName} setByName={setByName} onNew={newNote} more={more} />
      {shownReadOnly ? <Text style={[styles.note, { color: palette.textMuted }]}>Shared with you to read only.</Text> : null}
      <ListState loading={notes.isLoading} error={notes.isError ? notes.error : null} empty={Boolean(notes.data) && !items.length} filtered={Boolean(debounced || view || shownReadOnly)} noun="notes" />
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ChatHeader title="Notes" menu={[{ key: 'web', label: 'Open on the Web', icon: 'globe-alt', onPress: () => void WebBrowser.openBrowserAsync(`${session.baseUrl}/notes`) }]} />
      {!on ? (
        <Text style={[styles.note, styles.pad, { color: palette.textMuted }]}>Notes are turned off for your account.</Text>
      ) : (
        <View style={listStyles.flex}>
          <WorkspaceList
            items={rows}
            keyOf={(row: Row) => row.key}
            header={header}
            paging={notes}
            onRefresh={refresh}
            renderItem={(row) =>
              row.kind === 'group' ? (
                <Text style={[styles.group, { color: palette.textMuted }]} accessibilityRole="header">
                  {row.label}
                </Text>
              ) : row.kind === 'pair' ? (
                <View style={styles.pair}>
                  {row.notes.map((note) => (
                    <NoteCard key={note.id} note={note} now={now} menu={actions.items(note, !shownReadOnly)} />
                  ))}
                  {row.notes.length === 1 ? <View style={styles.flex} /> : null}
                </View>
              ) : (
                <WorkspaceRow
                  leading={<Icon name="document-text" size={22} color={palette.textMuted} />}
                  title={noteTitle(row.note)}
                  detail={notePreview(row.note.preview) || undefined}
                  facts={[row.note.pinned ? 'Pinned' : '', noteWhen(row.note.updatedAt, now), row.note.ownerId !== session.user.id && row.note.ownerName ? `by ${row.note.ownerName}` : ''].filter(Boolean).join(' · ')}
                  menu={actions.items(row.note, !shownReadOnly)}
                  onPress={() => router.push({ pathname: '/notes/[id]', params: { id: row.note.id } })}
                  hint={`Opens the note (${noteLink(session.baseUrl, row.note.id)} on the web)`}
                />
              )
            }
          />
          {actions.element}
        </View>
      )}
    </View>
  );
}

/** A note as the web's grid shows it: its title and menu, the start of its text, whose and when. */
function NoteCard({ note, now, menu }: { note: NoteSummary; now: number; menu: MenuItem[] }) {
  const palette = usePalette();
  const preview = notePreview(note.preview);
  const owner = note.ownerName ? `${note.ownerName.charAt(0).toUpperCase()}${note.ownerName.slice(1)}` : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={noteTitle(note)}
      accessibilityHint="Opens the note"
      onPress={() => router.push({ pathname: '/notes/[id]', params: { id: note.id } })}
      style={({ pressed }) => [styles.card, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : palette.background }]}>
      <View style={styles.cardTop}>
        <Text style={[styles.cardTitle, { color: palette.text }]} numberOfLines={2}>
          {noteTitle(note)}
        </Text>
        <MenuButton items={menu} label={`Options for ${noteTitle(note)}`} size={16} color={palette.textMuted} />
      </View>
      <Text style={[styles.cardText, { color: preview ? palette.textMuted : palette.textFaint }]} numberOfLines={5}>
        {preview || 'No content'}
      </Text>
      <View style={styles.cardFoot}>
        {note.pinned ? <Icon name="bookmark" size={12} color={palette.textFaint} /> : null}
        <Text style={[styles.cardMeta, styles.flex, { color: palette.textFaint }]} numberOfLines={1}>
          {owner}
        </Text>
        <Text style={[styles.cardMeta, { color: palette.textFaint }]}>{noteWhen(note.updatedAt, now)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { padding: 16 },
  flex: { flex: 1 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  group: { fontFamily: fonts.medium, fontSize: 12, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  pair: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingBottom: 10 },
  card: { flex: 1, minHeight: 150, padding: 12, gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  cardTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  cardText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardMeta: { fontFamily: fonts.regular, fontSize: 11 },
});
