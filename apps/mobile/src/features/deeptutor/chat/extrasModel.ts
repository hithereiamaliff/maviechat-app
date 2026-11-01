import type { DtTurnRequest } from '@maviechat/deeptutor-protocol';
import type { PromptExtras } from './liveTurns';

/** A photo or file waiting to go with the next message (sent inline, as DeepTutor takes them). */
export interface DtPendingAttachment {
  id: string;
  type: 'image' | 'file';
  filename: string;
  mimeType: string;
  size: number;
  base64: string;
  /** A data: URL for a photo's thumbnail. */
  preview: string | null;
}

/** What goes with the next message besides its text: attachments, and notebooks and chats to refer to. */
export interface DtExtras {
  attachments: DtPendingAttachment[];
  notebooks: { id: string; name: string }[];
  chats: { id: string; title: string }[];
}

export const NO_EXTRAS: DtExtras = { attachments: [], notebooks: [], chats: [] };

export function hasExtras(extras: DtExtras): boolean {
  return extras.attachments.length > 0 || extras.notebooks.length > 0 || extras.chats.length > 0;
}

/** The extras as a turn sends them. */
export function extrasRequest(extras: DtExtras): Pick<DtTurnRequest, 'attachments' | 'notebookReferences' | 'historyReferences'> {
  return {
    attachments: extras.attachments.map((item) => ({ type: item.type, filename: item.filename, base64: item.base64, mime_type: item.mimeType })),
    notebookReferences: extras.notebooks.map((notebook) => ({ notebook_id: notebook.id })),
    historyReferences: extras.chats.map((chat) => chat.id),
  };
}

/** The extras as your message shows them until the saved session has it. */
export function promptExtras(extras: DtExtras, knowledgeBases: string[] = []): PromptExtras | undefined {
  if (!hasExtras(extras) && knowledgeBases.length === 0) return undefined;
  return {
    attachments: extras.attachments.map((item) => ({ key: item.id, type: item.type, filename: item.filename, uri: item.preview })),
    references: [
      ...extras.notebooks.map((notebook) => ({ key: `n${notebook.id}`, kind: 'notebook' as const, label: notebook.name })),
      ...extras.chats.map((chat) => ({ key: `c${chat.id}`, kind: 'chat' as const, label: chat.title })),
      ...knowledgeBases.map((name) => ({ key: `k${name}`, kind: 'knowledge' as const, label: name })),
    ],
  };
}
