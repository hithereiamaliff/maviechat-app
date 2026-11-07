import { accessRights, deleteFolder, folderChatsForExport, folderExportName, getFolder, markFolderRead, setFolderExpanded, type FolderDetail } from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Share } from 'react-native';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { AccessSheet, type AccessTarget } from '@/features/workspace/AccessSheet';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities } from '@/lib/server';
import { FolderSheet, type FolderSheetTarget } from './FolderSheet';

export interface FolderRef {
  id: string;
  name: string;
}

interface Options {
  /** Before the app goes to a folder's page (the sidebar closes itself). */
  onNavigate?: () => void;
  /** After a folder was made: inside `parentId` when it was made in another one. */
  onCreated?: (folder: FolderDetail, parentId: string | null) => void;
}

/**
 * The web's folder menu: New Chat, Create Folder (inside this one), Mark all as read, Edit,
 * Export, Share and Delete, with the sheets they open. Render `element` once where it's used.
 */
export function useFolderActions({ onNavigate, onCreated }: Options = {}) {
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [sheet, setSheet] = useState<FolderSheetTarget | null>(null);
  const [sharing, setSharing] = useState<AccessTarget | null>(null);
  const canExport = capabilities?.can('chat.export', true) ?? false;
  const canShare = capabilities ? accessRights(capabilities, 'folders').list : false;

  const refresh = () =>
    Promise.all(
      [['folders'], ['folder'], ['folder-chats'], ['chats']].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );

  const markRead = async (folder: FolderRef) => {
    try {
      await markFolderRead(client, folder.id);
      await refresh();
    } catch (error) {
      toast(`Couldn’t mark it as read: ${describeError(error)}`, 'error');
    }
  };

  // As the web exports a folder: every chat in it and the folders inside it, whole, in one JSON file.
  const exportChats = async (folder: FolderRef) => {
    try {
      const chats = await folderChatsForExport(client, folder.id);
      const file = new File(Paths.cache, folderExportName(folder.name));
      file.create({ overwrite: true });
      await file.write(JSON.stringify(chats));
      await Share.share({ url: file.uri, title: folder.name });
    } catch (error) {
      toast(`Couldn’t export the folder: ${describeError(error)}`, 'error');
    }
  };

  const share = async (folder: FolderRef) => {
    try {
      const detail = await getFolder(client, folder.id);
      setSharing({ area: 'folders', id: folder.id, name: detail.name || folder.name, grants: detail.access_grants ?? [] });
    } catch (error) {
      toast(`Couldn’t open its sharing: ${describeError(error)}`, 'error');
    }
  };

  const remove = (folder: FolderRef, onDeleted?: () => void) => {
    const run = (deleteContents: boolean) =>
      deleteFolder(client, folder.id, { deleteContents }).then(
        () => {
          toast('Folder deleted');
          onDeleted?.();
          void refresh();
        },
        (error: unknown) => toast(`Couldn’t delete the folder: ${describeError(error)}`, 'error'),
      );
    Alert.alert(`Delete “${folder.name}”?`, 'The folders inside it are deleted too. Its chats can go with it, or move out of it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Folder and Chats', style: 'destructive', onPress: () => void run(true) },
      { text: 'Delete Folder, Keep Chats', onPress: () => void run(false) },
    ]);
  };

  /** The menu for a folder; `newChat: false` leaves out New Chat (on the folder's own page, which is one). */
  const items = (folder: FolderRef, { onDeleted, newChat = true }: { onDeleted?: () => void; newChat?: boolean } = {}): MenuItem[] => [
    ...(newChat
      ? [
          {
            key: 'new',
            label: 'New Chat',
            icon: 'pencil-square' as const,
            onPress: () => {
              onNavigate?.();
              router.replace({ pathname: '/folders/[id]', params: { id: folder.id } });
            },
          },
        ]
      : []),
    { key: 'subfolder', label: 'Create Folder', icon: 'folder-plus', onPress: () => setSheet({ mode: 'create', parentId: folder.id, parentName: folder.name }) },
    { key: 'read', label: 'Mark all as read', icon: 'envelope-open', onPress: () => void markRead(folder) },
    { key: 'edit', label: 'Edit', icon: 'pencil', onPress: () => setSheet({ mode: 'edit', folderId: folder.id }) },
    ...(canExport ? [{ key: 'export', label: 'Export', icon: 'arrow-down-tray' as const, onPress: () => void exportChats(folder) }] : []),
    ...(canShare ? [{ key: 'share', label: 'Share', icon: 'user-plus' as const, onPress: () => void share(folder) }] : []),
    { key: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: () => remove(folder, onDeleted) },
  ];

  const element = (
    <>
      <FolderSheet
        target={sheet}
        onClose={() => setSheet(null)}
        onSaved={(folder, target) => {
          if (target.mode === 'create' && target.parentId) {
            // The folder it was made in opens, so the new one shows (the web keeps that on the server too).
            void setFolderExpanded(client, target.parentId, true).catch(() => undefined);
          }
          if (target.mode === 'create') onCreated?.(folder, target.parentId);
          void refresh();
        }}
      />
      <AccessSheet target={sharing} onClose={() => setSharing(null)} onSaved={() => void refresh()} />
    </>
  );

  return { items, newFolder: () => setSheet({ mode: 'create', parentId: null }), element };
}
