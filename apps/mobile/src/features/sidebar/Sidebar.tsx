import {
  CHAT_PAGE_SIZE,
  folderTree,
  listChats,
  listFolderChats,
  listFolders,
  listPinnedChats,
  searchChats,
  setFolderExpanded,
  type ChatListItem,
  type FolderNode,
} from '@maviechat/owui-protocol';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MenuButton, MenuTrigger } from '@/components/Menu';
import { useChatActions } from '@/features/chats/useChatActions';
import { useAuthed, useCapabilities, useServerConfig } from '@/lib/server';
import { useDebounced } from '@/lib/useDebounced';
import { useSession } from '@/session/SessionProvider';
import { fonts, radius, usePalette } from '@/theme';
import { buildSidebarRows, isUnread, type SidebarRow } from './rows';
import { useSidebar } from './SidebarContext';

export function Sidebar() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const sidebar = useSidebar();
  const { client, session } = useAuthed();
  const { signOut } = useSession();
  const queryClient = useQueryClient();
  const capabilities = useCapabilities();
  const config = useServerConfig();
  const actions = useChatActions();
  const pathname = usePathname();
  const currentChatId = pathname.startsWith('/c/') ? decodeURIComponent(pathname.slice(3)) : null;

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

  const renderRow = ({ item }: { item: SidebarRow }) => {
    switch (item.type) {
      case 'header':
        return <Text style={[styles.header, { color: palette.textFaint }]}>{item.label}</Text>;
      case 'note':
        return <Text style={[styles.note, { color: palette.textFaint, paddingLeft: 12 + item.depth * 14 }]}>{item.label}</Text>;
      case 'folder':
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: item.expanded }}
            onPress={() => toggleFolder(item.folder)}
            style={({ pressed }) => [styles.row, { paddingLeft: 8 + item.depth * 14 }, pressed && { backgroundColor: palette.sidebarActive }]}>
            <Icon name={item.expanded ? 'chevron-down' : 'chevron-right'} size={12} color={palette.textMuted} strokeWidth={2} />
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
          <ChatRow
            chat={item.chat}
            depth={item.depth}
            pinned={item.pinned}
            current={item.chat.id === currentChatId}
            onOpen={() => openChat(item.chat.id)}
            menu={[
              { key: 'rename', label: 'Rename', icon: 'pencil', onPress: () => actions.rename(item.chat) },
              {
                key: 'pin',
                label: item.pinned ? 'Unpin' : 'Pin',
                icon: item.pinned ? 'bookmark-slash' : 'bookmark',
                onPress: () => actions.togglePin(item.chat, item.pinned),
              },
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
    <View style={[styles.panel, { backgroundColor: palette.sidebar, paddingTop: insets.top + 6 }]}>
      <View style={styles.brand}>
        <Pressable onPress={newChat} style={styles.brandName} accessibilityRole="button" accessibilityLabel="New chat">
          <Text style={[styles.brandText, { color: palette.text }]} numberOfLines={1}>
            {config.data?.name ?? 'Open WebUI'}
          </Text>
        </Pressable>
        <IconButton icon="bars-3" label="Close sidebar" onPress={sidebar.close} />
      </View>

      <SidebarAction icon="pencil-square" label="New Chat" onPress={newChat} />
      {search === null ? (
        <SidebarAction icon="magnifying-glass" label="Search" onPress={() => setSearch('')} />
      ) : (
        <View style={[styles.search, { backgroundColor: palette.background, borderColor: palette.border }]}>
          <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
          <TextInput
            autoFocus
            value={search}
            onChangeText={setSearch}
            placeholder="Search chats"
            placeholderTextColor={palette.textFaint}
            returnKeyType="search"
            autoCorrect={false}
            style={[styles.searchInput, { color: palette.text }]}
          />
          <IconButton icon="x-mark" label="Close search" size={16} color={palette.textMuted} onPress={() => setSearch(null)} />
        </View>
      )}

      <View style={styles.list}>
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
          ListFooterComponent={chats.isFetchingNextPage ? <ActivityIndicator style={styles.more} color={palette.textMuted} /> : null}
          contentContainerStyle={styles.listContent}
        />
      </View>

      <View style={[styles.footer, { borderTopColor: palette.border, paddingBottom: insets.bottom + 6 }]}>
        <MenuTrigger
          label="Account"
          items={[
            {
              key: 'connection',
              label: 'Connection',
              icon: 'signal',
              onPress: () => {
                sidebar.close();
                router.push('/connection');
              },
            },
            { key: 'signout', label: 'Sign out', icon: 'arrow-right-start-on-rectangle', onPress: () => void signOut() },
          ]}>
          <View style={styles.user}>
            <View style={[styles.avatar, { backgroundColor: palette.surfaceStrong }]}>
              <Text style={[styles.avatarText, { color: palette.text }]}>{initials(session.user.name)}</Text>
            </View>
            <Text style={[styles.userName, { color: palette.text }]} numberOfLines={1}>
              {session.user.name}
            </Text>
          </View>
        </MenuTrigger>
      </View>
    </View>
  );
}

function ChatRow({
  chat,
  depth,
  pinned,
  current,
  onOpen,
  menu,
}: {
  chat: ChatListItem;
  depth: number;
  pinned: boolean;
  current: boolean;
  onOpen: () => void;
  menu: Parameters<typeof MenuButton>[0]['items'];
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [
        styles.row,
        { paddingLeft: 12 + depth * 14 },
        (current || pressed) && { backgroundColor: palette.sidebarActive },
      ]}>
      <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
        {chat.title || 'New Chat'}
      </Text>
      {chat.active ? (
        <ActivityIndicator size="small" color={palette.textMuted} />
      ) : !current && isUnread(chat) ? (
        <View style={[styles.dot, { backgroundColor: palette.unread }]} accessibilityLabel="Unread" />
      ) : null}
      {pinned ? <Icon name="bookmark" size={14} color={palette.textFaint} /> : null}
      <MenuButton items={menu} label={`Options for ${chat.title}`} size={18} color={palette.textMuted} />
    </Pressable>
  );
}

function SidebarAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && { backgroundColor: palette.sidebarActive }]}>
      <Icon name={icon} size={19} color={palette.text} />
      <Text style={[styles.actionText, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

const styles = StyleSheet.create({
  panel: { flex: 1, paddingHorizontal: 8 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 6, marginBottom: 4 },
  brandName: { flex: 1 },
  brandText: { fontFamily: fonts.semibold, fontSize: 15 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingHorizontal: 10, borderRadius: radius.md },
  actionText: { fontFamily: fonts.medium, fontSize: 15 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    marginVertical: 2,
    paddingLeft: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  list: { flex: 1, marginTop: 6 },
  listContent: { paddingBottom: 12 },
  header: { fontFamily: fonts.medium, fontSize: 12, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 4 },
  note: { fontFamily: fonts.regular, fontSize: 13, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingRight: 0, borderRadius: radius.md },
  title: { flex: 1, fontFamily: fonts.regular, fontSize: 14 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  badge: { overflow: 'hidden', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, fontFamily: fonts.medium, fontSize: 11, marginRight: 8 },
  more: { marginVertical: 12 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  user: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.semibold, fontSize: 12 },
  userName: { flex: 1, fontFamily: fonts.medium, fontSize: 15 },
});
