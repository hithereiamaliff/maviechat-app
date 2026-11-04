import {
  canUseWorkspace,
  CHAT_PAGE_SIZE,
  folderTree,
  listChats,
  listFolderChats,
  listFolders,
  listPinnedChats,
  searchChats,
  setFolderExpanded,
  sidebarShortcuts,
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
import type { MenuItem } from '@/components/Menu';
import { useAccountsSheet, useOwuiAccountSignOut } from '@/features/accounts/AccountsSheet';
import { useFolderPicker } from '@/features/chats/FolderPicker';
import { useShareSheet } from '@/features/chats/ShareSheet';
import { useTagsSheet } from '@/features/chats/TagsSheet';
import { useChatActions } from '@/features/chats/useChatActions';
import { switchToDeepTutor, switchToOpenCode } from '@/features/deeptutor/switch';
import { useAuthed, useCapabilities, useServerConfig, useSessionUser, useUserSettings } from '@/lib/server';
import { useDebounced } from '@/lib/useDebounced';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useOpenCode } from '@/session/OpenCodeProvider';
import { useSession } from '@/session/SessionProvider';
import { fonts, radius, usePalette } from '@/theme';
import { SidebarAction, SidebarChatRow, SidebarHeading, SidebarNote, SidebarPanel, SidebarSearch, SidebarUser, sidebarStyles } from './parts';
import { SearchFilters } from './SearchFilters';
import { buildSidebarRows, isUnread, type SidebarRow } from './rows';
import { useSidebar } from './SidebarContext';

/** The pages the web can pin under Search: Workspace opens here; the rest open on the web. */
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
  const results = useQuery({ queryKey: ['chats', 'search', query], queryFn: () => searchChats(client, query), enabled: searching });

  // Refresh when the sidebar opens; socket-driven updates arrive with sending (next slice).
  useEffect(() => {
    if (sidebar.isOpen) void queryClient.invalidateQueries({ queryKey: ['chats'] });
  }, [sidebar.isOpen, queryClient]);

  const tree = useMemo(() => folderTree(folders.data ?? []), [folders.data]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isExpanded = (folder: FolderNode) => expanded[folder.id] ?? folder.is_expanded ?? false;
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
    queries: openFolderIds.map((id) => ({ queryKey: ['folder-chats', id], queryFn: () => listFolderChats(client, id) })),
  });

  const rows = useMemo(
    () =>
      buildSidebarRows({
        search: { active: searching, results: results.data, loading: results.isFetching },
        pinned: pinned.data ?? [],
        folders: foldersOn ? tree : [],
        isExpanded: (folder) => expanded[folder.id] ?? folder.is_expanded ?? false,
        folderChats: (id) => folderChats[openFolderIds.indexOf(id)]?.data,
        chats: chats.data?.pages.flat() ?? [],
        chatsLoading: chats.isLoading,
      }),
    [searching, results.data, results.isFetching, pinned.data, foldersOn, tree, expanded, folderChats, openFolderIds, chats.data, chats.isLoading],
  );

  const openChat = (id: string) => {
    sidebar.close();
    if (id !== currentChatId) router.replace(`/c/${id}`);
  };
  const newChat = () => {
    sidebar.close();
    router.replace('/');
  };
  const leaveIfCurrent = (id: string) => () => {
    if (id === currentChatId) router.replace('/');
  };

  const toggleFolder = (folder: FolderNode) => {
    const next = !isExpanded(folder);
    setExpanded((state) => ({ ...state, [folder.id]: next }));
    setFolderExpanded(client, folder.id, next).catch(() => {});
  };
  const openFolder = (folder: FolderNode) => {
    sidebar.close();
    if (folder.id !== currentFolderId) router.replace({ pathname: '/folders/[id]', params: { id: folder.id } });
  };
  const openOnWeb = (path: string) => {
    sidebar.close();
    void WebBrowser.openBrowserAsync(`${session.baseUrl}${path}`);
  };
  const openWorkspace = () => {
    sidebar.close();
    router.push('/workspace');
  };
  // The user's own order, once their settings have loaded (so a customised list never flashes the defaults).
  const shortcuts =
    capabilities && !settings.isPending
      ? sidebarShortcuts(capabilities, (settings.data?.ui as { pinnedMenuItems?: unknown } | null | undefined)?.pinnedMenuItems)
      : [];
  const userMenu: MenuItem[] = [
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
        return <SidebarHeading label={item.label} />;
      case 'note':
        return <SidebarNote label={item.label} depth={item.depth} />;
      case 'folder':
        // As on the web: the row opens the folder's page, the chevron opens or closes it here.
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the folder"
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
            <Icon name={item.expanded ? 'folder-open' : 'folder'} size={17} color={palette.textMuted} />
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
              {item.folder.name}
            </Text>
            {item.folder.unread_count ? (
              <Text style={[styles.badge, { backgroundColor: palette.surfaceStrong, color: palette.textMuted }]}>{item.folder.unread_count}</Text>
            ) : null}
          </Pressable>
        );
      case 'chat':
        return (
          <SidebarChatRow
            title={item.chat.title || 'New Chat'}
            depth={item.depth}
            busy={Boolean(item.chat.active)}
            unread={isUnread(item.chat)}
            pinned={item.pinned}
            current={item.chat.id === currentChatId}
            onOpen={() => openChat(item.chat.id)}
            menu={[
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
              hint={id === 'workspace' ? undefined : 'Opens on the web'}
              onPress={() => (id === 'workspace' ? openWorkspace() : openOnWeb(SHORTCUTS[id].path))}
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
            if (!searching && chats.hasNextPage && !chats.isFetchingNextPage) void chats.fetchNextPage();
          }}
          refreshing={false}
          onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['chats'] })}
          ListFooterComponent={chats.isFetchingNextPage ? <ActivityIndicator style={sidebarStyles.more} color={palette.textMuted} /> : null}
          contentContainerStyle={sidebarStyles.listContent}
        />
      </View>

      <SidebarUser name={you.data?.name ?? session.user.name} picture={you.data?.profile_image_url} menu={userMenu} />
      {picker.element}
      {shareSheet.element}
      {tagsSheet.element}
      {accountsSheet.element}
    </SidebarPanel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingRight: 0, borderRadius: radius.md },
  title: { flex: 1, fontFamily: fonts.regular, fontSize: 14 },
  chevron: { width: 22, height: 30, alignItems: 'center', justifyContent: 'center' },
  badge: { overflow: 'hidden', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, fontFamily: fonts.medium, fontSize: 11, marginRight: 8 },
});
