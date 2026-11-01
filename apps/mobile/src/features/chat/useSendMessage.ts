import {
  availableToggles,
  branchPath,
  buildCompletionRequest,
  buildRegenerateTurn,
  buildTurn,
  chatFeatures,
  effectiveToggles,
  isTemporaryChatId,
  OwuiHttpError,
  requestFiles,
  startCompletion,
  stopChatTasks,
  temporaryChatId,
  temporaryChatMessages,
  templateVariables,
  type ChatHistory,
  type ChatRecord,
  type FeatureToggles,
  type FileItem,
  type ModelItem,
  type Turn,
} from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';
import { useToast } from '@/components/Toast';
import { useLive } from '@/features/live/LiveProvider';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useServerConfig, useSessionUser, useUserSettings } from '@/lib/server';
import { useSession } from '@/session/SessionProvider';

interface Extras {
  toggles?: FeatureToggles;
  toolIds?: string[];
}

export interface SendInput extends Extras {
  /** Null starts a new chat; a temporary id continues a temporary chat. */
  chatId: string | null;
  /** The message the new one goes under; null for the first message. */
  parentId: string | null;
  content: string;
  model: ModelItem;
  files?: FileItem[];
  /** With `chatId: null`: start a temporary chat, which the server doesn't keep. */
  temporary?: boolean;
}

export interface RegenerateInput extends Extras {
  chatId: string;
  /** The user message whose reply is redone; the new reply joins the old one as a version. */
  userMessageId: string;
  model: ModelItem;
  modelIdx?: number;
  /** "Add Details", "More Concise" or your own words. */
  prompt?: string;
}

export interface Sent {
  chatId: string;
  replyId: string;
}

const EMPTY_HISTORY: ChatHistory = { messages: {}, currentId: null };

function localRecord(id: string, model: ModelItem, history: ChatHistory): ChatRecord {
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    title: 'New Chat',
    updated_at: now,
    created_at: now,
    current_message_id: history.currentId,
    chat: { id, title: 'New Chat', models: [model.id], history, messages: [], tags: [], timestamp: now * 1000 },
  };
}

/** Sends turns and regenerations the way the web app does, and streams the replies into the cached chat. */
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

  const dispatch = useCallback(
    async (job: Extras & { chatId: string | null; temporary: boolean; turn: Turn; model: ModelItem; regenerationPrompt?: string }): Promise<Sent | null> => {
      const { turn, model } = job;
      let sessionId: string;
      try {
        sessionId = await live.waitForSession();
      } catch {
        toast('Not connected to the server yet. Check your connection and try again.', 'error');
        return null;
      }

      // A temporary chat is named after the connection that started it, as on the web; the app keeps it by that name.
      const routeId = job.chatId ?? (job.temporary ? temporaryChatId(sessionId) : null);
      const record = job.chatId ? queryClient.getQueryData<ChatRecord>(['chat', job.chatId]) : undefined;
      const replyIds = turn.replies.map((reply) => reply.id);
      const replyId = replyIds[0] as string;
      if (routeId) {
        queryClient.setQueryData<ChatRecord>(['chat', routeId], (current) =>
          current && job.chatId
            ? { ...current, current_message_id: turn.history.currentId, chat: { ...current.chat, history: turn.history } }
            : localRecord(routeId, model, turn.history),
        );
      }
      live.streams.track(replyIds, routeId);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const ui = (settings.data?.ui ?? {}) as Record<string, unknown>;
      const chatParams = (record?.chat?.params ?? {}) as Record<string, unknown>;
      const system = (chatParams.system as string | undefined) ?? (ui.system as string | undefined);
      const memory = (ui.memory as boolean | undefined) ?? config.data?.features?.enable_memories === true;
      const parentId = turn.userMessage.parentId;
      const body = buildCompletionRequest({
        turn,
        chatId: job.temporary ? temporaryChatId(sessionId) : routeId,
        sessionId,
        model,
        system,
        params: { ...((ui.params as Record<string, unknown> | undefined) ?? {}), ...chatParams },
        features: capabilities
          ? chatFeatures(capabilities, effectiveToggles(job.toggles ?? {}, availableToggles(capabilities, model)), memory)
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
        toolIds: job.toolIds,
        files: requestFiles(parentId ? branchPath(turn.history, parentId) : [], turn.userMessage),
        regenerationPrompt: job.regenerationPrompt,
        temporaryMessages: job.temporary ? temporaryChatMessages(branchPath(turn.history, turn.userMessage.id), system) : undefined,
      });

      try {
        const started = await startCompletion(client, body);
        const id = routeId ?? started.chat_id;
        if (!routeId) {
          queryClient.setQueryData<ChatRecord>(['chat', id], localRecord(id, model, turn.history));
          live.streams.bind(replyIds, id);
        }
        if (!job.temporary) void queryClient.invalidateQueries({ queryKey: ['chats'] });
        return { chatId: id, replyId };
      } catch (error) {
        live.streams.untrack(replyIds);
        if (routeId) {
          queryClient.setQueryData<ChatRecord>(['chat', routeId], (current) => {
            const history = current?.chat?.history;
            const reply = history?.messages[replyId];
            if (!current || !history || !reply) return current;
            const messages = { ...history.messages, [replyId]: { ...reply, done: true, error: { content: describeError(error) } } };
            return { ...current, chat: { ...current.chat, history: { ...history, messages } } };
          });
        }
        toast(`Couldn't send: ${describeError(error)}`, 'error');
        if (error instanceof OwuiHttpError && error.isUnauthorized) verifySession();
        return null;
      }
    },
    [client, session, live, queryClient, toast, capabilities, settings.data, config.data, user.data, verifySession],
  );

  const historyOf = useCallback(
    (chatId: string | null) => (chatId ? queryClient.getQueryData<ChatRecord>(['chat', chatId])?.chat?.history : undefined) ?? EMPTY_HISTORY,
    [queryClient],
  );

  const send = useCallback(
    async ({ chatId, parentId, content, model, files = [], temporary = false, toggles, toolIds }: SendInput): Promise<Sent | null> => {
      const text = content.trim();
      if (!text && files.length === 0) return null;
      const turn = buildTurn({ history: historyOf(chatId), content: text, models: [model], files, parentId });
      return dispatch({ chatId, temporary: temporary || isTemporaryChatId(chatId), turn, model, toggles, toolIds });
    },
    [dispatch, historyOf],
  );

  const regenerate = useCallback(
    async ({ chatId, userMessageId, model, modelIdx, prompt, toggles, toolIds }: RegenerateInput): Promise<Sent | null> => {
      const history = historyOf(chatId);
      if (!history.messages[userMessageId]) return null;
      const turn = buildRegenerateTurn({ history, userMessageId, model, modelIdx });
      return dispatch({ chatId, temporary: isTemporaryChatId(chatId), turn, model, toggles, toolIds, regenerationPrompt: prompt });
    },
    [dispatch, historyOf],
  );

  const stop = useCallback(
    async (chatId: string) => {
      // A temporary chat's replies run under the current connection's name.
      const sessionId = isTemporaryChatId(chatId) ? await live.waitForSession(2000).catch(() => null) : null;
      try {
        await stopChatTasks(client, sessionId ? temporaryChatId(sessionId) : chatId);
      } catch (error) {
        toast(`Couldn't stop: ${describeError(error)}`, 'error');
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
    [client, live, queryClient, toast],
  );

  return { send, regenerate, stop };
}
