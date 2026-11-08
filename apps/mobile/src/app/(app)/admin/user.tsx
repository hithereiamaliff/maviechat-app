import { deleteUser, effectivePermissions, PERMISSION_SECTIONS, recentlyActive, roleChangeProblem, updateUser, USER_ROLES, type UserRole } from '@maviechat/owui-protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { EditUserSheet, ROLE_LABELS } from '@/features/admin/AdminSheets';
import { openGroup } from '@/features/admin/GroupsTabs';
import { agoLabel, useAdminGroups, useAdminRefresh, useAdminUser, useDefaultPermissions, usePrimaryAdminId, useUserAccess } from '@/features/admin/queries';
import { UserPicture } from '@/features/admin/UsersTab';
import { ActionRow, Group, Note, SectionTitle } from '@/features/settings/rows';
import { Chip } from '@/features/workspace/ListControls';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useSessionUser } from '@/lib/server';
import { fonts, usePalette } from '@/theme';

/**
 * One user, for admins: who they are, their role (approve, make admin, back to waiting), their
 * groups, what they can reach and may do, editing their name, email or password, and deleting
 * them. The primary admin can only be changed by themselves; nobody demotes or deletes themselves here.
 */
export default function AdminUserScreen() {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useAuthed();
  const capabilities = useCapabilities();
  const me = useSessionUser();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const user = useAdminUser(id);
  const access = useUserAccess(id);
  const groups = useAdminGroups();
  const defaults = useDefaultPermissions();
  const primary = usePrimaryAdminId();
  const refresh = useAdminRefresh();
  const [editing, setEditing] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [now] = useState(() => new Date().getTime());
  const data = user.data;
  const self = data?.id === me.data?.id;
  const isPrimary = data?.id === primary.data;
  const locked = isPrimary && !self;

  const setRole = (role: UserRole) => {
    if (!data || !me.data || role === data.role) return;
    const problem = roleChangeProblem(data, me.data, role);
    if (problem) return toast(problem, 'error');
    const go = () =>
      void updateUser(client, data.id, { role }).then(
        () => {
          refresh();
          toast(`${data.name} is now ${ROLE_LABELS[role]?.toLowerCase() ?? role}`);
        },
        (error: unknown) => toast(describeError(error), 'error'),
      );
    if (role === 'admin') Alert.alert(`Make ${data.name} an admin?`, 'Admins can change everything on this server, including its settings and other people’s accounts.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Make Admin', onPress: go }]);
    else if (role === 'pending') Alert.alert(`Put ${data.name} back to waiting?`, 'They’ll see only a waiting screen until someone approves them again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Back to Waiting', style: 'destructive', onPress: go }]);
    else go();
  };
  const remove = () =>
    data &&
    Alert.alert(`Delete ${data.name}?`, 'Their account and all their chats go for good. Files, knowledge, models and tools they made stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteUser(client, data.id).then(
            () => {
              refresh();
              toast(`${data.name} deleted`);
              if (router.canGoBack()) router.back();
              else router.replace('/admin');
            },
            (error: unknown) => toast(describeError(error), 'error'),
          ),
      },
    ]);
  const menu: MenuItem[] = data && !locked ? [{ key: 'edit', label: 'Edit…', icon: 'pencil-square', onPress: () => setEditing(true) }, ...(!self && !isPrimary ? [{ key: 'delete', label: 'Delete…', icon: 'trash' as const, destructive: true, onPress: remove }] : [])] : [];

  // What they may do: everyone's defaults, plus what each of their groups adds (admins: everything).
  const theirGroups = (groups.data ?? []).filter((group) => data?.groupIds.includes(group.id));
  const effective = defaults.data ? effectivePermissions(defaults.data, theirGroups.map((group) => group.permissions)) : null;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <BackHeader title={data?.name ?? 'User'} fallback="/admin" menu={menu} menuLabel="User options" />
      {user.isError ? <Text style={[styles.note, styles.pad, { color: palette.danger }]}>{`Couldn’t open them: ${describeError(user.error)}`}</Text> : null}
      {!data ? (
        user.isLoading ? <ActivityIndicator style={styles.pad} color={palette.textMuted} /> : null
      ) : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
          <View style={styles.identity}>
            <UserPicture user={data} size={64} baseUrl={session.baseUrl} />
            <View style={styles.flex}>
              <Text style={[styles.name, { color: palette.text }]}>{self ? `${data.name} (you)` : data.name}</Text>
              <Text style={[styles.note, { color: palette.textMuted }]}>{data.email}</Text>
              <Text style={[styles.note, { color: palette.textFaint }]}>{[isPrimary ? 'Primary admin' : '', recentlyActive(data.lastActiveAt, now) || data.active ? 'Active now' : `Active ${agoLabel(data.lastActiveAt, now)}`, data.createdAt ? `joined ${new Date(data.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''].filter(Boolean).join(' · ')}</Text>
            </View>
          </View>
          <View style={styles.section}>
            <SectionTitle title="Role" />
            <View style={styles.chips}>
              {USER_ROLES.map((role) => (
                <Chip key={role} label={ROLE_LABELS[role] ?? role} on={data.role === role} onPress={() => (locked ? toast('Only the primary admin can change their own account.', 'error') : setRole(role))} />
              ))}
            </View>
            {locked ? <Note>This is the primary admin: only they can change their account.</Note> : self && data.role === 'admin' ? <Note>Another admin can change your role; you can’t remove your own admin role here.</Note> : null}
          </View>
          {/* The web's Chats, for a user's chats where the server lets admins see them (never another admin's). */}
          {capabilities?.feature('adminChatAccess') && data.role !== 'admin' ? (
            <View style={styles.section}>
              <SectionTitle title="Chats" />
              <Group>
                <ActionRow label={`${data.name}’s chats`} hint="Read them, or delete one" onPress={() => router.push({ pathname: '/admin/user-chats', params: { id: data.id, name: data.name } })} />
              </Group>
            </View>
          ) : null}
          <View style={styles.section}>
            <SectionTitle title="Groups" />
            {data.groups.length ? (
              data.groups.map((group) => (
                <Pressable key={group.id} accessibilityRole="button" onPress={() => openGroup(group.id)} style={styles.line}>
                  <Text style={[styles.value, { color: palette.link }]}>{group.name}</Text>
                </Pressable>
              ))
            ) : (
              <Note>In no groups.</Note>
            )}
          </View>
          {Object.keys(data.oauth).length ? (
            <View style={styles.section}>
              <SectionTitle title="Signs in with" />
              <Note>{Object.keys(data.oauth).join(', ')}</Note>
            </View>
          ) : null}
          <View style={styles.section}>
            <SectionTitle title="Can use" />
            {access.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
            {access.data ? (
              (['models', 'knowledge', 'tools'] as const).map((kind) => {
                const reach = access.data[kind];
                return (
                  <Text key={kind} style={[styles.body, { color: palette.text }]}>
                    {`${kind === 'models' ? 'Models' : kind === 'knowledge' ? 'Knowledge' : 'Tools'}: ${data.role === 'admin' ? 'all' : `${reach.items.length} of ${reach.total}`}${data.role !== 'admin' && reach.items.length ? ` (${reach.items.slice(0, 6).map((item) => item.name).join(', ')}${reach.items.length > 6 ? '…' : ''})` : ''}`}
                  </Text>
                );
              })
            ) : access.isError ? (
              <Note>{`Couldn’t work it out: ${describeError(access.error)}`}</Note>
            ) : null}
          </View>
          <View style={styles.section}>
            <SectionTitle title="May do" />
            {data.role === 'admin' ? (
              <Note>Admins may do everything.</Note>
            ) : effective ? (
              <>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPermissions }} onPress={() => setShowPermissions(!showPermissions)} style={styles.line}>
                  <Text style={[styles.value, { color: palette.link }]}>{showPermissions ? 'Hide' : 'Show what’s on for them'}</Text>
                </Pressable>
                {showPermissions
                  ? PERMISSION_SECTIONS.map((section) => {
                      const on = section.items.filter((item) => (!item.plugins || capabilities?.feature('tools')) && effective[section.key]?.[item.key] === true);
                      return (
                        <Text key={section.key} style={[styles.body, { color: palette.text }]}>
                          <Text style={styles.strong}>{`${section.label}: `}</Text>
                          {on.length ? on.map((item) => item.label).join(', ') : 'nothing'}
                        </Text>
                      );
                    })
                  : null}
                <Note>Everyone’s defaults, plus whatever their groups add.</Note>
              </>
            ) : null}
          </View>
        </ScrollView>
      )}
      <EditUserSheet user={editing && data ? data : null} onClose={() => setEditing(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { padding: 16 },
  content: { padding: 16, gap: 8, paddingBottom: 48 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  flex: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 18 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  strong: { fontFamily: fonts.semibold },
  body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginLeft: 4 },
  value: { fontFamily: fonts.medium, fontSize: 14 },
  line: { paddingVertical: 4, marginLeft: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginLeft: 4 },
  section: { gap: 6 },
});
