import { addUser, deleteUser, recentlyActive, updateUser, usersFromCsv, type AdminUser, type CsvUser, type UserOrder } from '@maviechat/owui-protocol';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { pickTextFile, plural } from '@/features/workspace/EditorParts';
import { Chip } from '@/features/workspace/ListControls';
import { eachFew, failures } from '@/lib/eachFew';
import { describeError } from '@/lib/errors';
import { useAuthed, useSessionUser } from '@/lib/server';
import { useDebounced } from '@/lib/useDebounced';
import { fonts, radius, usePalette } from '@/theme';
import { AddUserSheet, ROLE_LABELS } from './AdminSheets';
import { agoLabel, initialsOf, useAdminRefresh, useAdminUsers, useAllUsers, usePrimaryAdminId } from './queries';

const ORDERS: { key: UserOrder; label: string; direction: 'asc' | 'desc' }[] = [
  { key: 'created_at', label: 'Joined', direction: 'asc' },
  { key: 'name', label: 'Name', direction: 'asc' },
  { key: 'last_active_at', label: 'Last active', direction: 'desc' },
  { key: 'role', label: 'Role', direction: 'asc' },
];

export const openUser = (id: string) => router.push({ pathname: '/admin/user', params: { id } });

/** A user's picture, or their initials. */
export function UserPicture({ user, size, baseUrl }: { user: Pick<AdminUser, 'name' | 'profileImageUrl'>; size: number; baseUrl: string }) {
  const palette = usePalette();
  const url = user.profileImageUrl;
  if (url && url !== '/user.png') {
    return <Image source={{ uri: url.startsWith('data:') || /^https?:/.test(url) ? url : `${baseUrl}${url}` }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.initials, { width: size, height: size, borderRadius: size / 2, backgroundColor: palette.surfaceStrong }]}>
      <Text style={[styles.initialsText, { color: palette.text, fontSize: size * 0.38 }]}>{initialsOf(user.name)}</Text>
    </View>
  );
}

