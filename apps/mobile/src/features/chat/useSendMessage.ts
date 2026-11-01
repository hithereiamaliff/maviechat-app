import {
  buildCompletionRequest,
  buildTurn,
  chatFeatures,
  OwuiHttpError,
  OwuiNetworkError,
  startCompletion,
  stopChatTasks,
  templateVariables,
  type ChatRecord,
  type ModelItem,
} from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import { useToast } from '@/components/Toast';
import { useLive } from '@/features/live/LiveProvider';
import { useAuthed, useCapabilities, useServerConfig, useSessionUser, useUserSettings } from '@/lib/server';
import { useSession } from '@/session/SessionProvider';

export interface SendInput {
  /** Null to start a new chat. */
  chatId: string | null;
  /** The shown leaf; the new message is added under it. */
  leafId: string | null;
  content: string;
  model: ModelItem;
}

function describe(error: unknown): string {
  if (error instanceof OwuiHttpError) return error.detail ?? `HTTP ${error.status}`;
  if (error instanceof OwuiNetworkError) return "couldn't reach the server";
  return error instanceof Error ? error.message : 'unknown error';
}

/** Sends a turn the way the web app does and streams the reply into the cached chat. */
export function useSendMessage() {
  const { client, session } = useAuthed();
  const { verifySession } = useSession();
  const live = useLive();
  const queryClient = useQueryClient();
  const toast = useToast();
  const capabilities = useCapabilities();
  const settings = useUserSettings();
  const config = useServerConfig();
  const user = useSessionUser();

  const send = useCallback(
    async ({ chatId, leafId, content, model }: SendInput): Promise<{ chatId: string; replyId: string } | null> => {
      const text = content.trim();
      if (!text) return null;

      let sessionId: string;
      try {
        sessionId = await live.waitForSession();
      } catch {
        toast('Not connected to the server yet. Check your connection and try again.', 'error');
        return null;
      }

      const record = chatId ? queryClient.getQueryData<ChatRecord>(['chat', chatId]) : undefined;
      const history = record?.chat?.history ?? { messages: {}, currentId: null };
      const turn = buildTurn({ history, content: text, models: [model], parentId: leafId ?? history.currentId });
      const replyIds = turn.replies.map((reply) => reply.id);
      const replyId = replyIds[0] as string;
      const ui = (settings.data?.ui ?? {}) as Record<string, unknown>;
      const chatParams = (record?.chat?.params ?? {}) as Record<string, unknown>;

      if (chatId && record) {
        queryClient.setQueryData<ChatRecord>(['chat', chatId], {
          ...record,
          current_message_id: turn.history.currentId,
          chat: { ...record.chat, history: turn.history },
        });
      }
      live.streams.track(replyIds, chatId);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const memory = (ui.memory as boolean | undefined) ?? (config.data?.features?.enable_memories === true);
      const body = buildCompletionRequest({
        turn,
        chatId,
        sessionId,
        model,
        system: (chatParams.system as string | undefined) ?? (ui.system as string | undefined),
        params: { ...((ui.params as Record<string, unknown> | undefined) ?? {}), ...chatParams },
        features: capabilities
          ? chatFeatures(capabilities, {}, memory)
          : { voice: false, image_generation: false, code_interpreter: false, web_search: false },
        variables: templateVariables({
          name: user.data?.name ?? session.user.name,
          email: user.data?.email ?? session.user.email,
        }),
        tasks: {
          title: (ui.title as { auto?: boolean } | undefined)?.auto,
          tags: ui.autoTags as boolean | undefined,
          followUps: ui.autoFollowUps as boolean | undefined,
        },
      });

      try {
        const started = await startCompletion(client, body);
        const id = started.chat_id;
        if (!chatId) {
          const now = Math.floor(Date.now() / 1000);
          queryClient.setQueryData<ChatRecord>(['chat', id], {
            id,
            title: 'New Chat',
            updated_at: now,
            created_at: now,
            current_message_id: turn.history.currentId,
            chat: { id, title: 'New Chat', models: [model.id], history: turn.history, messages: [], tags: [], timestamp: now * 1000 },
          });
          live.streams.bind(replyIds, id);
        }
        void queryClient.invalidateQueries({ queryKey: ['chats'] });
        return { chatId: id, replyId };
      } catch (error) {
        live.streams.untrack(replyIds);
        if (chatId) {
          queryClient.setQueryData<ChatRecord>(['chat', chatId], (current) => {
            const reply = current?.chat?.history?.messages[replyId];
            if (!current || !reply) return current;
            const messages = { ...current.chat.history!.messages, [replyId]: { ...reply, done: true, error: { content: describe(error) } } };
            return { ...current, chat: { ...current.chat, history: { ...current.chat.history!, messages } } };
          });
        }
        toast(`Couldn't send: ${describe(error)}`, 'error');
        if (error instanceof OwuiHttpError && error.isUnauthorized) verifySession();
        return null;
      }
    },
    [client, session, live, queryClient, toast, capabilities, settings.data, config.data, user.data, verifySession],
  );

  const stop = useCallback(
    async (chatId: string) => {
      try {
        await stopChatTasks(client, chatId);
      } catch (error) {
        toast(`Couldn't stop: ${describe(error)}`, 'error');
        return;
      }
      // The server confirms with chat:tasks:cancel; mark replies done now in case that event was missed.
      queryClient.setQueryData<ChatRecord>(['chat', chatId], (current) => {
        const history = current?.chat?.history;
        if (!current || !history) return current;
        const messages = Object.fromEntries(
          Object.entries(history.messages).map(([id, message]) => [id, message.done === false ? { ...message, done: true } : message]),
        );
        return { ...current, chat: { ...current.chat, history: { ...history, messages } } };
      });
    },
    [client, queryClient, toast],
  );

  return { send, stop };
}
