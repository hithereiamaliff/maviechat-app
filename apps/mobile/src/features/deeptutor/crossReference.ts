import {
  addChatRecord,
  ensureNotebook,
  getSession,
  MAVIECHAT_NOTEBOOK,
  sessionFileName,
  sessionMarkdown,
  type DtClient,
} from '@maviechat/deeptutor-protocol';
import { exportChat, keepTail, modelName, textFileItem, uuidv4, type ChatRecord, type FileItem, type ModelItem } from '@maviechat/owui-protocol';

/** `https://learn.example.com` → `learn.example.com`. */
export function hostOf(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
}

/**
 * A DeepTutor chat as an attachment for an Open WebUI message (DeepTutor → Open WebUI).
 * Its text travels with the message as a `text` item, as the web does for pasted web
 * pages, so nothing is uploaded; very long chats keep their newest part.
 */
export async function deepTutorAttachment(client: DtClient, sessionId: string, itemId: string = uuidv4()): Promise<FileItem> {
  const session = await getSession(client, sessionId);
  const content = keepTail(sessionMarkdown(session, { source: hostOf(client.baseUrl) }));
  return textFileItem({ name: sessionFileName(session), content, itemId, id: uuidv4() });
}

/**
 * Files an Open WebUI chat's shown branch in DeepTutor's "From MavieChat" notebook
 * (Open WebUI → DeepTutor), where any DeepTutor chat can reference it. A copy, not a link.
 */
export async function sendChatToDeepTutor(client: DtClient, chat: ChatRecord, models: ModelItem[] | undefined, owuiBaseUrl: string): Promise<void> {
  const server = hostOf(owuiBaseUrl);
  const exported = exportChat({
    title: chat.title || chat.chat.title || '',
    history: chat.chat.history ?? { messages: {}, currentId: null },
    modelName: (id) => modelName(models, id),
    source: server,
    updatedAt: chat.updated_at,
  });
  if (exported.messageCount === 0) throw new Error('This chat has no messages to send yet.');
  const notebook = await ensureNotebook(client, MAVIECHAT_NOTEBOOK, 'Open WebUI chats sent from MavieChat');
  await addChatRecord(client, {
    notebookIds: [notebook.id],
    title: exported.title,
    summary: exported.summary,
    userQuery: exported.firstQuestion.slice(0, 2000),
    output: exported.markdown,
    metadata: { source: 'maviechat', origin: 'open-webui', server, chat_id: chat.id, models: exported.models },
  });
}
