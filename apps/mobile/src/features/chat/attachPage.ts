import { attachWebAddress, uuidv4, type OwuiClient } from '@maviechat/owui-protocol';
import { patchFile, removeFile, updateDraft } from './drafts';

/**
 * A web page attached to a draft, as Attach Webpage does: shown at once as loading, then read by
 * the server (a YouTube address gives the video's transcript). Taken off again if that fails.
 */
export async function attachPageToDraft(client: OwuiClient, draftKey: string, url: string): Promise<void> {
  const itemId = uuidv4();
  updateDraft(draftKey, (draft) => ({ ...draft, files: [...draft.files, { type: 'text', id: null, url, name: url, status: 'uploading', itemId }] }));
  try {
    patchFile(draftKey, itemId, { ...(await attachWebAddress(client, url)), itemId });
  } catch (error) {
    removeFile(draftKey, itemId);
    throw error;
  }
}
