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

/**
 * Regenerates a reply: a new, empty reply joins the old one under the same user message
 * (the ‹ n/m › arrows then switch between them). No user message is added.
 */
export function buildRegenerateTurn({
  history,
  userMessageId,
  model,
  modelIdx = 0,
  now = new Date(),
  newId = uuidv4,
}: {
  history: ChatHistory;
  userMessageId: string;
  model: Pick<ModelItem, 'id' | 'name'>;
  modelIdx?: number;
  now?: Date;
  newId?: () => string;
}): Turn {
  const user = history.messages[userMessageId];
  if (!user) throw new Error('The message to regenerate from is missing');
  const reply: HistoryMessage = {
    id: newId(),
    parentId: user.id,
    childrenIds: [],
    role: 'assistant',
    content: '',
    done: false,
    model: model.id,
    modelName: model.name ?? model.id,
    modelIdx,
    timestamp: Math.floor(now.getTime() / 1000),
  };
  const userMessage: HistoryMessage = { ...user, childrenIds: [...user.childrenIds, reply.id] };
  return {
    history: { messages: { ...history.messages, [user.id]: userMessage, [reply.id]: reply }, currentId: reply.id },
    userMessage,
    replies: [reply],
    messageIds: [{ model_id: model.id, message_id: reply.id, modelIdx }],
  };
}

/** Temporary chats are identified by the socket that started them; the server stores nothing. */
export function temporaryChatId(sessionId: string): string {
  return `temporary:${sessionId}`;
}

export function isTemporaryChatId(chatId: string | null | undefined): boolean {
  return Boolean(chatId && (chatId.startsWith('temporary:') || chatId.startsWith('local:')));
}

/**
 * The whole conversation for a temporary chat (the server has no copy): finished replies
 * with `output[]` go as `{role, model, output}`, user photos as image parts, the rest as text.
 */
export function temporaryChatMessages(branch: HistoryMessage[], system?: string | null): Record<string, unknown>[] {
  const list: Record<string, unknown>[] = [];
  const prompt = system?.trim();
  if (prompt) list.push({ role: 'system', content: prompt });
  for (const message of branch) {
    if (message.role === 'assistant' && Array.isArray(message.output) && message.output.length > 0) {
      list.push({ role: 'assistant', model: message.model, output: message.output });
      continue;
    }
    const images = (message.files ?? []).filter(
      (file): file is { url: string } =>
        typeof file === 'object' &&
        file !== null &&
        typeof (file as { url?: unknown }).url === 'string' &&
        ((file as { type?: unknown }).type === 'image' || String((file as { content_type?: unknown }).content_type ?? '').startsWith('image/')),
    );
    if (message.role === 'user' && images.length > 0) {
      list.push({
        role: 'user',
        content: [{ type: 'text', text: message.content }, ...images.map((image) => ({ type: 'image_url', image_url: { url: image.url } }))],
      });
      continue;
    }
    if (message.role === 'user' || message.content.trim()) list.push({ role: message.role, content: message.content });
  }
  return list;
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
  /** "Add Details", "More Concise" or your own words: asks for a different take on the reply. */
  regenerationPrompt?: string;
  /** Temporary chat: the full conversation (see `temporaryChatMessages`); nothing is saved. */
  temporaryMessages?: Record<string, unknown>[];
}

/** The `POST /api/chat/completions` body for a saved chat, matching Open WebUI 0.11.3. */
export function buildCompletionRequest(input: CompletionRequestInput): Record<string, unknown> {
  const { turn } = input;
  const firstReply = turn.replies[0];
  const system = input.system?.trim();
  const temporary = input.temporaryMessages !== undefined || isTemporaryChatId(input.chatId);
  const isNewChat = input.chatId === null;
  const messages = input.temporaryMessages ?? (system ? [{ role: 'system', content: system }] : []);
  return {
    stream: true,
    model: input.model.id,
    // Saved chats send only the system prompt (the server loads the conversation); temporary chats send everything.
    ...(messages.length > 0 ? { messages } : {}),
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
    ...(input.regenerationPrompt ? { regeneration_prompt: input.regenerationPrompt } : {}),
    background_tasks: {
      ...(isNewChat && !temporary ? { title_generation: input.tasks.title ?? true, tags_generation: input.tasks.tags ?? true } : {}),
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
