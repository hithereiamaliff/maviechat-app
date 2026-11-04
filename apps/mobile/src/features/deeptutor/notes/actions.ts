import { ankiExport, createNotePage, deleteNotePage, importWord, noteTitle, updateNotePage, wordExport, type DtNotePage, type DtNoteSummary } from '@maviechat/deeptutor-protocol';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { useToast } from '@/components/Toast';
import { fileNameOf, shareFile } from '@/features/settings/exportFile';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { useNotesRefresh } from './queries';

const WORD_LIMIT_BYTES = 20 * 1024 * 1024;

/** Opens a page in DeepTutor's own editor, in the app. */
export function editOnWeb(page: Pick<DtNoteSummary, 'id' | 'title'>): void {
  router.push({ pathname: '/learn/web', params: { path: `/co-writer/${page.id}`, title: noteTitle(page) } });
}

/** What can be done to pages from the library and a page: make, import, pin, delete, export. */
export function useNoteActions() {
  const { client } = useDtAuthed();
  const toast = useToast();
  const refresh = useNotesRefresh();
  const failed = (what: string) => (error: unknown) => toast(`Couldn’t ${what}: ${describeError(error)}`, 'error');

  return {
    /** A blank page, opened in DeepTutor's editor (writing blocks happens there). */
    create: async (parentId: string | null = null) => {
      try {
        const page = await createNotePage(client, { parentId });
        refresh();
        editOnWeb(page);
      } catch (error) {
        failed('make the page')(error);
      }
    },
    importWord: async () => {
      const picked = await DocumentPicker.getDocumentAsync({ type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', copyToCacheDirectory: true });
      const asset = picked.canceled ? undefined : picked.assets[0];
      if (!asset) return;
      if ((asset.size ?? 0) > WORD_LIMIT_BYTES) return toast('DeepTutor takes Word files up to 20 MB.', 'error');
      try {
        const page = await importWord(client, { uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, asset.name);
        refresh();
        toast('Imported');
        router.push({ pathname: '/learn/notes/[id]', params: { id: page.id } });
      } catch (error) {
        failed('import it')(error);
      }
    },
    setPinned: (page: DtNoteSummary, pinned: boolean) => void updateNotePage(client, page, { pinned }).then(refresh, failed(pinned ? 'pin it' : 'unpin it')),
    remove: (page: DtNoteSummary, subpages: number, after?: () => void) =>
      Alert.alert(`Delete “${noteTitle(page)}”?`, subpages ? `Its ${subpages === 1 ? 'subpage moves' : `${subpages} subpages move`} up a level. This can’t be undone.` : 'This can’t be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            void deleteNotePage(client, page.id).then(() => {
              refresh();
              toast('Page deleted');
              after?.();
            }, failed('delete it')),
        },
      ]),
    exportMarkdown: (page: DtNotePage) => void shareFile(`${fileNameOf(noteTitle(page), 'Page')}.md`, page.content).catch(failed('export it')),
    exportWord: async (page: DtNotePage) => {
      try {
        await shareFile(`${fileNameOf(noteTitle(page), 'Page')}.docx`, await wordExport(client, page));
      } catch (error) {
        failed('export it')(error);
      }
    },
    exportAnki: async (page?: DtNoteSummary) => {
      try {
        await shareFile(`${fileNameOf(page ? noteTitle(page) : 'DeepTutor flashcards', 'Flashcards')}.txt`, await ankiExport(client, page?.id));
      } catch (error) {
        failed('export the flashcards')(error);
      }
    },
  };
}
