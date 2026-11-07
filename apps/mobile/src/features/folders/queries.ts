import { listFolderChats, listFolderChatsForAll, listSharedFolders, type FolderChat } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { useAuthed } from '@/lib/server';

/**
 * Folders other people share with you (and the folders inside them). Under `['folders']`, so
 * whatever refreshes your folders refreshes these too. A server without them gives none.
 */
export function useSharedFolders(enabled: boolean) {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['folders', 'shared'], queryFn: () => listSharedFolders(client).catch(() => []), enabled });
}

/** The first page of a folder's chats, everyone's, as the web lists them; else just yours (`/chats/folder/{id}/list`). */
export const folderChatsFirstPage = (client: Parameters<typeof listFolderChatsForAll>[0], folderId: string): Promise<FolderChat[]> =>
  listFolderChatsForAll(client, folderId).then(
    (page) => page.chats,
    () => listFolderChats(client, folderId),
  );
