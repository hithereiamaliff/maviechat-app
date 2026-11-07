import { groupByTime, type ChatListItem, type FolderNode } from '@maviechat/owui-protocol';

export type SidebarRow =
  | { type: 'header'; key: string; label: string; addFolder?: boolean }
  /** `found`: a search result, shown with the text it matched. */
  | { type: 'chat'; key: string; chat: ChatListItem; depth: number; pinned: boolean; found?: true }
  /** Searching: a new chat with the search's words in the message box (the web's "Start a new conversation"). */
  | { type: 'newChatWith'; key: string; text: string }
  | { type: 'folder'; key: string; folder: FolderNode; depth: number; expanded: boolean }
  | { type: 'note'; key: string; label: string; depth: number }
  | { type: 'model'; key: string; id: string; name: string };

interface BuildInput {
  /** `text`: the search's words without its filters. */
  search: { active: boolean; results: ChatListItem[] | undefined; loading: boolean; text?: string };
  pinned: ChatListItem[];
  /** Models kept in the sidebar (the web's Models section), in their order. */
  pinnedModels?: { id: string; name: string }[];
  folders: FolderNode[];
  /** Folders are on for this account: their heading shows (with New Folder) even before there are any. */
  foldersOn?: boolean;
  isExpanded: (folder: FolderNode) => boolean;
  folderChats: (folderId: string) => ChatListItem[] | undefined;
  chats: ChatListItem[];
  chatsLoading: boolean;
  now?: Date;
}

/** Flattens the sidebar into rows: Pinned, the folder tree (open folders show their chats), then dated chats. */
export function buildSidebarRows(input: BuildInput): SidebarRow[] {
  const rows: SidebarRow[] = [];

  if (input.search.active) {
    if (input.search.text) rows.push({ type: 'newChatWith', key: 'search-new-chat', text: input.search.text });
    if (input.search.loading && !input.search.results) rows.push({ type: 'note', key: 'search-loading', label: 'Searching…', depth: 0 });
    else if (input.search.results?.length === 0) rows.push({ type: 'note', key: 'search-empty', label: 'No chats found', depth: 0 });
    // Dated, as the web shows results, each with the text it matched.
    for (const section of groupByTime(input.search.results ?? [], input.now)) {
      rows.push({ type: 'header', key: `hs-${section.group.key}`, label: section.group.label });
      for (const chat of section.items) rows.push({ type: 'chat', key: `search-${chat.id}`, chat, depth: 0, pinned: false, found: true });
    }
    return rows;
  }

  if (input.pinnedModels?.length) {
    rows.push({ type: 'header', key: 'h-models', label: 'Models' });
    for (const model of input.pinnedModels) rows.push({ type: 'model', key: `model-${model.id}`, id: model.id, name: model.name });
  }

  if (input.pinned.length > 0) {
    rows.push({ type: 'header', key: 'h-pinned', label: 'Pinned' });
    for (const chat of input.pinned) rows.push({ type: 'chat', key: `pinned-${chat.id}`, chat, depth: 0, pinned: true });
  }

  if (input.folders.length > 0 || input.foldersOn) {
    rows.push({ type: 'header', key: 'h-folders', label: 'Folders', addFolder: input.foldersOn });
    const addFolder = (folder: FolderNode, depth: number) => {
      const expanded = input.isExpanded(folder);
      rows.push({ type: 'folder', key: `folder-${folder.id}`, folder, depth, expanded });
      if (!expanded) return;
      for (const child of folder.children) addFolder(child, depth + 1);
      const chats = input.folderChats(folder.id);
      if (!chats) rows.push({ type: 'note', key: `folder-loading-${folder.id}`, label: 'Loading…', depth: depth + 1 });
      else if (chats.length === 0 && folder.children.length === 0)
        rows.push({ type: 'note', key: `folder-empty-${folder.id}`, label: 'No chats', depth: depth + 1 });
      for (const chat of chats ?? []) rows.push({ type: 'chat', key: `f-${folder.id}-${chat.id}`, chat, depth: depth + 1, pinned: false });
    };
    for (const folder of input.folders) addFolder(folder, 0);
  }

  for (const section of groupByTime(input.chats, input.now)) {
    rows.push({ type: 'header', key: `h-${section.group.key}`, label: section.group.label });
    for (const chat of section.items) rows.push({ type: 'chat', key: `chat-${chat.id}`, chat, depth: 0, pinned: false });
  }

  if (input.chats.length === 0 && input.pinned.length === 0) {
    rows.push({ type: 'note', key: 'chats-note', label: input.chatsLoading ? 'Loading chats…' : 'No chats yet', depth: 0 });
  }
  return rows;
}

/**
 * A chat has news when it changed after you last read it, or was never read (marking a chat
 * unread sets the read time to 0). Like the web, a chat that is still replying shows its
 * spinner instead.
 */
export function isUnread(chat: ChatListItem): boolean {
  if (chat.active) return false;
  const readAt = typeof chat.last_read_at === 'number' && chat.last_read_at > 0 ? chat.last_read_at : null;
  return readAt === null || chat.updated_at > readAt;
}
