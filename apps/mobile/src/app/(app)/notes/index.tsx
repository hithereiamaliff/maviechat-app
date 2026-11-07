import { noteHtml } from '@maviechat/owui-markdown';
import { createNote, newNoteTitle, noteLink, noteTitle, type NoteSummary, type NoteView, type OwuiClient } from '@maviechat/owui-protocol';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { notePreview, noteWhen } from '@/features/notes/noteText';
import { useNotesList, useNotesOn, useNotesRefresh } from '@/features/notes/queries';
import { useNoteActions } from '@/features/notes/useNoteActions';
import { plural } from '@/features/workspace/EditorParts';
import { ListControls } from '@/features/workspace/ListControls';
import { ListState, listStyles, WorkspaceList, WorkspaceRow } from '@/features/workspace/WorkspaceList';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { useDebounced } from '@/lib/useDebounced';
import { fonts, usePalette } from '@/theme';

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
 * the ones shared with you to read only, newest first or by name, more as you scroll. New makes a
 * note named with today's date and opens it, as on the web; Import makes notes from .md and .txt
 * files. Each note's menu pins it to the sidebar, shares, copies, downloads or deletes it.
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
  const items = notes.data?.pages.flatMap((page) => page.items) ?? [];
  const [now] = useState(() => new Date().getTime());

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
            items={items}
            keyOf={(note: NoteSummary) => note.id}
            header={header}
            paging={notes}
            onRefresh={refresh}
            renderItem={(note) => (
              <WorkspaceRow
                leading={<Icon name="document-text" size={22} color={palette.textMuted} />}
                title={noteTitle(note)}
                detail={notePreview(note.preview) || undefined}
                facts={[note.pinned ? 'Pinned' : '', noteWhen(note.updatedAt, now), note.ownerId !== session.user.id && note.ownerName ? `by ${note.ownerName}` : ''].filter(Boolean).join(' · ')}
                menu={actions.items(note, !shownReadOnly)}
                onPress={() => router.push({ pathname: '/notes/[id]', params: { id: note.id } })}
                hint={`Opens the note (${noteLink(session.baseUrl, note.id)} on the web)`}
              />
            )}
          />
          {actions.element}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { padding: 16 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
