import { deleteNote, getNote, noteLink, noteTitle, toggleNotePinned, type NoteSummary } from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import { useState } from 'react';
import { Share } from 'react-native';
import { showActionSheet, showAlert } from '@/components/dialogs';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { fileNameOf, shareFile } from '@/features/settings/exportFile';
import { AccessSheet, type AccessTarget } from '@/features/workspace/AccessSheet';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { notePdfHtml } from './notePdf';
import { useNotesRefresh } from './queries';

/**
 * A note's menu, as the web's: Pin to Sidebar, Share… (when you may change it), Copy Link, Copy
 * Text (its Markdown), Download (.md, .txt or PDF) and Delete (when you may change it). The full
 * note is read first where the list has only its start.
 */
export function useNoteActions() {
  const toast = useToast();
  const { client, session } = useAuthed();
  const refresh = useNotesRefresh();
  const [sharing, setSharing] = useState<AccessTarget | null>(null);

  const full = (id: string) => getNote(client, id);
  const fail = (what: string) => (error: unknown) => toast(`Couldn’t ${what}: ${describeError(error)}`, 'error');

  const pin = (note: NoteSummary) =>
    void toggleNotePinned(client, note.id).then((answer) => {
      refresh();
      toast(answer.pinned ? 'Pinned to the sidebar' : 'Unpinned from the sidebar');
    }, fail(note.pinned ? 'unpin it' : 'pin it'));

  const share = (note: NoteSummary) =>
    void full(note.id).then((whole) => setSharing({ area: 'notes', id: whole.id, name: noteTitle(whole), grants: whole.accessGrants }), fail('open its sharing'));

  const copyText = (note: NoteSummary) =>
    void full(note.id)
      .then((whole) => Clipboard.setStringAsync(whole.md))
      .then(() => toast('Copied'), fail('copy it'));

  const download = (note: NoteSummary, kind: 'md' | 'txt' | 'pdf') =>
    void (async () => {
      const whole = await full(note.id);
      const name = fileNameOf(noteTitle(whole), 'note');
      if (kind !== 'pdf') return shareFile(`${name}.${kind}`, whole.md);
      // Printed on A4 from the note's formatted text (iOS draws it), then named after the note.
      const printed = await Print.printToFileAsync({ html: notePdfHtml(noteTitle(whole), whole.md), width: 595, height: 842, margins: { left: 40, right: 40, top: 40, bottom: 40 } });
      const file = new File(Paths.cache, `${name}.pdf`);
      await new File(printed.uri).move(file, { overwrite: true });
      await Share.share({ url: file.uri, title: noteTitle(whole) });
    })().catch(fail('download it'));

  const askDownload = (note: NoteSummary) =>
    showActionSheet({ title: 'Download', options: ['Markdown (.md)', 'Plain Text (.txt)', 'PDF', 'Cancel'], cancelButtonIndex: 3 }, (index) => {
      const kind = (['md', 'txt', 'pdf'] as const)[index];
      if (kind) download(note, kind);
    });

  const remove = (note: NoteSummary, onDeleted?: () => void) =>
    showAlert(`Delete “${noteTitle(note)}”?`, 'It’s gone for everyone it’s shared with too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteNote(client, note.id).then(() => {
            refresh();
            toast('Note deleted');
            onDeleted?.();
          }, fail('delete it')),
      },
    ]);

  /** The menu for a note; `writable`: you may change it (share and delete). */
  const items = (note: NoteSummary, writable: boolean, onDeleted?: () => void): MenuItem[] => [
    { key: 'pin', label: note.pinned ? 'Unpin from Sidebar' : 'Pin to Sidebar', icon: note.pinned ? 'bookmark-slash' : 'bookmark', onPress: () => pin(note) },
    ...(writable ? [{ key: 'share', label: 'Share…', icon: 'users' as const, onPress: () => share(note) }] : []),
    { key: 'link', label: 'Copy Link', icon: 'link', onPress: () => void Clipboard.setStringAsync(noteLink(session.baseUrl, note.id)).then(() => toast('Link copied')) },
    { key: 'copy', label: 'Copy Text', icon: 'clipboard-document', onPress: () => copyText(note) },
    { key: 'download', label: 'Download…', icon: 'arrow-down-tray', onPress: () => askDownload(note) },
    ...(writable ? [{ key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => remove(note, onDeleted) }] : []),
  ];

  const element = <AccessSheet target={sharing} onClose={() => setSharing(null)} onSaved={refresh} />;
  return { items, pin, element };
}
