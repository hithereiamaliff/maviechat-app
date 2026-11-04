import { dataWithShare, deleteAdminGroup, getAdminGroup, removeGroupMembers, updateAdminGroup, withPermissions, type AdminGroup, type ShareWith } from '@maviechat/owui-protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { AddMembersSheet } from '@/features/admin/AdminSheets';
import { pendingEdits } from '@/features/admin/GroupsTabs';
import { confirmPermissionChanges, PermissionsEditor } from '@/features/admin/PermissionsEditor';
import { useAdminGroup, useAdminRefresh, useDefaultPermissions, useGroupMembers } from '@/features/admin/queries';
import { openUser } from '@/features/admin/UsersTab';
import { Note, SectionTitle } from '@/features/settings/rows';
import { Chip } from '@/features/workspace/ListControls';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

const SHARE: { key: ShareWith; label: string }[] = [
  { key: 'members', label: 'Its members' },
  { key: 'anyone', label: 'Anyone' },
  { key: 'nobody', label: 'Nobody' },
];

/**
 * One group, for admins: name, description and who may share things with it; its members (add
 * several, take one out); what it allows on top of everyone's defaults. Each part saves on its
 * own, built on what the server has at that moment.
 */
export default function AdminGroupScreen() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const group = useAdminGroup(id);
  const members = useGroupMembers(id);
  const refresh = useAdminRefresh();
  const [adding, setAdding] = useState(false);
  const data = group.data;

  const remove = () =>
    data &&
    Alert.alert(`Delete ${data.name}?`, 'Its members lose what it allowed them, and what was shared with the group no longer is. Nobody’s account goes.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteAdminGroup(client, data.id).then(
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
  const takeOut = (member: { id: string; name: string }) =>
    Alert.alert(`Take ${member.name} out of ${data?.name ?? 'the group'}?`, 'They lose what the group allowed them.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Take Out', style: 'destructive', onPress: () => void removeGroupMembers(client, id, [member.id]).then(refresh, (error: unknown) => toast(describeError(error), 'error')) },
    ]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <BackHeader title={data?.name ?? 'Group'} fallback="/admin" menu={data ? [{ key: 'delete', label: 'Delete Group…', icon: 'trash', destructive: true, onPress: remove }] : []} menuLabel="Group options" />
      {group.isError ? <Text style={[styles.note, styles.pad, { color: palette.danger }]}>{`Couldn’t open it: ${describeError(group.error)}`}</Text> : null}
      {!data ? (
        group.isLoading ? <ActivityIndicator style={styles.pad} color={palette.textMuted} /> : null
      ) : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />} keyboardShouldPersistTaps="handled">
          <About group={data} />
          <View style={styles.section}>
            <SectionTitle title={members.data ? `Members (${members.data.length})` : 'Members'} />
            {members.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
            {members.isError ? <Note>{`Couldn’t load them: ${describeError(members.error)}`}</Note> : null}
            {members.data && !members.data.length ? <Note>Nobody yet.</Note> : null}
            {(members.data ?? []).map((member) => (
              <View key={member.id} style={[styles.member, { borderColor: palette.border }]}>
                <Pressable accessibilityRole="button" onPress={() => openUser(member.id)} style={styles.flex}>
                  <Text style={[styles.value, { color: palette.text }]} numberOfLines={1}>
                    {member.name || member.email}
                  </Text>
                  <Text style={[styles.note, { color: palette.textMuted }]} numberOfLines={1}>
                    {member.email}
                  </Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Take ${member.name} out`} onPress={() => takeOut(member)} hitSlop={8}>
                  <Icon name="x-mark" size={16} color={palette.textMuted} />
                </Pressable>
              </View>
            ))}
            <View style={styles.start}>
              <Button label="Add People" variant="secondary" onPress={() => setAdding(true)} />
            </View>
          </View>
          <GroupPermissions group={data} />
        </ScrollView>
      )}
      <AddMembersSheet groupId={id} memberIds={(members.data ?? []).map((member) => member.id)} visible={adding} onClose={() => setAdding(false)} />
    </View>
  );
}

function About({ group }: { group: AdminGroup }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const refresh = useAdminRefresh();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [shareWith, setShareWith] = useState(group.shareWith);
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== group.name || description.trim() !== group.description || shareWith !== group.shareWith;
  const save = async () => {
    setBusy(true);
    try {
      const fresh = await getAdminGroup(client, group.id);
      await updateAdminGroup(client, fresh, { name, description, ...(shareWith !== fresh.shareWith ? { data: dataWithShare(fresh.data, shareWith) } : {}) });
      refresh();
      toast('Saved');
    } catch (error) {
      toast(`Couldn’t save: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const input = [styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];
  return (
    <View style={styles.section}>
      <SectionTitle title="About" />
      <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={palette.textFaint} accessibilityLabel="Name" style={input} />
      <TextInput value={description} onChangeText={setDescription} multiline placeholder="Description" placeholderTextColor={palette.textFaint} accessibilityLabel="Description" style={input} />
      <Text style={[styles.label, { color: palette.text }]}>Who can share things with this group</Text>
      <View style={styles.chips}>
        {SHARE.map((item) => (
          <Chip key={item.key} label={item.label} on={shareWith === item.key} onPress={() => setShareWith(item.key)} />
        ))}
      </View>
      {changed ? (
        <View style={styles.start}>
          <Button label="Save" onPress={() => void save()} loading={busy} disabled={!name.trim()} />
        </View>
      ) : null}
    </View>
  );
}

function GroupPermissions({ group }: { group: AdminGroup }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const defaults = useDefaultPermissions();
  const refresh = useAdminRefresh();
  const [edits, setEdits] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const stored = group.permissions ?? {};
  const tree = withPermissions(stored, edits);
  const changes = pendingEdits(stored, edits);
  const save = () =>
    confirmPermissionChanges(changes, tree, group.name, () => {
      void (async () => {
        setBusy(true);
        try {
          // Laid over the group's tree as stored now: switches it never set stay unset.
          const fresh = await getAdminGroup(client, group.id);
          await updateAdminGroup(client, fresh, { permissions: withPermissions(fresh.permissions, Object.fromEntries(changes.map((path) => [path, edits[path] === true]))) });
          setEdits({});
          refresh();
          toast('Saved');
        } catch (error) {
          toast(`Couldn’t save: ${describeError(error)}`, 'error');
        } finally {
          setBusy(false);
        }
      })();
    });
  return (
    <View style={styles.section}>
      <SectionTitle title="What it allows" />
      <View style={styles.bar}>
        <Text style={[styles.note, styles.flex, { color: changes.length ? palette.text : palette.textMuted }]}>{changes.length ? `${changes.length} not saved` : 'On top of everyone’s defaults'}</Text>
        {changes.length ? (
          <Pressable accessibilityRole="button" onPress={() => setEdits({})} hitSlop={8}>
            <Text style={[styles.note, { color: palette.link }]}>Undo</Text>
          </Pressable>
        ) : null}
        <View>
          <Button label="Save" onPress={save} disabled={!changes.length} loading={busy} />
        </View>
      </View>
      {defaults.data ? <PermissionsEditor tree={tree} defaults={defaults.data} onChange={(path, on) => setEdits({ ...edits, [path]: on })} plugins={capabilities?.feature('tools') ?? false} /> : <ActivityIndicator color={palette.textMuted} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { padding: 16 },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  section: { gap: 8 },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  start: { alignSelf: 'flex-start' },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  label: { fontFamily: fonts.medium, fontSize: 14, marginTop: 4 },
  value: { fontFamily: fonts.medium, fontSize: 15 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
