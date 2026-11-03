import {
  availableToggles,
  branchPath,
  buildCompletionRequest,
  buildContinueTurn,
  buildRegenerateTurn,
  buildTurn,
  chatFeatures,
  effectiveToggles,
  isTemporaryChatId,
  OwuiHttpError,
  requestFiles,
  requestParams,
  startCompletion,
  stopChatTasks,
  streamResponse,
  temporaryChatId,
  temporaryChatMessages,
  templateVariables,
  updateChatControls,
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
  /** With Compare: every model the message goes to, `model` first; each answers in its own column. */
  models?: ModelItem[];
  files?: FileItem[];
  /** With `chatId: null`: start a temporary chat, which the server doesn't keep. */
  temporary?: boolean;
  /** With `chatId: null`: create the chat inside this folder (the folder page's input). */
  folderId?: string;
  /** With `chatId: null`: the new chat's own system prompt and parameters (Controls). */
  params?: Record<string, unknown>;
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

export interface ContinueInput extends Extras {
  chatId: string;
  /** The reply that carries on where it stopped. */
  messageId: string;
  model: ModelItem;
}

export interface Sent {
  chatId: string;
  /**
   * The reply to show. With several models it's the one the server keeps as current: the first
   * model's in a new chat, the last one's in a saved chat (the server marks each new message current).
   */
  replyId: string;
}

const EMPTY_HISTORY: ChatHistory = { messages: {}, currentId: null };

function localRecord(id: string, modelIds: string[], history: ChatHistory, controls: { params?: Record<string, unknown>; files?: unknown[] } = {}): ChatRecord {
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    title: 'New Chat',
    updated_at: now,
    created_at: now,
    current_message_id: history.currentId,
    chat: { id, title: 'New Chat', models: modelIds, history, messages: [], tags: [], timestamp: now * 1000, ...controls },
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
    async (
      job: Extras & {
        chatId: string | null;
        temporary: boolean;
        turn: Turn;
        model: ModelItem;
        regenerationPrompt?: string;
        folderId?: string;
        /** "Continue Response": the reply that carries on. */
        continueMessageId?: string;
        /** A new chat's own params (Controls); a saved chat's come from its record. */
        params?: Record<string, unknown>;
      },
    ): Promise<Sent | null> => {
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
            : localRecord(routeId, turn.userMessage.models ?? [model.id], turn.history, { params: job.params }),
        );
      }
      live.streams.track(replyIds, routeId);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const ui = (settings.data?.ui ?? {}) as Record<string, unknown>;
      const userParams = ui.params as Record<string, unknown> | undefined;
      const chatParams = job.params ?? ((record?.chat?.params ?? {}) as Record<string, unknown>);
      const system = (chatParams.system as string | undefined) ?? (ui.system as string | undefined);
      const parentId = turn.userMessage.parentId;
      // A saved chat sends the documents it keeps (`chat.files`, see Controls); a temporary one everything shown.
      const chatFiles = job.temporary ? undefined : ((record?.chat?.files as unknown[] | undefined) ?? (job.chatId ? [] : undefined));
      const files = requestFiles(parentId ? branchPath(turn.history, parentId) : [], turn.userMessage, chatFiles);
      const memory = (ui.memory as boolean | undefined) ?? config.data?.features?.enable_memories === true;
      const body = buildCompletionRequest({
        turn,
        chatId: job.temporary ? temporaryChatId(sessionId) : routeId,
        sessionId,
        model,
        system,
        params: requestParams(userParams, chatParams),
        stream: streamResponse(model, userParams, chatParams),
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
        files,
        regenerationPrompt: job.regenerationPrompt,
        continueMessageId: job.continueMessageId,
        folderId: job.chatId === null && !job.temporary ? job.folderId : undefined,
        // A temporary chat sends everything; when continuing, the reply so far too.
        temporaryMessages: job.temporary ? temporaryChatMessages(branchPath(turn.history, job.continueMessageId ?? turn.userMessage.id), system) : undefined,
      });

      try {
        const started = await startCompletion(client, body);
        const id = routeId ?? started.chat_id;
        if (!routeId) {
          queryClient.setQueryData<ChatRecord>(['chat', id], localRecord(id, turn.userMessage.models ?? [model.id], turn.history, { params: job.params, files }));
          live.streams.bind(replyIds, id);
        } else if (!job.temporary && files.length > 0) {
          // The server keeps the request's files as the chat's; so does the cached copy.
          queryClient.setQueryData<ChatRecord>(['chat', id], (current) => (current ? { ...current, chat: { ...current.chat, files } } : current));
        }
        // The request doesn't save a new chat's own params; as on the web, they're saved once it exists.
        if (job.chatId === null && !job.temporary && job.params && Object.keys(job.params).length > 0) {
          void updateChatControls(client, id, { params: job.params }).catch((error: unknown) => toast(`Couldn't save this chat's controls: ${describeError(error)}`, 'error'));
        }
        if (!job.temporary) void queryClient.invalidateQueries({ queryKey: ['chats'] });
        if (job.folderId) {
          void queryClient.invalidateQueries({ queryKey: ['folder-chats', job.folderId] });
          void queryClient.invalidateQueries({ queryKey: ['folders'] });
        }
        return { chatId: id, replyId: job.chatId && !job.temporary ? (replyIds[replyIds.length - 1] as string) : replyId };
      } catch (error) {
        live.streams.untrack(replyIds);
        if (routeId) {
          // Every reply of the turn ends with the error (several with Compare).
          queryClient.setQueryData<ChatRecord>(['chat', routeId], (current) => {
            const history = current?.chat?.history;
            if (!current || !history) return current;
            const messages = { ...history.messages };
            for (const id of replyIds) {
              const reply = messages[id];
              if (reply) messages[id] = { ...reply, done: true, error: { content: describeError(error) } };
            }
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
    async ({ chatId, parentId, content, model, models, files = [], temporary = false, toggles, toolIds, folderId, params }: SendInput): Promise<Sent | null> => {
      const text = content.trim();
      if (!text && files.length === 0) return null;
      const turn = buildTurn({ history: historyOf(chatId), content: text, models: models?.length ? models : [model], files, parentId });
      return dispatch({ chatId, temporary: temporary || isTemporaryChatId(chatId), turn, model, toggles, toolIds, folderId, params: chatId === null ? params : undefined });
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

  /** "Continue Response": the last reply carries on where it stopped, in place. */
  const continueReply = useCallback(
    async ({ chatId, messageId, model, toggles, toolIds }: ContinueInput): Promise<Sent | null> => {
      const history = historyOf(chatId);
      if (!history.messages[messageId]) return null;
      const turn = buildContinueTurn({ history, messageId });
      return dispatch({ chatId, temporary: isTemporaryChatId(chatId), turn, model, toggles, toolIds, continueMessageId: messageId });
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

  return { send, regenerate, continueReply, stop };
}
