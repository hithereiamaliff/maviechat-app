import type { DtAdminUser } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { AddUserSheet } from '@/features/deeptutor/admin/AddUserSheet';
import { initials, PRESET_NAMES, useAdminUsers } from '@/features/deeptutor/admin/queries';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/**
 * DeepTutor's users, for admins, as its User Management page lists them: search, each account's
 * role and kind and when it joined, and adding one. Importing many at once and choosing what each
 * is given stay on DeepTutor's page.
 */
export default function Users() {
  const palette = usePalette();
  const { session } = useDtAuthed();
  const users = useAdminUsers();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const all = users.data ?? [];
  const needle = query.trim().toLowerCase();
  const shown = needle ? all.filter((user) => user.username.toLowerCase().includes(needle)) : all;
  const openWeb = () => router.push({ pathname: '/learn/web', params: { path: '/admin/users', title: 'User Management' } });

  if (!session.account.isAdmin)
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <DtHeader title="Users" />
        <Text style={[styles.empty, { color: palette.textMuted }]}>Only DeepTutor’s admins manage users.</Text>
      </View>
    );

  const row = (user: DtAdminUser) => (
    <Pressable
      key={user.username}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/learn/admin/user', params: { username: user.username } })}
      style={({ pressed }) => [styles.row, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : 'transparent' }]}>
      <View style={[styles.avatar, { backgroundColor: user.isAdmin ? palette.active : palette.surfaceStrong }]}>
        <Text style={[styles.initials, { color: user.isAdmin ? palette.onActive : palette.text }]}>{initials(user.username)}</Text>
      </View>
      <View style={styles.text}>
        <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
          {user.username === session.account.username ? `${user.username} (you)` : user.username}
        </Text>
        <Text style={[styles.detail, { color: palette.textMuted }]} numberOfLines={1}>
          {[user.isAdmin ? 'Admin' : `${PRESET_NAMES[user.preset] ?? 'Ordinary'} account`, user.createdAt ? `joined ${new Date(user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : '', user.mustChangePassword ? 'to change their password' : ''].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Icon name="chevron-right" size={14} color={palette.textFaint} />
    </Pressable>
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Users" menu={[{ key: 'web', label: 'User Management on the Web', icon: 'globe-alt', onPress: openWeb }]} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={() => void users.refetch()} />}>
        <Button label="Add a User" onPress={() => setAdding(true)} />
        <Text style={[styles.note, { color: palette.textFaint }]}>Importing many at once, and choosing each account’s models, knowledge, tools and books, are on DeepTutor’s page.</Text>
        {all.length ? (
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${all.length} ${all.length === 1 ? 'user' : 'users'}`}
            placeholderTextColor={palette.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search users"
            style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
        ) : null}
        {users.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {users.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load the users: ${describeError(users.error)}`}</Text> : null}
        {needle && !shown.length ? <Text style={[styles.note, styles.center, { color: palette.textMuted }]}>{`No user matches “${query.trim()}”.`}</Text> : null}
        {shown.map(row)}
      </ScrollView>
      <AddUserSheet visible={adding} onClose={() => setAdding(false)} onAdded={() => void users.refetch()} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  center: { textAlign: 'center' },
  search: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: fonts.semibold, fontSize: 14 },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  detail: { fontFamily: fonts.regular, fontSize: 12 },
});
