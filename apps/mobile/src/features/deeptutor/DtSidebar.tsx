import { listSessions, searchSessions, sessionStatusColor, sessionTitle } from '@maviechat/deeptutor-protocol';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/Icon';
import type { MenuItem } from '@/components/Menu';
import { SidebarAction, SidebarChatRow, SidebarHeading, SidebarNote, SidebarPanel, SidebarSearch, SidebarUser, sidebarStyles } from '@/features/sidebar/parts';
import { useSidebar } from '@/features/sidebar/SidebarContext';
import { useDebounced } from '@/lib/useDebounced';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { radius, usePalette } from '@/theme';
import { opensNatively } from './learning/ways';
import { DT_ADMIN_PAGE, shelvesFor, type DtPage, type DtShelfKey } from './pages';
import { useDtProfile, useDtTaskBoard } from './queries';
import { buildDtSidebarRows, type DtSidebarRow } from './sidebarRows';
import { switchToOpenWebUI } from './switch';
import { useDtChatActions } from './useDtChatActions';
import { useDtSignOut } from './useDtSignOut';

const PAGE_SIZE = 100;
const NOT_CHATS = new Set(['web', 'settings', 'connection', 'practice', 'questions', 'favorites', 'journal', 'history', 'knowledge', 'calendar', 'tasks', 'learning', 'mastery']);

/**
 * DeepTutor's sidebar, laid out like Open WebUI's (new chat, search, you at the bottom) and
 * organised like DeepTutor's own: five shelves of pages, with your chats on Home. Pages the app
 * doesn't have natively yet open DeepTutor's own page, signed in.
 */
