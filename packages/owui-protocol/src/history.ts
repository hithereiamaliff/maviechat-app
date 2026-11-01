import type { OutputItem } from './output';

/** One node of a chat's history tree (`chat.history.messages[id]`). Unknown fields are kept. */
export interface HistoryMessage {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  role: string;
  content: string;
  model?: string;
  modelName?: string;
  modelIdx?: number;
  /** On user messages: the models the turn was sent to. */
  models?: string[];
  /** Unix seconds. */
  timestamp?: number;
  done?: boolean;
  output?: OutputItem[];
  files?: unknown[];
  sources?: unknown[];
  statusHistory?: unknown[];
  followUps?: string[];
  error?: unknown;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ChatHistory {
  messages: Record<string, HistoryMessage>;
  currentId: string | null;
}

/** Messages from the root down to `leafId` (default: the shown leaf), oldest first. Stops at missing parents and cycles. */
export function branchPath(history: ChatHistory, leafId: string | null = history.currentId): HistoryMessage[] {
  const path: HistoryMessage[] = [];
  const seen = new Set<string>();
  let id = leafId;
  while (id && !seen.has(id)) {
    const message = history.messages[id];
    if (!message) break;
    seen.add(id);
    path.push(message);
    id = message.parentId;
  }
  return path.reverse();
}

/** Ids on the same level as `messageId`: its parent's children, or all root messages. */
export function siblingIds(history: ChatHistory, messageId: string): string[] {
  const message = history.messages[messageId];
  if (!message) return [];
  if (message.parentId === null || message.parentId === undefined) {
    return Object.values(history.messages)
      .filter((m) => m.parentId === null || m.parentId === undefined)
      .map((m) => m.id);
  }
  const parent = history.messages[message.parentId];
  return parent ? parent.childrenIds.filter((id) => id in history.messages) : [messageId];
}

/** Follows the newest child down to a leaf, which is where switching branches lands. */
export function newestLeaf(history: ChatHistory, messageId: string): string {
  const seen = new Set<string>();
  let id = messageId;
  for (;;) {
    seen.add(id);
    const children = (history.messages[id]?.childrenIds ?? []).filter((child) => child in history.messages);
    const next = children[children.length - 1];
    if (!next || seen.has(next)) return id;
    id = next;
  }
}

/** The new `currentId` after moving `messageId` one sibling back or forward, or null at either end. */
export function switchSibling(history: ChatHistory, messageId: string, step: -1 | 1): string | null {
  const siblings = siblingIds(history, messageId);
  const index = siblings.indexOf(messageId);
  const target = siblings[index + step];
  if (index < 0 || target === undefined) return null;
  return newestLeaf(history, target);
}

/** Position of a message among its siblings, for the "‹ 2/3 ›" control. */
export function siblingPosition(history: ChatHistory, messageId: string): { index: number; count: number } {
  const siblings = siblingIds(history, messageId);
  return { index: Math.max(0, siblings.indexOf(messageId)), count: siblings.length };
}

/** The leaf to show when opening a chat: the server's `current_message_id`, then `history.currentId`, then the newest root's leaf. */
export function initialLeaf(history: ChatHistory, currentMessageId?: string | null): string | null {
  if (currentMessageId && history.messages[currentMessageId]) return currentMessageId;
  if (history.currentId && history.messages[history.currentId]) return history.currentId;
  const roots = Object.values(history.messages).filter((m) => m.parentId === null || m.parentId === undefined);
  const lastRoot = roots[roots.length - 1];
  return lastRoot ? newestLeaf(history, lastRoot.id) : null;
}
