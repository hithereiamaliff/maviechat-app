import {
  canUseWorkspace,
  CHAT_PAGE_SIZE,
  createNote,
  folderTree,
  withSharedFolders,
  type FolderChat,
  listChats,
  listFolders,
  listPinnedChats,
  noteTitle,
  searchChats,
  searchText,
  SEARCH_PAGE_SIZE,
  userStatusOf,
  userStatusOn,
  setFolderExpanded,
  sidebarShortcuts,
  toggleNotePinned,
  type FolderNode,
  type ShortcutId,
} from '@maviechat/owui-protocol';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { useAccountsSheet, useOwuiAccountSignOut } from '@/features/accounts/AccountsSheet';
import { statusLine, useSetStatus, useStatusSheet } from '@/features/sidebar/StatusSheet';
import { folderChatsFirstPage, useSharedFolders } from '@/features/folders/queries';
import { emojiOfName } from '@/lib/emoji';
import { ModelAvatar } from '@/features/chat/ModelAvatar';
import { usePinnedModels } from '@/features/chat/usePinnedModels';
import { useFolderPicker } from '@/features/chats/FolderPicker';
import { useShareSheet } from '@/features/chats/ShareSheet';
import { useTagsSheet } from '@/features/chats/TagsSheet';
import { useChatActions } from '@/features/chats/useChatActions';
import { switchToDeepTutor, switchToOpenCode } from '@/features/deeptutor/switch';
import { useFolderActions } from '@/features/folders/useFolderActions';
import { useNotesOn, usePinnedNotes } from '@/features/notes/queries';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useServerConfig, useSessionUser, useUserSettings } from '@/lib/server';
import { useDebounced } from '@/lib/useDebounced';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useOpenCode } from '@/session/OpenCodeProvider';
import { useSession } from '@/session/SessionProvider';
import { fonts, radius, usePalette } from '@/theme';
import { SidebarAction, SidebarChatRow, SidebarHeading, SidebarNote, SidebarPanel, SidebarSearch, SidebarUser, sidebarStyles } from './parts';
import { SearchFilters } from './SearchFilters';
import { SearchSnippet } from './SearchSnippet';
import { buildSidebarRows, isUnread, type SidebarRow } from './rows';
import { useSidebar } from './SidebarContext';

/** The pages the web can pin under Search: Notes and Workspace open here; the rest open on the web. */
const SHORTCUTS: Record<ShortcutId, { label: string; icon: IconName; path: string }> = {
  notes: { label: 'Notes', icon: 'document-text', path: '/notes' },
  workspace: { label: 'Workspace', icon: 'squares-2x2', path: '/workspace' },
  automations: { label: 'Automations', icon: 'clock', path: '/automations' },
  calendar: { label: 'Calendar', icon: 'calendar', path: '/calendar' },
  playground: { label: 'Playground', icon: 'code-bracket', path: '/playground' },
};