/** Admin → Users: search, order, who's waiting for approval (approve at once), add, and each user's page. */
export function UsersTab({ tabs }: { tabs: ReactNode }) {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useAuthed();
  const me = useSessionUser();
  const primary = usePrimaryAdminId();
  const refresh = useAdminRefresh();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const [order, setOrder] = useState(ORDERS[0] ?? { key: 'created_at' as const, label: 'Joined', direction: 'asc' as const });
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const users = useAdminUsers({ query: debounced, orderBy: order.key, direction: order.direction });
  const everyone = useAllUsers();
  const pending = (everyone.data ?? []).filter((user) => user.role === 'pending');
  const items = users.data?.pages.flatMap((page) => page.items) ?? [];
  // Captured once per render for the "active" dots and "last active" labels.
  const [now] = useState(() => new Date().getTime());

  // The web's CSV Import: a header row, then Name, Email, Password, Role; each row added as an account.
  const runImport = async (rows: CsvUser[]) => {
    setImporting(true);
    const failed = await eachFew(rows, (row) => addUser(client, { name: row.name, email: row.email, password: row.password, role: row.role }), (row) => `Row ${row.line}`);
    setImporting(false);
    refresh();
    if (!failed.length) toast(`Added ${plural(rows.length, 'account')}`);
    else toast(`Added ${rows.length - failed.length} of ${rows.length}. ${failures(failed)}`, 'error');
  };
  const importCsv = async () => {
    let found: ReturnType<typeof usersFromCsv>;
    try {
      const file = await pickTextFile(['text/csv', 'text/comma-separated-values', 'application/csv']);
      if (!file) return;
      found = usersFromCsv(file.text);
    } catch (error) {
      return toast(`Couldn’t read the file: ${describeError(error)}`, 'error');
    }
    const shape = 'Name, Email, Password, Role (admin, user or pending)';
    if (!found.users.length) {
      return toast(found.problems.length ? `No row could be read: each needs ${shape}, after a header row.` : 'There are no accounts in the file.', 'error');
    }
    const admins = found.users.filter((row) => row.role === 'admin').length;
    Alert.alert(
      `Add ${plural(found.users.length, 'account')}?`,
      [
        admins ? `${admins === found.users.length ? 'All' : admins} of them as admins, who can change everything on this server.` : '',
        found.problems.length ? `Left out: ${found.problems.length === 1 ? 'row' : 'rows'} ${found.problems.join(', ')} (each needs ${shape}).` : '',
        'Each gets the password in the file: pass them on safely.',
      ]
        .filter(Boolean)
        .join(' '),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add', style: admins ? 'destructive' : 'default', onPress: () => void runImport(found.users) },
      ],
    );
  };

  const setRole = (user: { id: string; name: string }, role: 'admin' | 'user' | 'pending') => {
    const go = () =>
      void updateUser(client, user.id, { role }).then(
        () => {
          refresh();
          toast(role === 'user' ? `${user.name} can use the server` : role === 'admin' ? `${user.name} is an admin` : `${user.name} waits for approval`);
        },
        (error: unknown) => toast(describeError(error), 'error'),
      );
    if (role === 'admin') Alert.alert(`Make ${user.name} an admin?`, 'Admins can change everything on this server, including its settings and other people’s accounts.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Make Admin', onPress: go }]);
    else go();
  };
  const remove = (user: AdminUser) =>
    Alert.alert(`Delete ${user.name}?`, 'Their account and all their chats go for good. Files, knowledge, models and tools they made stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteUser(client, user.id).then(
            () => {
              refresh();
              toast(`${user.name} deleted`);
            },
            (error: unknown) => toast(describeError(error), 'error'),
          ),
      },
    ]);
  const menuFor = (user: AdminUser): MenuItem[] => {
    const self = user.id === me.data?.id;
    const isPrimary = user.id === primary.data;
    const locked = isPrimary && !self;
    return [
      { key: 'open', label: 'Open', icon: 'user-circle', onPress: () => openUser(user.id) },
      ...(!locked && user.role === 'pending' ? [{ key: 'approve', label: 'Approve', icon: 'check' as const, onPress: () => setRole(user, 'user') }] : []),
      ...(!locked && !self && user.role !== 'admin' ? [{ key: 'admin', label: 'Make Admin', icon: 'shield-check' as const, onPress: () => setRole(user, 'admin') }] : []),
      ...(!locked && !self && user.role === 'admin' && !isPrimary ? [{ key: 'user', label: 'Make Ordinary User', icon: 'user-circle' as const, onPress: () => setRole(user, 'user') }] : []),
      ...(!self && !isPrimary ? [{ key: 'delete', label: 'Delete…', icon: 'trash' as const, destructive: true, onPress: () => remove(user) }] : []),
    ];
  };

  const header = (
    <View style={styles.top}>
      {tabs}
      {pending.length ? (
        <View style={[styles.pending, { borderColor: palette.border, backgroundColor: palette.surface }]}>
          <Text style={[styles.pendingTitle, { color: palette.text }]}>{`${pending.length} waiting for approval`}</Text>
          {pending.slice(0, 5).map((user) => (
            <View key={user.id} style={styles.pendingRow}>
              <Pressable accessibilityRole="button" onPress={() => openUser(user.id)} style={styles.flex}>
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                  {user.name || user.email}
                </Text>
                <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                  {user.email}
                </Text>
              </Pressable>
              <View>
                <Button label="Approve" onPress={() => setRole(user, 'user')} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.row}>
        <TextInput value={query} onChangeText={setQuery} placeholder="Search by name or email" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search users" style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        <View>
          <Button label="Add" onPress={() => setAdding(true)} />
        </View>
        <MenuButton
          label="More ways to add"
          color={palette.textMuted}
          items={[{ key: 'csv', label: importing ? 'Importing…' : 'Import from CSV…', icon: 'arrow-up-tray', onPress: () => void (importing ? undefined : importCsv()) }]}
        />
      </View>
      <View style={styles.chips}>
        {ORDERS.map((item) => (
          <Chip key={item.key} label={item.label} on={order.key === item.key} onPress={() => setOrder(item)} />
        ))}
      </View>
      {users.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {users.isError ? <Text style={[styles.meta, { color: palette.danger }]}>{`Couldn’t load the users: ${describeError(users.error)}`}</Text> : null}
      {users.data && !items.length ? <Text style={[styles.meta, styles.center, { color: palette.textMuted }]}>Nobody matches.</Text> : null}
    </View>
  );

  return (
    <View style={styles.flex}>
      <FlatList
        data={items}
        keyExtractor={(user) => user.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (users.hasNextPage && !users.isFetchingNextPage) void users.fetchNextPage();
        }}
        refreshing={false}
        onRefresh={refresh}
        ListFooterComponent={users.isFetchingNextPage ? <ActivityIndicator color={palette.textMuted} /> : undefined}
        renderItem={({ item: user }) => (
          <Pressable accessibilityRole="button" onPress={() => openUser(user.id)} style={({ pressed }) => [styles.item, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <View>
              <UserPicture user={user} size={40} baseUrl={session.baseUrl} />
              {recentlyActive(user.lastActiveAt, now) ? <View accessibilityLabel="Active now" style={[styles.dot, { backgroundColor: palette.success, borderColor: palette.background }]} /> : null}
            </View>
            <View style={styles.text}>
              <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                {user.id === me.data?.id ? `${user.name} (you)` : user.name}
              </Text>
              <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                {user.email}
              </Text>
              <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
                {[user.id === primary.data ? 'Primary admin' : ROLE_LABELS[user.role] ?? user.role, `active ${agoLabel(user.lastActiveAt, now)}`].join(' · ')}
              </Text>
            </View>
            <MenuButton label={`Options for ${user.name}`} size={18} color={palette.textMuted} items={menuFor(user)} />
          </Pressable>
        )}
      />
      <AddUserSheet visible={adding} onClose={() => setAdding(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { gap: 10, paddingBottom: 6 },
  list: { padding: 16, gap: 8, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  search: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pending: { gap: 10, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  pendingTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  center: { textAlign: 'center' },
  initials: { alignItems: 'center', justifyContent: 'center' },
  initialsText: { fontFamily: fonts.semibold },
  dot: { position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
});