export function DtSidebar() {
  const palette = usePalette();
  const sidebar = useSidebar();
  const { client, session } = useDtAuthed();
  const confirmSignOut = useDtSignOut();
  const owuiSignedIn = useSession().state.status === 'signed-in';
  const queryClient = useQueryClient();
  const actions = useDtChatActions();
  const profile = useDtProfile();
  // A chat linked to a task shows that task's column colour, as on DeepTutor's web app.
  const board = useDtTaskBoard();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ path?: string }>();
  const segment = pathname.startsWith('/learn/') ? decodeURIComponent(pathname.slice('/learn/'.length)) : null;
  const currentChatId = segment && !segment.includes('/') && !NOT_CHATS.has(segment) ? segment : null;
  const currentPagePath = segment === 'web' && typeof params.path === 'string' ? params.path : null;

  const learner = profile.data?.preset === 'learner';
  const shelves = useMemo(() => shelvesFor(learner), [learner]);
  const [shelfKey, setShelfKey] = useState<DtShelfKey>('home');
  const shelf = shelves.find((item) => item.key === shelfKey) ?? shelves[0]!;
  const [search, setSearch] = useState<string | null>(null);
  const query = useDebounced(search?.trim() ?? '', 300);
  const searching = search !== null && query.length > 0;

  const chats = useInfiniteQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'sessions', 'pages'],
    queryFn: ({ pageParam }) => listSessions(client, { limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length >= PAGE_SIZE ? all.length * PAGE_SIZE : undefined),
  });
  const results = useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'sessions', 'search', query],
    queryFn: async () => (await searchSessions(client, query, { limit: 50 })).sessions,
    enabled: searching,
  });

  // Fresh when the sidebar opens (a chat may have started or finished elsewhere).
  useEffect(() => {
    if (sidebar.isOpen) void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'sessions'] });
  }, [sidebar.isOpen, queryClient, session.baseUrl]);

  const rows = buildDtSidebarRows({
    shelf,
    search: { active: searching, results: results.data, loading: results.isFetching },
    sessions: chats.data?.pages.flat() ?? [],
    loading: chats.isLoading,
    failed: chats.isError,
  });

  const newChat = () => {
    sidebar.close();
    router.replace('/learn');
  };
  const openChat = (id: string) => {
    sidebar.close();
    if (id !== currentChatId) router.replace({ pathname: '/learn/[id]', params: { id } });
  };
  const openPage = (path: string, title: string) => {
    sidebar.close();
    if (path !== currentPagePath) router.replace({ pathname: '/learn/web', params: { path, title } });
  };
  // Native pages open the app's own screen; the rest, DeepTutor's page.
  const openShelfPage = (page: DtPage) => {
    if (!page.route) return openPage(page.path, page.label);
    sidebar.close();
    if (pathname !== page.route) router.replace(page.route);
  };
  const leaveIfCurrent = (id: string) => () => {
    if (id === currentChatId) router.replace('/learn');
  };

  const userMenu: MenuItem[] = [
    ...(session.account.isAdmin
      ? [
          {
            key: 'admin',
            label: DT_ADMIN_PAGE.label,
            icon: DT_ADMIN_PAGE.icon,
            onPress: () => {
              sidebar.close();
              if (pathname !== '/learn/admin') router.replace('/learn/admin');
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
        router.push('/learn/settings');
      },
    },
    {
      key: 'owui',
      label: owuiSignedIn ? 'Switch to Open WebUI' : 'Connect Open WebUI',
      icon: owuiSignedIn ? 'arrows-right-left' : 'chat-bubble-left-right',
      onPress: () => {
        sidebar.close();
        if (owuiSignedIn) switchToOpenWebUI();
        else router.replace('/login');
      },
    },
    {
      key: 'connection',
      label: 'Connection',
      icon: 'signal',
      onPress: () => {
        sidebar.close();
        router.push('/learn/connection');
      },
    },
    { key: 'signout', label: 'Sign Out', icon: 'arrow-right-start-on-rectangle', onPress: confirmSignOut },
  ];

  const renderRow = ({ item }: { item: DtSidebarRow }) => {
    switch (item.type) {
      case 'header':
        return <SidebarHeading label={item.label} />;
      case 'note':
        return <SidebarNote label={item.label} />;
      case 'page':
        return (
          <SidebarAction
            icon={item.page.icon}
            label={item.page.label}
            hint={item.page.route ? undefined : "Opens DeepTutor's page"}
            current={item.page.route ? pathname === item.page.route : item.page.path === currentPagePath}
            onPress={() => openShelfPage(item.page)}
          />
        );
      case 'learning-chat': {
        const title = sessionTitle(item.session);
        // A mastery path's chats and a book page's are native; the other learning chats open in DeepTutor's own pages.
        const native = opensNatively(item.session);
        return (
          <SidebarChatRow
            title={title}
            current={native ? item.session.id === currentChatId : item.path === currentPagePath}
            busy={item.session.status === 'running'}
            onOpen={() => (native ? openChat(item.session.id) : openPage(item.path, title))}
            menu={[
              { key: 'rename', label: 'Rename', icon: 'pencil', onPress: () => actions.rename(item.session.id, title) },
              { key: 'archive', label: 'Archive', icon: 'archive-box', onPress: () => actions.setArchived(item.session.id, true) },
              { key: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: () => actions.remove(item.session.id) },
            ]}
          />
        );
      }
      case 'chat': {
        const title = sessionTitle(item.session);
        const id = item.session.id;
        return (
          <SidebarChatRow
            title={title}
            current={id === currentChatId}
            busy={item.session.status === 'running'}
            pinned={item.pinned}
            mark={sessionStatusColor(board.data, id)}
            onOpen={() => openChat(id)}
            menu={[
              { key: 'rename', label: 'Rename', icon: 'pencil', onPress: () => actions.rename(id, title) },
              {
                key: 'pin',
                label: item.pinned ? 'Unpin' : 'Pin',
                icon: item.pinned ? 'bookmark-slash' : 'bookmark',
                onPress: () => actions.setPinned(id, !item.pinned),
              },
              { key: 'archive', label: 'Archive', icon: 'archive-box', onPress: () => actions.setArchived(id, true, leaveIfCurrent(id)) },
              { key: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: () => actions.remove(id, leaveIfCurrent(id)) },
            ]}
          />
        );
      }
    }
  };

  return (
    <SidebarPanel name="DeepTutor" onNewChat={newChat}>
      <SidebarAction icon="pencil-square" label="New Chat" onPress={newChat} />
      <SidebarSearch value={search} onChange={setSearch} placeholder="Search chats" />
      {search === null ? (
        <View style={styles.shelves} accessibilityRole="tablist">
          {shelves.map((item) => {
            const selected = item.key === shelf.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected }}
                onPress={() => setShelfKey(item.key)}
                style={({ pressed }) => [styles.shelf, (selected || pressed) && { backgroundColor: palette.sidebarActive }]}>
                <Icon name={item.icon} size={20} color={selected ? palette.text : palette.textMuted} strokeWidth={selected ? 1.8 : 1.5} />
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {search === null ? <SidebarHeading label={shelf.label} /> : null}

      <View style={[sidebarStyles.list, search === null && styles.listUnderShelf]}>
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
          onRefresh={() => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'sessions'] })}
          ListFooterComponent={chats.isFetchingNextPage ? <ActivityIndicator style={sidebarStyles.more} color={palette.textMuted} /> : null}
          contentContainerStyle={sidebarStyles.listContent}
        />
      </View>

      <SidebarUser name={session.account.username} menu={userMenu} />
    </SidebarPanel>
  );
}

const styles = StyleSheet.create({
  shelves: { flexDirection: 'row', justifyContent: 'space-between', gap: 4, marginTop: 6, paddingHorizontal: 2 },
  shelf: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  listUnderShelf: { marginTop: 0 },
});