export function Sidebar() {
  const palette = usePalette();
  const sidebar = useSidebar();
  const { client, session } = useAuthed();
  const owui = useSession();
  const signOutOf = useOwuiAccountSignOut();
  const accountsSheet = useAccountsSheet('owui');
  const statusSheet = useStatusSheet();
  const setStatus = useSetStatus();
  const deepTutorSignedIn = useDeepTutor().state.status === 'signed-in';
  const openCodeSignedIn = useOpenCode().state.status === 'signed-in';
  const queryClient = useQueryClient();
  const capabilities = useCapabilities();
  // Your name and picture as they are now (Settings → Account can change them).
  const you = useSessionUser();
  const config = useServerConfig();
  const settings = useUserSettings();
  const actions = useChatActions();
  const picker = useFolderPicker();
  const shareSheet = useShareSheet();
  const tagsSheet = useTagsSheet();
  const pathname = usePathname();
  const currentChatId = pathname.startsWith('/c/') ? decodeURIComponent(pathname.slice(3)) : null;
  const currentFolderId = pathname.startsWith('/folders/') ? decodeURIComponent(pathname.slice('/folders/'.length)) : null;

  const [search, setSearch] = useState<string | null>(null);
  const query = useDebounced(search?.trim() ?? '', 300);
  const searching = search !== null && query.length > 0;
  const foldersOn = capabilities?.feature('folders') ?? false;

  const chats = useInfiniteQuery({
    queryKey: ['chats', 'list'],
    queryFn: ({ pageParam }) => listChats(client, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.length >= CHAT_PAGE_SIZE ? all.length + 1 : undefined),
  });
  const pinned = useQuery({ queryKey: ['chats', 'pinned'], queryFn: () => listPinnedChats(client) });
  const folders = useQuery({ queryKey: ['folders'], queryFn: () => listFolders(client), enabled: foldersOn });
  // Folders other people share with you sit in the same tree, as on the web.
  const shared = useSharedFolders(foldersOn);
  const sharedById = useMemo(() => {
    const own = new Set((folders.data ?? []).map((folder) => folder.id));
    return new Map((shared.data ?? []).filter((folder) => !own.has(folder.id)).map((folder) => [folder.id, folder]));
  }, [folders.data, shared.data]);
  // The server answers a page of 60 at a time; more come as you scroll, as on the web.
  const results = useInfiniteQuery({
    queryKey: ['chats', 'search', query],
    queryFn: ({ pageParam }) => searchChats(client, query, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.length >= SEARCH_PAGE_SIZE ? all.length + 1 : undefined),
    enabled: searching,
  });
  const found = useMemo(() => {
    if (!results.data) return undefined;
    const seen = new Set<string>();
    return results.data.pages.flat().filter((chat) => !seen.has(chat.id) && Boolean(seen.add(chat.id)));
  }, [results.data]);
  const pinnedModels = usePinnedModels();
  const toast = useToast();
  const notesOn = useNotesOn();
  const pinnedNotes = usePinnedNotes();

  // Refresh when the sidebar opens; socket-driven updates arrive with sending (next slice).
  useEffect(() => {
    if (sidebar.isOpen) void queryClient.invalidateQueries({ queryKey: ['chats'] });
  }, [sidebar.isOpen, queryClient]);

  const tree = useMemo(() => folderTree(withSharedFolders(folders.data ?? [], [...sharedById.values()])), [folders.data, sharedById]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isExpanded = (folder: FolderNode) => expanded[folder.id] ?? folder.is_expanded ?? false;
  const folderActions = useFolderActions({
    onNavigate: () => sidebar.close(),
    // A folder made inside another shows at once: the outer one opens.
    onCreated: (_folder, parentId) => {
      if (parentId) setExpanded((state) => ({ ...state, [parentId]: true }));
    },
  });
  const openFolderIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (nodes: FolderNode[]) => {
      for (const node of nodes) {
        if (expanded[node.id] ?? node.is_expanded ?? false) {
          ids.push(node.id);
          walk(node.children);
        }
      }
    };
    walk(tree);
    return ids;
  }, [tree, expanded]);
  const folderChats = useQueries({
    // Everyone's chats in the folder (people you share it with may write in it too), as the web lists them.
    queries: openFolderIds.map((id) => ({ queryKey: ['folder-chats', id], queryFn: () => folderChatsFirstPage(client, id) })),
  });

  const rows = useMemo(
    () =>
      buildSidebarRows({
        search: { active: searching, results: found, loading: results.isFetching, text: searchText(query) },
        pinned: pinned.data ?? [],
        pinnedModels: pinnedModels.visible.map((model) => ({ id: model.id, name: model.name ?? model.id })),
        pinnedNotes: notesOn ? (pinnedNotes.data ?? []).map((note) => ({ id: note.id, title: noteTitle(note) })) : [],
        folders: foldersOn ? tree : [],
        foldersOn,
        isExpanded: (folder) => expanded[folder.id] ?? folder.is_expanded ?? false,
        folderChats: (id) => folderChats[openFolderIds.indexOf(id)]?.data,
        chats: chats.data?.pages.flat() ?? [],
        chatsLoading: chats.isLoading,
      }),
    [searching, found, results.isFetching, query, pinned.data, pinnedModels.visible, notesOn, pinnedNotes.data, foldersOn, tree, expanded, folderChats, openFolderIds, chats.data, chats.isLoading],
  );

  const openChat = (id: string) => {
    sidebar.close();
    if (id !== currentChatId) router.replace(`/c/${id}`);
  };
  const newChat = () => {
    sidebar.close();
    router.replace('/');
  };
  // The search's words in a new chat's message box (nothing is sent).
  const newChatWith = (text: string) => {
    sidebar.close();
    setSearch(null);
    router.replace({ pathname: '/', params: { q: text } });
  };
  const leaveIfCurrent = (id: string) => () => {
    if (id === currentChatId) router.replace('/');
  };

  const toggleFolder = (folder: FolderNode) => {
    const next = !isExpanded(folder);
    setExpanded((state) => ({ ...state, [folder.id]: next }));
    // Open or closed is kept on the server for your own folders; a shared one's is the owner's to keep.
    if (!sharedById.has(folder.id)) setFolderExpanded(client, folder.id, next).catch(() => {});
  };
  const openFolder = (folder: FolderNode) => {
    sidebar.close();
    if (folder.id !== currentFolderId) router.replace({ pathname: '/folders/[id]', params: { id: folder.id } });
  };
  // As the web's pinned model links to `/?model=`: a new chat with that model.
  const openModel = (id: string) => {
    sidebar.close();
    router.replace({ pathname: '/', params: { model: id } });
  };
  const openOnWeb = (path: string) => {
    sidebar.close();
    void WebBrowser.openBrowserAsync(`${session.baseUrl}${path}`);
  };
  const openWorkspace = () => {
    sidebar.close();
    router.push('/workspace');
  };
  const openNotes = () => {
    sidebar.close();
    router.push('/notes');
  };
  const openNote = (id: string) => {
    sidebar.close();
    router.push({ pathname: '/notes/[id]', params: { id } });
  };
  const unpinNote = (id: string) =>
    void toggleNotePinned(client, id).then(
      () => void queryClient.invalidateQueries({ queryKey: ['notes'] }),
      (error: unknown) => toast(`Couldn’t unpin it: ${describeError(error)}`, 'error'),
    );
  // The Notes section's +, as on the web: a note named "New Note", opened to write in.
  const newNote = () =>
    void createNote(client, { title: 'New Note' }).then(
      (note) => {
        void queryClient.invalidateQueries({ queryKey: ['notes'] });
        sidebar.close();
        router.push({ pathname: '/notes/[id]', params: { id: note.id, new: '1' } });
      },
      (error: unknown) => toast(`Couldn’t make a note: ${describeError(error)}`, 'error'),
    );
  // The user's own order, once their settings have loaded (so a customised list never flashes the defaults).
  const shortcuts =
    capabilities && !settings.isPending
      ? sidebarShortcuts(capabilities, (settings.data?.ui as { pinnedMenuItems?: unknown } | null | undefined)?.pinnedMenuItems)
      : [];
  // Your status, as the web's user menu has it (while the admin keeps statuses on).
  const statusOn = userStatusOn(config.data);
  const status = statusLine(userStatusOf(you.data));
  const userMenu: MenuItem[] = [
    ...(statusOn
      ? status
        ? [
            { key: 'status', label: status, icon: 'face-smile' as const, onPress: statusSheet.open },
            { key: 'clear-status', label: 'Clear Status', icon: 'x-mark' as const, onPress: () => void setStatus({ emoji: '', message: '' }) },
          ]
        : [{ key: 'status', label: 'Update Your Status', icon: 'face-smile' as const, onPress: statusSheet.open }]
      : []),
    ...(capabilities && canUseWorkspace(capabilities)
      ? [{ key: 'workspace', label: 'Workspace', icon: 'squares-2x2' as const, onPress: openWorkspace }]
      : []),
    ...(capabilities?.isAdmin
      ? [
          {
            key: 'admin',
            label: 'Admin Panel',
            icon: 'wrench-screwdriver' as const,
            onPress: () => {
              sidebar.close();
              router.push('/admin');
            },
          },
        ]
      : []),
    {
      key: 'settings',
      label: 'Settings',
      icon: 'cog-6-tooth',
      onPress: () => {
        sidebar.close();
        router.push('/settings');
      },
    },
    {
      key: 'deeptutor',
      label: deepTutorSignedIn ? 'Switch to DeepTutor' : 'Connect DeepTutor',
      icon: deepTutorSignedIn ? 'arrows-right-left' : 'academic-cap',
      onPress: () => {
        sidebar.close();
        switchToDeepTutor(deepTutorSignedIn);
      },
    },
    {
      key: 'opencode',
      label: openCodeSignedIn ? 'Switch to OpenCode' : 'Connect OpenCode',
      icon: openCodeSignedIn ? 'arrows-right-left' : 'code-bracket',
      onPress: () => {
        sidebar.close();
        switchToOpenCode(openCodeSignedIn);
      },
    },
    {
      key: 'connection',
      label: 'Connection',
      icon: 'signal',
      onPress: () => {
        sidebar.close();
        router.push('/connection');
      },
    },
    {
      key: 'accounts',
      label: 'Accounts',
      icon: 'users',
      onPress: () => {
        sidebar.close();
        accountsSheet.open();
      },
    },
    {
      key: 'signout',
      label: 'Sign Out',
      icon: 'arrow-right-start-on-rectangle',
      // This account's notifications stop on this phone (DeepTutor's carry on); the latest other account takes over.
      onPress: () =>
        void (owui.state.status === 'signed-in' ? signOutOf(owui.state.accountId) : Promise.resolve(false)).then((stillIn) => {
          if (stillIn) router.replace('/');
        }),
    },
  ];

  const renderRow = ({ item }: { item: SidebarRow }) => {
    switch (item.type) {
      case 'header':
        return (
          <SidebarHeading
            label={item.label}
            action={item.addFolder ? { icon: 'plus', label: 'New Folder', onPress: folderActions.newFolder } : item.addNote ? { icon: 'plus', label: 'New Note', onPress: newNote } : undefined}
          />
        );
      case 'note':
        return <SidebarNote label={item.label} depth={item.depth} />;
      case 'newChatWith':
        return <SidebarAction icon="pencil-square" label={`New chat with “${item.text}”`} hint="Puts these words in a new chat’s message box" onPress={() => newChatWith(item.text)} />;
      case 'model':
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Starts a new chat with this model"
            onPress={() => openModel(item.id)}
            style={({ pressed }) => [styles.row, styles.modelRow, pressed && { backgroundColor: palette.sidebarActive }]}>
            <ModelAvatar modelId={item.id} size={20} />
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
              {item.name}
            </Text>
            <MenuButton
              items={[{ key: 'unpin', label: 'Hide from Sidebar', icon: 'bookmark-slash', onPress: () => pinnedModels.toggle(item.id) }]}
              label={`Options for ${item.name}`}
              size={18}
              color={palette.textMuted}
            />
          </Pressable>
        );
      case 'pinnedNote':
        return (
          <Pressable accessibilityRole="button" accessibilityHint="Opens the note" onPress={() => openNote(item.id)} style={({ pressed }) => [styles.row, styles.modelRow, pressed && { backgroundColor: palette.sidebarActive }]}>
            <Icon name="document-text" size={18} color={palette.textMuted} />
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
              {item.title}
            </Text>
            <MenuButton
              items={[{ key: 'unpin', label: 'Unpin from Sidebar', icon: 'bookmark-slash', onPress: () => unpinNote(item.id) }]}
              label={`Options for ${item.title}`}
              size={18}
              color={palette.textMuted}
            />
          </Pressable>
        );
      case 'folder': {
        // As on the web: the row opens the folder's page, the chevron opens or closes it here.
        const sharedFolder = sharedById.get(item.folder.id);
        const folderMenu = !sharedFolder
          ? folderActions.items(item.folder, {
              onDeleted: () => {
                if (item.folder.id === currentFolderId) router.replace('/');
              },
            })
          : sharedFolder.permission === 'write'
            ? folderActions.items(item.folder, { shared: true })
            : [];
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityHint={sharedFolder ? `Opens the folder ${sharedFolder.owner_name || 'someone'} shares with you${sharedFolder.permission === 'read' ? ', to read' : ''}` : 'Opens the folder'}
            onPress={() => openFolder(item.folder)}
            style={({ pressed }) => [
              styles.row,
              { paddingLeft: 2 + item.depth * 14 },
              (pressed || item.folder.id === currentFolderId) && { backgroundColor: palette.sidebarActive },
            ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.expanded ? `Collapse ${item.folder.name}` : `Expand ${item.folder.name}`}
              accessibilityState={{ expanded: item.expanded }}
              hitSlop={8}
              onPress={() => toggleFolder(item.folder)}
              style={styles.chevron}>
              <Icon name={item.expanded ? 'chevron-down' : 'chevron-right'} size={12} color={palette.textMuted} strokeWidth={2} />
            </Pressable>
            {typeof item.folder.meta?.icon === 'string' && item.folder.meta.icon ? (
              <Text style={styles.folderEmoji}>{emojiOfName(item.folder.meta.icon)}</Text>
            ) : (
              <Icon name={item.expanded ? 'folder-open' : 'folder'} size={17} color={palette.textMuted} />
            )}
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
              {item.folder.name}
            </Text>
            {sharedFolder ? <Icon name="users" size={13} color={palette.textFaint} /> : null}
            {!sharedFolder && item.folder.unread_count ? (
              <Text style={[styles.badge, { backgroundColor: palette.surfaceStrong, color: palette.textMuted }]}>{item.folder.unread_count}</Text>
            ) : null}
            {folderMenu.length ? <MenuButton items={folderMenu} label={`Options for ${item.folder.name}`} size={18} color={palette.textMuted} /> : <View style={styles.noMenu} />}
          </Pressable>
        );
      }
      case 'chat': {
        // Someone else's chat (in a folder shared with you, or one you share): theirs to change, yours to read.
        const owner = (item.chat as FolderChat).user_id;
        const theirs = typeof owner === 'string' && owner !== '' && owner !== session.user.id;
        return (
          <SidebarChatRow
            title={item.chat.title || 'New Chat'}
            depth={item.depth}
            busy={Boolean(item.chat.active)}
            unread={isUnread(item.chat)}
            pinned={item.pinned}
            current={item.chat.id === currentChatId}
            detail={item.found ? <SearchSnippet chatId={item.chat.id} snippet={item.chat.snippet} search={query} /> : undefined}
            owner={theirs ? { id: owner, name: (item.chat as FolderChat).owner_name ?? '' } : undefined}
            onOpen={() => openChat(item.chat.id)}
            menu={theirs ? [] : [
              { key: 'rename', label: 'Rename', icon: 'pencil', onPress: () => actions.rename(item.chat) },
              { key: 'unread', label: 'Mark as unread', icon: 'envelope', onPress: () => actions.markUnread(item.chat) },
              {
                key: 'pin',
                label: item.pinned ? 'Unpin' : 'Pin',
                icon: item.pinned ? 'bookmark-slash' : 'bookmark',
                onPress: () => actions.togglePin(item.chat, item.pinned),
              },
              { key: 'tags', label: 'Tags', icon: 'tag', onPress: () => tagsSheet.open(item.chat) },
              ...(actions.canShare ? [{ key: 'share', label: 'Share', icon: 'link' as const, onPress: () => shareSheet.open(item.chat) }] : []),
              ...(actions.canExport ? [{ key: 'download', label: 'Download', icon: 'arrow-down' as const, onPress: () => actions.download(item.chat) }] : []),
              ...(actions.canClone
                ? [
                    {
                      key: 'clone',
                      label: 'Clone',
                      icon: 'rectangle-stack' as const,
                      onPress: () => void actions.clone(item.chat).then((copy) => (copy ? openChat(copy) : undefined)),
                    },
                  ]
                : []),
              ...(actions.canMove ? [{ key: 'move', label: 'Move', icon: 'folder' as const, onPress: () => picker.open(item.chat) }] : []),
              { key: 'archive', label: 'Archive', icon: 'archive-box', onPress: () => void actions.archive(item.chat, leaveIfCurrent(item.chat.id)) },
              ...(actions.canDelete
                ? [
                    {
                      key: 'delete',
                      label: 'Delete',
                      icon: 'trash' as const,
                      destructive: true,
                      onPress: () => actions.remove(item.chat, leaveIfCurrent(item.chat.id)),
                    },
                  ]
                : []),
            ]}
          />
        );
      }
    }
  };

  return (
    <SidebarPanel name={config.data?.name ?? 'Open WebUI'} onNewChat={newChat}>
      <SidebarAction icon="pencil-square" label="New Chat" onPress={newChat} />
      <SidebarSearch value={search} onChange={setSearch} placeholder="Search chats" />
      {search !== null ? <SearchFilters value={search} onChange={setSearch} /> : null}
      {search === null
        ? shortcuts.map((id) => (
            <SidebarAction
              key={id}
              icon={SHORTCUTS[id].icon}
              label={SHORTCUTS[id].label}
              hint={id === 'workspace' || id === 'notes' ? undefined : 'Opens on the web'}
              onPress={() => (id === 'workspace' ? openWorkspace() : id === 'notes' ? openNotes() : openOnWeb(SHORTCUTS[id].path))}
            />
          ))
        : null}

      <View style={sidebarStyles.list}>
        <FlashList
          data={rows}
          keyExtractor={(row) => row.key}
          getItemType={(row) => row.type}
          renderItem={renderRow}
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (searching) {
              if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
            } else if (chats.hasNextPage && !chats.isFetchingNextPage) void chats.fetchNextPage();
          }}
          refreshing={false}
          onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['chats'] })}
          ListFooterComponent={(searching ? results.isFetchingNextPage : chats.isFetchingNextPage) ? <ActivityIndicator style={sidebarStyles.more} color={palette.textMuted} /> : null}
          contentContainerStyle={sidebarStyles.listContent}
        />
      </View>

      <SidebarUser name={you.data?.name ?? session.user.name} picture={you.data?.profile_image_url} menu={userMenu} status={statusOn ? status : undefined} online={config.data?.features?.enable_user_status === true} />
      {picker.element}
      {shareSheet.element}
      {tagsSheet.element}
      {accountsSheet.element}
      {statusSheet.element}
      {folderActions.element}
    </SidebarPanel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingRight: 0, borderRadius: radius.md },
  title: { flex: 1, fontFamily: fonts.regular, fontSize: 14 },
  chevron: { width: 22, height: 30, alignItems: 'center', justifyContent: 'center' },
  modelRow: { paddingLeft: 12, gap: 10 },
  badge: { overflow: 'hidden', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, fontFamily: fonts.medium, fontSize: 11, marginRight: 8 },
  folderEmoji: { fontSize: 15, width: 17, textAlign: 'center' },
  noMenu: { width: 36 },
});
