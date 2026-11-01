import {
  branchPath,
  getChat,
  initialLeaf,
  selectBranch,
  siblingPosition,
  switchSibling,
  type ChatHistory,
} from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useToast } from '@/components/Toast';
import { useAuthed } from '@/lib/server';

const EMPTY_HISTORY: ChatHistory = { messages: {}, currentId: null };

/** Loads a chat and tracks which branch is shown; switching branches is saved like the web app does. */
export function useChatView(chatId: string) {
  const { client } = useAuthed();
  const toast = useToast();
  const query = useQuery({ queryKey: ['chat', chatId], queryFn: () => getChat(client, chatId), enabled: Boolean(chatId) });
  // Keyed by chat, so opening another chat starts from that chat's own saved branch.
  const [selection, setSelection] = useState<{ chatId: string; leaf: string } | null>(null);

  const history = query.data?.chat?.history ?? EMPTY_HISTORY;
  const selected = selection?.chatId === chatId && history.messages[selection.leaf] ? selection.leaf : null;
  const leaf = selected ?? initialLeaf(history, query.data?.current_message_id);
  const messages = useMemo(() => branchPath(history, leaf), [history, leaf]);

  const position = useCallback((messageId: string) => siblingPosition(history, messageId), [history]);

  const step = useCallback(
    (messageId: string, direction: -1 | 1) => {
      const next = switchSibling(history, messageId, direction);
      if (!next) return;
      setSelection({ chatId, leaf: next });
      selectBranch(client, chatId, next).catch(() => toast("Couldn't save which version is shown", 'error'));
    },
    [history, client, chatId, toast],
  );

  /** Show this leaf (e.g. a reply just sent) without saving the choice; the server already did. */
  const select = useCallback((leafId: string) => setSelection({ chatId, leaf: leafId }), [chatId]);

  return { query, messages, position, step, select };
}
