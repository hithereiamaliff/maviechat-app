import {
  chatActionBody,
  createFeedback,
  deleteMessage,
  getChat,
  isTemporaryChatId,
  mergeActionMessages,
  OwuiHttpError,
  ratingFeedback,
  replyCopy,
  runChatAction,
  saveMessage,
  saveMessages,
  updateFeedback,
  uuidv4,
  withEditedTexts,
  type ChatHistory,
  type ChatRecord,
  type FileItem,
  type HistoryMessage,
  type ModelAction,
  type ModelItem,
  type ReplyAnnotation,
} from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { useToast } from '@/components/Toast';
import { useLive } from '@/features/live/LiveProvider';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities } from '@/lib/server';
import { useSession } from '@/session/SessionProvider';

/**
 * Edit, rate, run actions on and delete messages, with the web app's permission rules. A
 * temporary chat changes only on the phone.
 */
export function useMessageActions(chatId: string) {
  const { client } = useAuthed();
  const { verifySession } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const capabilities = useCapabilities();
  const live = useLive();
  const temporary = isTemporaryChatId(chatId);
  const historyOf = useCallback(() => queryClient.getQueryData<ChatRecord>(['chat', chatId])?.chat?.history, [queryClient, chatId]);

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

  /** Saves a changed message in place (shown at once; put back if the server refuses). */
  const replace = useCallback(
    async (original: HistoryMessage, changed: HistoryMessage, what: string): Promise<boolean> => {
      const shownLeaf = historyOf()?.currentId ?? null;
      patch((history) => ({ ...history, messages: { ...history.messages, [original.id]: changed } }));
      if (temporary) return true;
      try {
        await saveMessage(client, chatId, changed, shownLeaf);
        return true;
      } catch (error) {
        patch((history) => ({ ...history, messages: { ...history.messages, [original.id]: original } }));
        failed(what, error);
        return false;
      }
    },
    [historyOf, patch, temporary, client, chatId, failed],
  );

  const saveEdit = useCallback(
    (message: HistoryMessage, content: string, files: FileItem[]) => replace(message, { ...message, content, files }, 'save the message'),
    [replace],
  );

  /** A reply edited in place, or kept as a new version beside it ("Save As Copy", which then shows). */
  const editReply = useCallback(
    async (message: HistoryMessage, texts: string[], asCopy: boolean): Promise<boolean> => {
      if (!asCopy) return replace(message, withEditedTexts(message, texts), 'save the reply');
      const before = historyOf();
      if (!before) return false;
      const { copy, parent } = replyCopy(before, message.id, texts, { newId: uuidv4() });
      patch((history) => ({ messages: { ...history.messages, [copy.id]: copy, ...(parent ? { [parent.id]: parent } : {}) }, currentId: copy.id }));
      if (temporary) return true;
      try {
        await saveMessages(client, chatId, parent ? [parent, copy] : [copy], copy.id);
        return true;
      } catch (error) {
        patch(() => before);
        failed('save the copy', error);
        return false;
      }
    },
    [replace, historyOf, patch, temporary, client, chatId, failed],
  );

  /**
   * 👍 or 👎 (`rating`), or the details from the rating panel: kept on the reply, and filed with
   * Open WebUI's evaluations (created once, then updated), as the web does.
   */
  const rate = useCallback(
    async (message: HistoryMessage, change: { rating?: 1 | -1; details?: Partial<ReplyAnnotation> }): Promise<boolean> => {
      if (temporary) return false;
      const annotation: ReplyAnnotation = {
        ...((message.annotation as ReplyAnnotation | undefined) ?? {}),
        ...(change.rating ? { rating: change.rating } : {}),
        ...(change.details ?? {}),
      };
      const rated: HistoryMessage = { ...message, annotation };
      patch((history) => ({ ...history, messages: { ...history.messages, [message.id]: rated } }));
      try {
        const chat = await getChat(client, chatId);
        const history = chat.chat?.history ?? historyOf();
        if (!history) throw new Error('The chat is missing');
        const models = queryClient.getQueryData<ModelItem[]>(['models']) ?? [];
        const feedback = ratingFeedback({ history, message: rated, annotation, chatId, chat, models });
        const existing = typeof message.feedbackId === 'string' ? message.feedbackId : null;
        const filed = existing ? await updateFeedback(client, existing, feedback) : await createFeedback(client, feedback);
        const final: HistoryMessage = { ...rated, feedbackId: existing ?? filed.id };
        return await replace(message, final, 'save the rating');
      } catch (error) {
        patch((history) => ({ ...history, messages: { ...history.messages, [message.id]: message } }));
        failed('save the rating', error);
        return false;
      }
    },
    [temporary, patch, client, chatId, historyOf, queryClient, replace, failed],
  );

  /** Runs one of the model's action buttons on a reply; what it changes is merged and saved. */
  const runAction = useCallback(
    async (message: HistoryMessage, action: ModelAction): Promise<void> => {
      const history = historyOf();
      const model = queryClient.getQueryData<ModelItem[]>(['models'])?.find((item) => item.id === message.model);
      if (!history || !model) {
        toast("This reply's model isn't available any more.", 'error');
        return;
      }
      const sessionId = await live.waitForSession(3000).catch(() => null);
      try {
        const result = await runChatAction(client, action.id, chatActionBody({ history, messageId: message.id, model, chatId, sessionId }));
        const changed = (result?.messages ?? []).filter((item) => item && typeof item.id === 'string');
        if (changed.length === 0) return;
        let merged: ChatHistory | null = null;
        patch((current) => (merged = mergeActionMessages(current, changed)));
        const saved = merged as ChatHistory | null;
        if (!temporary && saved) {
          await saveMessages(client, chatId, changed.flatMap((item) => (saved.messages[item.id] ? [saved.messages[item.id]!] : [])), saved.currentId);
        }
      } catch (error) {
        failed(`run “${action.name ?? 'the action'}”`, error);
      }
    },
    [historyOf, queryClient, live, client, chatId, patch, temporary, toast, failed],
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
      editReply,
      rate,
      runAction,
      remove,
      // As on the web: deleting your own messages is off unless granted; deleting a reply version is on unless denied.
      canDeleteMessage: !temporary && (capabilities?.can('chat.delete_message') ?? false),
      canDeleteReply: !temporary && (capabilities?.can('chat.delete_message', true) ?? false),
      canRegenerate: capabilities?.can('chat.regenerate_response', true) ?? false,
      // As on the web: editing and continuing are on unless denied; rating needs the server's flag, and not a temporary chat.
      canEdit: capabilities?.can('chat.edit', true) ?? false,
      canContinue: capabilities?.can('chat.continue_response', true) ?? false,
      canRate: !temporary && (capabilities?.feature('messageRating', true) ?? false),
    }),
    [saveEdit, editReply, rate, runAction, remove, temporary, capabilities],
  );
}
