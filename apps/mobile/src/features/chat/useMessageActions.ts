import {
  deleteMessage,
  isTemporaryChatId,
  OwuiHttpError,
  saveMessage,
  type ChatHistory,
  type ChatRecord,
  type HistoryMessage,
} from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities } from '@/lib/server';
import { useSession } from '@/session/SessionProvider';

/** Edit in place and delete, with the web app's permission rules. A temporary chat changes only on the phone. */
export function useMessageActions(chatId: string) {
  const { client } = useAuthed();
  const { verifySession } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const capabilities = useCapabilities();
  const temporary = isTemporaryChatId(chatId);

  const patch = useCallback(
    (change: (history: ChatHistory) => ChatHistory) =>
      queryClient.setQueryData<ChatRecord>(['chat', chatId], (current) =>
        current?.chat?.history ? { ...current, chat: { ...current.chat, history: change(current.chat.history) } } : current,
      ),
    [queryClient, chatId],
  );

  const failed = useCallback(
    (what: string, error: unknown) => {
      toast(`Couldn't ${what}: ${describeError(error)}`, 'error');
      if (error instanceof OwuiHttpError && error.isUnauthorized) verifySession();
    },
    [toast, verifySession],
  );

  const saveEdit = useCallback(
    async (message: HistoryMessage, content: string): Promise<boolean> => {
      const edited = { ...message, content };
      const shownLeaf = queryClient.getQueryData<ChatRecord>(['chat', chatId])?.chat?.history?.currentId ?? null;
      patch((history) => ({ ...history, messages: { ...history.messages, [message.id]: edited } }));
      if (temporary) return true;
      try {
        await saveMessage(client, chatId, edited, shownLeaf);
        return true;
      } catch (error) {
        patch((history) => ({ ...history, messages: { ...history.messages, [message.id]: message } }));
        failed('save the message', error);
        return false;
      }
    },
    [queryClient, chatId, patch, temporary, client, failed],
  );

  const remove = useCallback(
    (message: HistoryMessage) => {
      Alert.alert('Delete message?', message.role === 'user' ? 'Its replies are deleted too.' : undefined, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteMessage(client, chatId, message.id)
              .then((updated) => {
                // The server repairs the tree and picks the branch to show; take its copy.
                if (updated?.chat?.history) queryClient.setQueryData<ChatRecord>(['chat', chatId], updated);
                else void queryClient.invalidateQueries({ queryKey: ['chat', chatId] });
              })
              .catch((error: unknown) => failed('delete the message', error));
          },
        },
      ]);
    },
    [client, chatId, queryClient, failed],
  );

  return useMemo(
    () => ({
      saveEdit,
      remove,
      // As on the web: deleting your own messages is off unless granted; deleting a reply version is on unless denied.
      canDeleteMessage: !temporary && (capabilities?.can('chat.delete_message') ?? false),
      canDeleteReply: !temporary && (capabilities?.can('chat.delete_message', true) ?? false),
      canRegenerate: capabilities?.can('chat.regenerate_response', true) ?? false,
    }),
    [saveEdit, remove, temporary, capabilities],
  );
}
