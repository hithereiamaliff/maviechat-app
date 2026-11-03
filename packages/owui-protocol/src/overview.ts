import { branchPath, type ChatHistory, type HistoryMessage } from './history';
import { outputText } from './stream';

/** One message in the Overview: the chat's whole tree, every version of every message. */
export interface OverviewRow {
  id: string;
  role: string;
  model?: string;
  /** The start of what it says, on one line. */
  text: string;
  /** One step in for each fork above it, so a conversation without forks stays flat. */
  indent: number;
  /** On the branch the chat shows now. */
  shown: boolean;
  /** Its place among the versions at a fork (absent where there is only one). */
  version: { index: number; count: number } | null;
}

const PREVIEW_LENGTH = 120;

function preview(message: HistoryMessage): string {
  const text = (message.role === 'assistant' ? outputText(message.output) || message.content : message.content) ?? '';
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH - 1)}…` : line;
}

/**
 * The chat's tree as rows, depth first, versions in order; the web draws the same tree as a
 * graph. Rows on the shown branch (the one ending at `leafId`) are marked.
 */
export function overviewRows(history: ChatHistory, leafId: string | null): OverviewRow[] {
  const shown = new Set(branchPath(history, leafId).map((message) => message.id));
  const childrenOf = (message: HistoryMessage) => message.childrenIds.filter((id) => id in history.messages);
  const roots = Object.values(history.messages)
    .filter((message) => message.parentId === null || message.parentId === undefined || !(message.parentId in history.messages))
    .map((message) => message.id);
  const rows: OverviewRow[] = [];
  const seen = new Set<string>();
  // Depth first without recursion, so long chats are fine.
  const stack: { id: string; indent: number; version: OverviewRow['version'] }[] = [];
  const pushLevel = (ids: string[], indent: number) => {
    const forked = ids.length > 1;
    for (let index = ids.length - 1; index >= 0; index -= 1) {
      stack.push({ id: ids[index] as string, indent: forked ? indent + 1 : indent, version: forked ? { index, count: ids.length } : null });
    }
  };
  pushLevel(roots, -1);
  for (let item = stack.pop(); item; item = stack.pop()) {
    const message = history.messages[item.id];
    if (!message || seen.has(item.id)) continue;
    seen.add(item.id);
    const indent = Math.max(0, item.indent);
    rows.push({ id: message.id, role: message.role, model: message.model, text: preview(message), indent, shown: shown.has(message.id), version: item.version });
    pushLevel(childrenOf(message), indent);
  }
  return rows;
}
