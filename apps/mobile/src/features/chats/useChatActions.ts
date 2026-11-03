import {
  branchPath,
  chatJson,
  chatPlainText,
  cloneChat,
  deleteChat,
  exportFileName,
  generateTitle,
  getChat,
  initialLeaf,
  markChatUnread,
  moveChatToFolder,
  OwuiHttpError,
  renameChat,
  titleMessages,
  titleModel,
  toggleArchived,
  togglePinned,
  unarchiveAllChats,
  type ChatRecord,
} from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import { ActionSheetIOS, Alert, Platform, Share } from 'react-native';
import { useToast } from '@/components/Toast';
import { useAuthed, useCapabilities } from '@/lib/server';
import { useSession } from '@/session/SessionProvider';

export interface ChatRef {
  id: string;
  title: string;
}

/** The chat menu's actions (rename and generate, unread, pin, move, clone, download, copy, archive, delete); shared by the sidebar rows and the chat screen. */
export function useChatActions() {
  const { client } = useAuthed();
  const { verifySession } = useSession();
  const capabilities = useCapabilities();
  const queryClient = useQueryClient();
  const toast = useToast();

  const refresh = (id: string) => {
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
    void queryClient.invalidateQueries({ queryKey: ['folder-chats'] });
    void queryClient.invalidateQueries({ queryKey: ['folders'] });
    void queryClient.invalidateQueries({ queryKey: ['archived'] });
    void queryClient.invalidateQueries({ queryKey: ['chat', id] });
  };

  const run = async (what: string, id: string, action: () => Promise<unknown>) => {
    try {
      await action();
      refresh(id);
      return true;
    } catch (error) {
      const reason = error instanceof OwuiHttpError && error.detail ? `: ${error.detail}` : '';
      toast(`Couldn't ${what} the chat${reason}`, 'error');
      if (error instanceof OwuiHttpError && error.isUnauthorized) verifySession();
      return false;
    }
  };

  // As the web's Generate: the shown branch's text, sent to the model that answered last.
  const generateFor = async (chat: ChatRef) => {
    try {
      const record = queryClient.getQueryData<ChatRecord>(['chat', chat.id]) ?? (await getChat(client, chat.id));
      const history = record.chat?.history ?? { messages: {}, currentId: null };
      const branch = branchPath(history, initialLeaf(history, record.current_message_id));
      const model = titleModel(branch, record.chat?.models);
      if (!model || branch.length === 0) {
        toast('This chat has nothing to title yet.', 'error');
        return;
      }
      const title = await generateTitle(client, { model, messages: titleMessages(branch), chatId: chat.id });
      if (title !== chat.title) await run('rename', chat.id, () => renameChat(client, chat.id, title));
    } catch (error) {
      toast(`Couldn't generate a title: ${error instanceof OwuiHttpError ? (error.detail ?? `HTTP ${error.status}`) : error instanceof Error ? error.message : 'unknown error'}`, 'error');
      if (error instanceof OwuiHttpError && error.isUnauthorized) verifySession();
    }
  };

  /** The chat as a file, handed to the share sheet (Save to Files, Mail, AirDrop…). */
  const downloadAs = async (chat: ChatRef, kind: 'json' | 'txt') => {
    try {
      const record = await getChat(client, chat.id);
      const file = new File(Paths.cache, exportFileName(record.title || chat.title, kind));
      file.create({ overwrite: true });
      await file.write(kind === 'json' ? chatJson(record) : chatPlainText(record));
      await Share.share({ url: file.uri, title: record.title || chat.title });
    } catch (error) {
      toast(`Couldn't download the chat: ${error instanceof OwuiHttpError ? (error.detail ?? `HTTP ${error.status}`) : error instanceof Error ? error.message : 'unknown error'}`, 'error');
      if (error instanceof OwuiHttpError && error.isUnauthorized) verifySession();
    }
  };

  return {
    /** The web app hides Delete unless the account holds the `chat.delete` permission. */
    canDelete: capabilities?.can('chat.delete') ?? false,
    /** Share, Download and Clone follow the same permissions as on the web (allowed unless the server says no). */
    canShare: capabilities?.can('chat.share', true) ?? false,
    canExport: capabilities?.can('chat.export', true) ?? false,
    canClone: capabilities?.can('chat.import', true) ?? false,

    /** A copy of the whole chat ("Clone of …"); answers with its id. */
    async clone(chat: ChatRef): Promise<string | null> {
      try {
        const copy = await cloneChat(client, chat.id);
        refresh(copy.id);
        toast('Chat cloned');
        return copy.id;
      } catch (error) {
        toast(`Couldn't clone the chat${error instanceof OwuiHttpError && error.detail ? `: ${error.detail}` : ''}`, 'error');
        if (error instanceof OwuiHttpError && error.isUnauthorized) verifySession();
        return null;
      }
    },

    /** As the web's Download: the chat export (.json) or plain text (.txt). */
    download(chat: ChatRef) {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Download', options: ['Chat Export (.json)', 'Plain Text (.txt)', 'Cancel'], cancelButtonIndex: 2 },
        (index) => {
          if (index === 0) void downloadAs(chat, 'json');
          else if (index === 1) void downloadAs(chat, 'txt');
        },
      );
    },

    /** The shown branch as plain text, on the clipboard. */
    async copy(chat: ChatRef) {
      try {
        await Clipboard.setStringAsync(chatPlainText(await getChat(client, chat.id)));
        toast('Copied to clipboard');
      } catch (error) {
        toast(`Couldn't copy the chat${error instanceof OwuiHttpError && error.detail ? `: ${error.detail}` : ''}`, 'error');
      }
    },

    rename(chat: ChatRef) {
      if (Platform.OS !== 'ios') return;
      Alert.prompt(
        'Rename chat',
        undefined,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Generate', onPress: () => void generateFor(chat) },
          {
            text: 'Save',
            onPress: (value?: string) => {
              const title = value?.trim();
              if (title && title !== chat.title) void run('rename', chat.id, () => renameChat(client, chat.id, title));
            },
          },
        ],
        'plain-text',
        chat.title,
      );
    },

    /** The unread dot comes back (here and on the web) until the chat is opened again. */
    markUnread(chat: ChatRef) {
      void run('mark', chat.id, () => markChatUnread(client, chat.id));
    },

    /** Folders need the server's folders feature for this account; `null` takes the chat out of its folder. */
    canMove: capabilities?.feature('folders') ?? false,

    async move(chat: ChatRef, folder: { id: string; name: string } | null) {
      if (await run('move', chat.id, () => moveChatToFolder(client, chat.id, folder?.id ?? null))) {
        toast(folder ? `Moved to ${folder.name}` : 'Moved out of the folder');
      }
    },

    togglePin(chat: ChatRef, pinned: boolean) {
      void run(pinned ? 'unpin' : 'pin', chat.id, () => togglePinned(client, chat.id));
    },

    async archive(chat: ChatRef, onDone?: () => void) {
      if (await run('archive', chat.id, () => toggleArchived(client, chat.id))) {
        toast('Chat archived');
        onDone?.();
      }
    },

    async unarchive(chat: ChatRef) {
      if (await run('unarchive', chat.id, () => toggleArchived(client, chat.id))) toast('Chat unarchived');
    },

    unarchiveAll() {
      Alert.alert('Unarchive all?', 'Are you sure you want to unarchive all archived chats?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unarchive All',
          onPress: () => {
            unarchiveAllChats(client)
              .then(() => {
                refresh('');
                toast('All chats have been unarchived.', 'success');
              })
              .catch((error: unknown) => {
                toast(`Couldn't unarchive: ${error instanceof OwuiHttpError ? (error.detail ?? `HTTP ${error.status}`) : 'unknown error'}`, 'error');
                if (error instanceof OwuiHttpError && error.isUnauthorized) verifySession();
              });
          },
        },
      ]);
    },

    remove(chat: ChatRef, onDone?: () => void) {
      Alert.alert('Delete chat?', `“${chat.title}” will be deleted. This can't be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void run('delete', chat.id, () => deleteChat(client, chat.id)).then((ok) => {
              if (ok) {
                queryClient.removeQueries({ queryKey: ['chat', chat.id] });
                onDone?.();
              }
            });
          },
        },
      ]);
    },
  };
}
