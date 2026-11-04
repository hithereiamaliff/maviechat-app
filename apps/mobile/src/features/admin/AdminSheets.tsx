import { addGroupMembers, addUser, createAdminGroup, getDefaultPermissions, listAdminUsers, updateUser, USER_ROLES, type AdminUserDetail, type UserRole } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { editorStyles as styles, Field, SheetHeader } from '@/features/workspace/EditorParts';
import { Chip } from '@/features/workspace/ListControls';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { useDebounced } from '@/lib/useDebounced';
import { fonts, radius, usePalette } from '@/theme';
import { useAdminRefresh } from './queries';

export const ROLE_LABELS: Record<string, string> = { admin: 'Admin', user: 'User', pending: 'Waiting for approval' };

function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? children : null}
    </Modal>
  );
}

const input = (palette: ReturnType<typeof usePalette>) => [styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];

/** A new account: name, email, a password to pass on, and its role (approved users by default, as the web's form). */
export function AddUserSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <AddUser onClose={onClose} />
    </Sheet>
  );
}

function AddUser({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const refresh = useAdminRefresh();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('user');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const ready = Boolean(name.trim() && email.trim() && password);
  const save = async () => {
    setBusy(true);
    setProblem('');
    try {
      const made = await addUser(client, { name, email, password, role });
      refresh();
      toast(`${made.name || 'The account'} added`);
      onClose();
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title="Add User" onCancel={onClose} onSave={() => void save()} canSave={ready} busy={busy} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {problem ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{problem}</Text> : null}
        <Field label="Name">
          <TextInput value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={palette.textFaint} accessibilityLabel="Name" style={input(palette)} />
        </Field>
        <Field label="Email">
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" placeholder="name@example.com" placeholderTextColor={palette.textFaint} accessibilityLabel="Email" style={input(palette)} />
        </Field>
        <Field label="Password" note="Pass it on safely; they can change it in their account settings.">
          <TextInput value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false} secureTextEntry textContentType="newPassword" accessibilityLabel="Password" style={input(palette)} />
        </Field>
        <Field label="Role" note={role === 'admin' ? 'Admins can change everything on this server, and see its settings and secrets.' : role === 'pending' ? 'They can sign in, but see only a waiting screen until approved.' : null}>
          <View style={local.chips}>
            {USER_ROLES.map((item) => (
              <Chip key={item} label={ROLE_LABELS[item] ?? item} on={role === item} onPress={() => setRole(item)} />
            ))}
          </View>
        </Field>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** A user's name, email and (if given) a new password, which signs them out everywhere. */
export function EditUserSheet({ user, onClose }: { user: AdminUserDetail | null; onClose: () => void }) {
  return (
    <Sheet visible={user !== null} onClose={onClose}>
      {user ? <EditUser user={user} onClose={onClose} /> : null}
    </Sheet>
  );
}

function EditUser({ user, onClose }: { user: AdminUserDetail; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const refresh = useAdminRefresh();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const changed = name.trim() !== user.name || email.trim().toLowerCase() !== user.email.toLowerCase() || Boolean(password);
  const save = async () => {
    if (!changed) return onClose();
    setBusy(true);
    setProblem('');
    try {
      await updateUser(client, user.id, { ...(name.trim() !== user.name ? { name } : {}), ...(email.trim().toLowerCase() !== user.email.toLowerCase() ? { email } : {}), ...(password ? { password } : {}) });
      refresh();
      toast(password ? 'Saved: they’re signed out everywhere' : 'Saved');
      onClose();
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={`Edit ${user.name}`} onCancel={onClose} onSave={() => void save()} canSave={Boolean(name.trim() && email.trim())} busy={busy} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {problem ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{problem}</Text> : null}
        <Field label="Name">
          <TextInput value={name} onChangeText={setName} accessibilityLabel="Name" style={input(palette)} />
        </Field>
        <Field label="Email">
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" accessibilityLabel="Email" style={input(palette)} />
        </Field>
        <Field label="New password" note="Leave empty to keep theirs. A new one signs them out on every device.">
          <TextInput value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false} secureTextEntry textContentType="newPassword" accessibilityLabel="New password" style={input(palette)} />
        </Field>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** A new group: name and description; its permissions start as today's defaults, as the web makes them. */
export function NewGroupSheet({ visible, onClose, onMade }: { visible: boolean; onClose: () => void; onMade: (id: string) => void }) {
  // Handed on once the sheet is gone, so opening the group doesn't race its closing.
  const [made, setMade] = useState<string | null>(null);
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={() => {
        if (!made) return;
        setMade(null);
        onMade(made);
      }}>
      {visible ? (
        <NewGroup
          onClose={onClose}
          onMade={(id) => {
            setMade(id);
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}

function NewGroup({ onClose, onMade }: { onClose: () => void; onMade: (id: string) => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const refresh = useAdminRefresh();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const save = async () => {
    setBusy(true);
    setProblem('');
    try {
      const made = await createAdminGroup(client, { name, description, permissions: await getDefaultPermissions(client) });
      refresh();
      toast(`${made.name} made`);
      onMade(made.id);
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title="New Group" onCancel={onClose} onSave={() => void save()} canSave={Boolean(name.trim())} busy={busy} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {problem ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{problem}</Text> : null}
        <Field label="Name">
          <TextInput value={name} onChangeText={setName} placeholder="Teachers" placeholderTextColor={palette.textFaint} accessibilityLabel="Name" style={input(palette)} />
        </Field>
        <Field label="Description">
          <TextInput value={description} onChangeText={setDescription} multiline placeholder="Who’s in it" placeholderTextColor={palette.textFaint} accessibilityLabel="Description" style={input(palette)} />
        </Field>
        <Text style={[styles.note, { color: palette.textMuted }]}>Its permissions start as today’s defaults. Add people and change what it allows once it’s made.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** People to add to a group: search, tick several, add them at once. */
export function AddMembersSheet({ groupId, memberIds, visible, onClose }: { groupId: string; memberIds: string[]; visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <AddMembers groupId={groupId} memberIds={memberIds} onClose={onClose} />
    </Sheet>
  );
}

function AddMembers({ groupId, memberIds, onClose }: { groupId: string; memberIds: string[]; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const refresh = useAdminRefresh();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const found = useQuery({ queryKey: ['admin', 'member-search', debounced], queryFn: () => listAdminUsers(client, { query: debounced, orderBy: 'name', direction: 'asc' }), staleTime: 15_000 });
  const people = (found.data?.items ?? []).filter((user) => !memberIds.includes(user.id));
  const save = async () => {
    setBusy(true);
    try {
      await addGroupMembers(client, groupId, picked);
      refresh();
      toast(picked.length === 1 ? 'Added to the group' : `${picked.length} added to the group`);
      onClose();
    } catch (error) {
      toast(`Couldn’t add them: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={picked.length ? `Add ${picked.length}` : 'Add People'} onCancel={onClose} onSave={() => void save()} canSave={picked.length > 0} busy={busy} />
      <View style={local.pad}>
        <TextInput value={query} onChangeText={setQuery} placeholder="Search by name or email" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search people" style={input(palette)} />
      </View>
      <ScrollView contentContainerStyle={local.list} keyboardShouldPersistTaps="handled">
        {found.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t search: ${describeError(found.error)}`}</Text> : null}
        {found.data && !people.length ? <Text style={[styles.note, { color: palette.textFaint }]}>{debounced ? 'Nobody else matches.' : 'Everyone is in it already.'}</Text> : null}
        {people.map((user) => {
          const on = picked.includes(user.id);
          return (
            <Pressable key={user.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setPicked(on ? picked.filter((id) => id !== user.id) : [...picked, user.id])} style={({ pressed }) => [local.row, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <Icon name={on ? 'check' : 'plus'} size={16} color={on ? palette.link : palette.textMuted} />
              <View style={styles.flex}>
                <Text style={[local.name, { color: palette.text }]} numberOfLines={1}>
                  {user.name}
                </Text>
                <Text style={[styles.note, { color: palette.textMuted }]} numberOfLines={1}>
                  {user.email}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const local = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pad: { paddingHorizontal: 16, paddingBottom: 8 },
  list: { padding: 16, gap: 8, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  name: { fontFamily: fonts.medium, fontSize: 15 },
});
