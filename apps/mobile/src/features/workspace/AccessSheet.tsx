import { accessRights, accessStateOf, droppedGrants, getUserInfo, grantsFromState, listShareGroups, searchUsers, updateAccess, type AccessArea, type AccessGrant, type AccessState } from '@maviechat/owui-protocol';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useDebounced } from '@/lib/useDebounced';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

export interface AccessTarget {
  area: AccessArea;
  id: string;
  name: string;
  grants: AccessGrant[];
}

/**
 * Who may use a Workspace item, and who may change it: everyone signed in, or the people and
 * groups listed (each to use, or to change too). Saved at once, as the web's access button does;
 * what this account may not grant the server drops, and the sheet says so.
 */
export function AccessSheet({ target, onClose, onSaved }: { target: AccessTarget | null; onClose: () => void; onSaved: () => void }) {
  const palette = usePalette();
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target ? <Editor key={`${target.area}:${target.id}`} target={target} onClose={onClose} onSaved={onSaved} /> : <View style={{ backgroundColor: palette.background }} />}
    </Modal>
  );
}

function Editor({ target, onClose, onSaved }: { target: AccessTarget; onClose: () => void; onSaved: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const rights = capabilities ? accessRights(capabilities, target.area) : { list: false, everyone: false, people: false, groups: false };
  const [state, setState] = useState<AccessState>(() => accessStateOf(target.grants));
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const [busy, setBusy] = useState(false);
  const groups = useQuery({ queryKey: ['share-groups'], queryFn: () => listShareGroups(client), enabled: rights.groups || state.entries.some((entry) => entry.type === 'group'), staleTime: 60_000 });
  const found = useQuery({ queryKey: ['user-search', debounced], queryFn: () => searchUsers(client, debounced), enabled: rights.people && debounced.length > 0 });
  const userIds = state.entries.filter((entry) => entry.type === 'user').map((entry) => entry.id);
  const users = useQueries({ queries: userIds.map((id) => ({ queryKey: ['user-info', id], queryFn: () => getUserInfo(client, id), staleTime: 5 * 60_000 })) });
  const nameOf = (type: 'user' | 'group', id: string) => (type === 'group' ? groups.data?.find((group) => group.id === id)?.name : users[userIds.indexOf(id)]?.data?.name) ?? id;
  const listed = (type: 'user' | 'group', id: string) => state.entries.some((entry) => entry.type === type && entry.id === id);
  const add = (type: 'user' | 'group', id: string) => {
    if (!listed(type, id)) setState({ ...state, entries: [...state.entries, { type, id, write: false }] });
  };
  const everyoneShown = rights.everyone || state.everyone !== 'none';

  const save = async () => {
    setBusy(true);
    try {
      const sent = grantsFromState(state);
      const kept = await updateAccess(client, target.area, target.id, sent);
      onSaved();
      toast(droppedGrants(sent, kept).length ? 'Saved, but some of it wasn’t kept: your account may not share that way.' : 'Sharing saved', droppedGrants(sent, kept).length ? 'error' : undefined);
      onClose();
    } catch (error) {
      toast(`Couldn’t save it: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
          {`Share ${target.name}`}
        </Text>
        {busy ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : (
          <Pressable accessibilityRole="button" onPress={() => void save()} hitSlop={10}>
            <Text style={[styles.action, styles.strong, { color: palette.link }]}>Save</Text>
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {everyoneShown ? (
          <View style={[styles.box, { borderColor: palette.border }]}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={[styles.label, { color: palette.text }]}>Everyone signed in</Text>
                <Text style={[styles.note, { color: palette.textMuted }]}>{state.everyone === 'none' ? 'Off: only you, admins and those listed.' : 'Everyone on this server may use it.'}</Text>
              </View>
              <Switch accessibilityLabel="Everyone signed in" value={state.everyone !== 'none'} disabled={!rights.everyone && state.everyone === 'none'} onValueChange={(on) => setState({ ...state, everyone: on ? 'read' : 'none' })} />
            </View>
            {state.everyone !== 'none' ? (
              <View style={styles.row}>
                <Text style={[styles.label, styles.flex, { color: palette.text }]}>Everyone may change it too</Text>
                <Switch accessibilityLabel="Everyone may change it too" value={state.everyone === 'write'} onValueChange={(on) => setState({ ...state, everyone: on ? 'write' : 'read' })} />
              </View>
            ) : null}
          </View>
        ) : null}
        {rights.list || state.entries.length ? (
          <>
            <Text style={[styles.section, { color: palette.textMuted }]}>People and groups</Text>
            {!state.entries.length ? <Text style={[styles.note, { color: palette.textFaint }]}>Nobody listed.</Text> : null}
            {state.entries.map((entry) => (
              <View key={`${entry.type}:${entry.id}`} style={[styles.row, styles.entry, { borderColor: palette.border }]}>
                <Icon name={entry.type === 'group' ? 'users' : 'user-circle'} size={16} color={palette.textMuted} />
                <Text style={[styles.label, styles.flex, { color: palette.text }]} numberOfLines={1}>
                  {nameOf(entry.type, entry.id)}
                </Text>
                <Text style={[styles.note, { color: palette.textMuted }]}>Can change</Text>
                <Switch accessibilityLabel={`${nameOf(entry.type, entry.id)} can change it`} value={entry.write} onValueChange={(write) => setState({ ...state, entries: state.entries.map((item) => (item === entry ? { ...item, write } : item)) })} />
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${nameOf(entry.type, entry.id)}`} onPress={() => setState({ ...state, entries: state.entries.filter((item) => item !== entry) })} hitSlop={8}>
                  <Icon name="x-mark" size={16} color={palette.textMuted} />
                </Pressable>
              </View>
            ))}
            {rights.list && rights.people ? (
              <>
                <TextInput value={query} onChangeText={setQuery} placeholder="Add a person: name or email" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Find a person" style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
                {(found.data ?? []).filter((user) => !listed('user', user.id)).slice(0, 8).map((user) => (
                  <Pressable key={user.id} accessibilityRole="button" onPress={() => add('user', user.id)} style={({ pressed }) => [styles.row, styles.pick, pressed && { backgroundColor: palette.surface }]}>
                    <Icon name="plus" size={14} color={palette.link} />
                    <Text style={[styles.label, styles.flex, { color: palette.text }]} numberOfLines={1}>
                      {user.name}
                    </Text>
                    <Text style={[styles.note, { color: palette.textMuted }]} numberOfLines={1}>
                      {user.email}
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : null}
            {rights.list && rights.groups && (groups.data ?? []).some((group) => !listed('group', group.id)) ? (
              <>
                <Text style={[styles.note, { color: palette.textMuted }]}>Add a group</Text>
                {(groups.data ?? []).filter((group) => !listed('group', group.id)).map((group) => (
                  <Pressable key={group.id} accessibilityRole="button" onPress={() => add('group', group.id)} style={({ pressed }) => [styles.row, styles.pick, pressed && { backgroundColor: palette.surface }]}>
                    <Icon name="plus" size={14} color={palette.link} />
                    <Text style={[styles.label, styles.flex, { color: palette.text }]}>{group.name}</Text>
                    {group.members !== null ? <Text style={[styles.note, { color: palette.textMuted }]}>{`${group.members} ${group.members === 1 ? 'member' : 'members'}`}</Text> : null}
                  </Pressable>
                ))}
              </>
            ) : null}
          </>
        ) : (
          <Text style={[styles.note, { color: palette.textMuted }]}>Your account may not share these with people or groups: an admin can allow it.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  box: { gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  label: { fontFamily: fonts.medium, fontSize: 14 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 8 },
  entry: { padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  pick: { paddingHorizontal: 6, paddingVertical: 8, borderRadius: radius.md },
});
