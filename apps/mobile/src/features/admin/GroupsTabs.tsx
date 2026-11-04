import { getDefaultPermissions, getStockPermissions, permissionChanges, saveDefaultPermissions, withPermissions, type PermissionTree } from '@maviechat/owui-protocol';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { Note } from '@/features/settings/rows';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import { NewGroupSheet } from './AdminSheets';
import { confirmPermissionChanges, PermissionsEditor } from './PermissionsEditor';
import { useAdminGroups, useAdminRefresh, useDefaultPermissions } from './queries';

export const openGroup = (id: string) => router.push({ pathname: '/admin/group', params: { id } });

/** Admin → Groups: each with how many are in it; a new one starts from today's defaults. */
export function GroupsTab({ tabs }: { tabs: ReactNode }) {
  const palette = usePalette();
  const groups = useAdminGroups();
  const refresh = useAdminRefresh();
  const [making, setMaking] = useState(false);
  const items = [...(groups.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
      {tabs}
      <View style={styles.row}>
        <Text style={[styles.lead, { color: palette.textMuted }]}>Groups add permissions to their members, and things can be shared with a whole group.</Text>
        <View>
          <Button label="New" onPress={() => setMaking(true)} />
        </View>
      </View>
      {groups.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {groups.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load the groups: ${describeError(groups.error)}`}</Text> : null}
      {groups.data && !items.length ? <Text style={[styles.note, styles.center, { color: palette.textMuted }]}>No groups yet.</Text> : null}
      {items.map((group) => (
        <Pressable key={group.id} accessibilityRole="button" onPress={() => openGroup(group.id)} style={({ pressed }) => [styles.item, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
          <Icon name="user-group" size={20} color={palette.textMuted} />
          <View style={styles.text}>
            <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
              {group.name}
            </Text>
            {group.description ? (
              <Text style={[styles.note, { color: palette.textMuted }]} numberOfLines={2}>
                {group.description}
              </Text>
            ) : null}
            <Text style={[styles.meta, { color: palette.textFaint }]}>{group.memberCount === null ? '' : `${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}`}</Text>
          </View>
          <Icon name="chevron-right" size={14} color={palette.textFaint} />
        </Pressable>
      ))}
      <NewGroupSheet visible={making} onClose={() => setMaking(false)} onMade={openGroup} />
    </ScrollView>
  );
}

/** Admin → Default permissions: what everyone has. Saved with Save, after a list of what changes. */
export function DefaultsTab({ tabs }: { tabs: ReactNode }) {
  const palette = usePalette();
  const defaults = useDefaultPermissions();
  const refresh = useAdminRefresh();
  return (
    <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
      {tabs}
      {defaults.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {defaults.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load them: ${describeError(defaults.error)}`}</Text> : null}
      {defaults.data ? <DefaultsForm saved={defaults.data} /> : null}
    </ScrollView>
  );
}

/** The switches the admin changed (`section.key` → on), laid over what the server has. */
type Edits = Record<string, boolean>;

/** Only the edits that still differ from what's saved: what a save would change. */
export const pendingEdits = (saved: PermissionTree | null, edits: Edits): string[] => permissionChanges(saved, withPermissions(saved, edits));

function DefaultsForm({ saved }: { saved: PermissionTree }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const refresh = useAdminRefresh();
  const [edits, setEdits] = useState<Edits>({});
  const [busy, setBusy] = useState(false);
  const tree = withPermissions(saved, edits);
  const changes = pendingEdits(saved, edits);

  const save = () =>
    confirmPermissionChanges(changes, tree, 'everyone’s permissions', () => {
      void (async () => {
        setBusy(true);
        try {
          // Laid over what the server has now: a switch changed elsewhere meanwhile stays as it is.
          const fresh = await getDefaultPermissions(client);
          await saveDefaultPermissions(client, withPermissions(fresh, Object.fromEntries(changes.map((path) => [path, edits[path] === true]))));
          setEdits({});
          refresh();
          toast('Saved for everyone');
        } catch (error) {
          toast(`Couldn’t save: ${describeError(error)}`, 'error');
        } finally {
          setBusy(false);
        }
      })();
    });
  const reset = () =>
    Alert.alert('Start from the server’s own defaults?', 'The switches change here; nothing is saved until you save.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Load Them',
        onPress: () =>
          void getStockPermissions(client).then(
            (stock) => setEdits(Object.fromEntries(permissionChanges(saved, stock).map((path) => [path, stock[path.split('.')[0] ?? '']?.[path.split('.')[1] ?? ''] === true]))),
            (error: unknown) => toast(describeError(error), 'error'),
          ),
      },
    ]);

  return (
    <View style={styles.form}>
      <Note>What everyone has, admins aside. Groups can only add to it.</Note>
      <View style={styles.bar}>
        <Text style={[styles.note, styles.flex, { color: changes.length ? palette.text : palette.textMuted }]}>{changes.length ? `${changes.length} not saved` : 'Nothing changed'}</Text>
        <Pressable accessibilityRole="button" onPress={reset} hitSlop={8}>
          <Text style={[styles.note, { color: palette.link }]}>Server Defaults</Text>
        </Pressable>
        {changes.length ? (
          <Pressable accessibilityRole="button" onPress={() => setEdits({})} hitSlop={8}>
            <Text style={[styles.note, { color: palette.link }]}>Undo</Text>
          </Pressable>
        ) : null}
        <View>
          <Button label="Save" onPress={save} disabled={!changes.length} loading={busy} />
        </View>
      </View>
      <PermissionsEditor tree={tree} onChange={(path, on) => setEdits({ ...edits, [path]: on })} plugins={capabilities?.feature('plugins') ?? false} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10, paddingBottom: 48 },
  form: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  flex: { flex: 1 },
  lead: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  center: { textAlign: 'center' },
});
