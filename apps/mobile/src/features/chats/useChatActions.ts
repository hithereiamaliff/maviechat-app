import { deleteChat, OwuiHttpError, renameChat, toggleArchived, togglePinned } from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Platform } from 'react-native';
import { useToast } from '@/components/Toast';
import { useAuthed, useCapabilities } from '@/lib/server';
import { useSession } from '@/session/SessionProvider';

export interface ChatRef {
  id: string;
  title: string;
}

/** Rename, pin, archive and delete a chat; shared by the sidebar rows and the chat menu. */
export function useChatActions() {
  const { client } = useAuthed();
  const { verifySession } = useSession();
  const capabilities = useCapabilities();
  const queryClient = useQueryClient();
  const toast = useToast();

  const refresh = (id: string) => {
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
    void queryClient.invalidateQueries({ queryKey: ['folder-chats'] });
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

  return {
    /** The web app hides Delete unless the account holds the `chat.delete` permission. */
    canDelete: capabilities?.can('chat.delete') ?? false,

    rename(chat: ChatRef) {
      if (Platform.OS !== 'ios') return;
      Alert.prompt(
        'Rename chat',
        undefined,
        [
          { text: 'Cancel', style: 'cancel' },
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

    togglePin(chat: ChatRef, pinned: boolean) {
      void run(pinned ? 'unpin' : 'pin', chat.id, () => togglePinned(client, chat.id));
    },

    async archive(chat: ChatRef, onDone?: () => void) {
      if (await run('archive', chat.id, () => toggleArchived(client, chat.id))) {
        toast('Chat archived');
        onDone?.();
      }
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
