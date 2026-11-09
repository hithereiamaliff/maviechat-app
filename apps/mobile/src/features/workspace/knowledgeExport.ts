import { exportWorkspaceKnowledge, zipEntryCount } from '@maviechat/owui-protocol';
import { useToast } from '@/components/Toast';
import { fileNameOf, shareFile } from '@/features/settings/exportFile';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';

/** The menu label: what comes out is the text the server read, not the original files. */
export const EXPORT_LABEL = 'Export as Text (ZIP)';

/**
 * Admins' export of a collection (the web's Export): a ZIP with each file's text as the server
 * read it, handed to the share sheet (Save to Files, AirDrop, Mail…). Not for connected
 * collections (the server keeps their documents elsewhere).
 */
export function useKnowledgeExport(): (knowledge: { id: string; name: string }) => void {
  const { client } = useAuthed();
  const toast = useToast();
  return (knowledge) =>
    void exportWorkspaceKnowledge(client, knowledge.id)
      .then(async (bytes) => {
        if (zipEntryCount(bytes) === 0) return toast('Nothing to export yet: none of its files has text the server has read.');
        await shareFile(`${fileNameOf(knowledge.name, 'Knowledge')}.zip`, bytes);
      })
      .catch((error: unknown) => toast(`Couldn’t export it: ${describeError(error)}`, 'error'));
}
