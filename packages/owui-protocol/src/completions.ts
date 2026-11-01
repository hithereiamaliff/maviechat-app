import type { Capabilities } from './capabilities';
import type { ChatHistory, HistoryMessage } from './history';
import type { OwuiClient } from './http';
import { uuidv4 } from './ids';
import type { ModelItem } from './models';

export interface MessageIdEntry {
  model_id: string;
  message_id: string;
  modelIdx: number;
}

/** A user turn added to a history: the user message plus one reply placeholder per model. */
export interface Turn {
  history: ChatHistory;
  userMessage: HistoryMessage;
  replies: HistoryMessage[];
  messageIds: MessageIdEntry[];
}

/**
 * Adds a user message under `parentId` (default: the shown leaf) and an empty,
 * unfinished reply per model, shaped like Open WebUI 0.11.3's web client.
 * The input history is not modified.
 */
export function buildTurn({
  history,
  content,
  models,
  files,
  parentId = history.currentId,
  now = new Date(),
  newId = uuidv4,
}: {
  history: ChatHistory;
  content: string;
  models: Pick<ModelItem, 'id' | 'name'>[];
  files?: unknown[];
  parentId?: string | null;
  now?: Date;
  newId?: () => string;
}): Turn {
  const timestamp = Math.floor(now.getTime() / 1000);
  const userId = newId();
  const replies: HistoryMessage[] = models.map((model, modelIdx) => ({
    id: newId(),
    parentId: userId,
    childrenIds: [],
    role: 'assistant',
    content: '',
    done: false,
    model: model.id,
    modelName: model.name ?? model.id,
    modelIdx,
    timestamp,
  }));
  const userMessage: HistoryMessage = {
    id: userId,
    parentId: parentId ?? null,
    childrenIds: replies.map((reply) => reply.id),
    role: 'user',
    content,
    ...(files && files.length > 0 ? { files } : {}),
    timestamp,
    models: models.map((model) => model.id),
  };

  const messages: Record<string, HistoryMessage> = { ...history.messages };
  const parent = userMessage.parentId ? messages[userMessage.parentId] : undefined;
  if (parent) messages[parent.id] = { ...parent, childrenIds: [...parent.childrenIds, userId] };
  messages[userId] = userMessage;
  for (const reply of replies) messages[reply.id] = reply;

  return {
    history: { messages, currentId: replies[0]?.id ?? userId },
    userMessage,
    replies,
    messageIds: replies.map((reply, modelIdx) => ({ model_id: reply.model as string, message_id: reply.id, modelIdx })),
  };
}

export interface FeatureToggles {
  webSearch?: boolean;
  imageGeneration?: boolean;
  codeInterpreter?: boolean;
}

/** `features` as the web sends it: toggles count only when the server allows them for this user. */
export function chatFeatures(
  capabilities: Pick<Capabilities, 'feature'>,
  toggles: FeatureToggles,
  memory: boolean,
): Record<string, boolean> {
  return {
    voice: false,
    image_generation: capabilities.feature('imageGeneration') ? Boolean(toggles.imageGeneration) : false,
    code_interpreter: capabilities.feature('codeInterpreter') ? Boolean(toggles.codeInterpreter) : false,
    web_search: capabilities.feature('webSearch') ? Boolean(toggles.webSearch) : false,
    ...(memory ? { memory: true } : {}),
  };
}

export interface CompletionRequestInput {
  turn: Turn;
  /** Null for a new chat: the server creates it and answers with its id. */
  chatId: string | null;
  /** The live socket's id; replies stream to it. */
  sessionId: string;
  model: ModelItem;
  system?: string | null;
  params?: Record<string, unknown>;
  features: Record<string, boolean>;
  variables: Record<string, string>;
  /** User settings (`ui.title.auto`, `ui.autoTags`, `ui.autoFollowUps`); all default to on. */
  tasks: { title?: boolean; tags?: boolean; followUps?: boolean };
  toolIds?: string[];
  files?: unknown[];
  folderId?: string | null;
}

/** The `POST /api/chat/completions` body for a saved chat, matching Open WebUI 0.11.3. */
export function buildCompletionRequest(input: CompletionRequestInput): Record<string, unknown> {
  const { turn } = input;
  const firstReply = turn.replies[0];
  const system = input.system?.trim();
  const isNewChat = input.chatId === null;
  return {
    stream: true,
    model: input.model.id,
    // Saved chats send only the system prompt; the server loads the conversation itself.
    ...(system ? { messages: [{ role: 'system', content: system }] } : {}),
    params: { ...(input.params ?? {}) },
    ...(input.files && input.files.length > 0 ? { files: input.files } : {}),
    ...(input.toolIds && input.toolIds.length > 0 ? { tool_ids: input.toolIds } : {}),
    tool_servers: [],
    features: input.features,
    variables: input.variables,
    model_item: input.model,
    session_id: input.sessionId,
    ...(input.chatId ? { chat_id: input.chatId } : {}),
    ...(input.folderId ? { folder_id: input.folderId } : {}),
    id: firstReply?.id,
    message_ids: turn.messageIds,
    parent_id: turn.userMessage.parentId ?? null,
    user_message: turn.userMessage,
    background_tasks: {
      ...(isNewChat ? { title_generation: input.tasks.title ?? true, tags_generation: input.tasks.tags ?? true } : {}),
      follow_up_generation: input.tasks.followUps ?? true,
    },
  };
}

export interface CompletionStarted {
  status: boolean;
  chat_id: string;
  task_ids?: string[];
  error?: unknown;
  [key: string]: unknown;
}

/** Starts generation on the server; the reply then streams over the socket given as `session_id`. */
export function startCompletion(client: OwuiClient, payload: Record<string, unknown>): Promise<CompletionStarted> {
  return client.post<CompletionStarted>('/api/chat/completions', payload);
}

/** Stops every running reply in a chat; the server marks them done and emits `chat:tasks:cancel`. */
export function stopChatTasks(client: OwuiClient, chatId: string): Promise<unknown> {
  return client.post<unknown>(`/api/tasks/chat/${encodeURIComponent(chatId)}/stop`);
}

/** Replies still running in a chat (e.g. after the app was in the background). */
export async function listChatTasks(client: OwuiClient, chatId: string): Promise<string[]> {
  const response = await client.get<{ task_ids?: string[] }>(`/api/tasks/chat/${encodeURIComponent(chatId)}`);
  return response.task_ids ?? [];
}
