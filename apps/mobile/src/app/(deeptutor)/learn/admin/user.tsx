import { deleteUser, passwordProblem, resetUserPassword, setUserRole } from '@maviechat/deeptutor-protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { showPrompt } from '@/components/dialogs';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { initials, PRESET_NAMES, useAdminUsers, useUserGrants } from '@/features/deeptutor/admin/queries';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

/** DeepTutor keeps a sign-in for this long on our server, and doesn't end one early. */
const SIGN_IN_DAYS = 30;

/**
 * One account, for admins: its role and kind, what it has been given, and the account actions
 * DeepTutor offers (each saying first what it does): making them an admin or not, a new
 * password, deleting the account. Choosing what it's given stays on DeepTutor's page.
 */
export default function UserScreen() {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useDtAuthed();
  const username = one(useLocalSearchParams<{ username: string }>().username);
  const users = useAdminUsers();
  const user = users.data?.find((row) => row.username === username);
  const { grants, books } = useUserGrants(user?.id ?? '', Boolean(user && !user.isAdmin && !user.configured));
  const [busy, setBusy] = useState(false);
  const self = username === session.account.username;

  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast(done);
      void users.refetch();
    } catch (error) {
      toast(describeError(error), 'error');
    } finally {
      setBusy(false);
    }
  };
  const promote = () =>
    Alert.alert(`Make ${username} an admin?`, 'Admins manage every account and all work in the one shared main workspace: they’ll see the chats, knowledge bases and notebook there. It applies when they next sign in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Make Admin', style: 'destructive', onPress: () => void run(() => setUserRole(client, username, 'admin'), `${username} is an admin from their next sign-in`) },
    ]);
  const demote = () =>
    Alert.alert(`Make ${username} an ordinary account?`, `They lose the admin pages and move to a workspace of their own when they next sign in. A sign-in they already have keeps admin rights until it expires (up to ${SIGN_IN_DAYS} days).`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Make Ordinary', style: 'destructive', onPress: () => void run(() => setUserRole(client, username, 'user'), `${username} is an ordinary account from their next sign-in`) },
    ]);
  const resetPassword = () =>
    showPrompt(
      `New password for ${username}`,
      `At least 8 characters. They’re asked to change it when they next sign in; a sign-in they already have keeps working (up to ${SIGN_IN_DAYS} days).`,
      (value) => {
        const password = value ?? '';
        const problem = passwordProblem(password);
        if (problem) return toast(problem, 'error');
        void run(() => resetUserPassword(client, username, password), 'Password set');
      },
      'secure-text',
    );
  const remove = () =>
    showPrompt(
      `Delete ${username}?`,
      `Their account and picture are deleted for good; what they made stays on the server. A sign-in they already have keeps working until it expires (up to ${SIGN_IN_DAYS} days). Type their username to delete it.`,
      (value) => {
        if ((value ?? '').trim() !== username) return toast('The username didn’t match: nothing was deleted.', 'error');
        setBusy(true);
        void deleteUser(client, username).then(
          () => {
            toast(`${username} deleted`);
            void users.refetch();
            router.back();
          },
          (error: unknown) => {
            setBusy(false);
            toast(describeError(error), 'error');
          },
        );
      },
      'plain-text',
    );

  const given = grants.data;
  const lines = given
    ? [
        `${given.models} ${given.models === 1 ? 'model' : 'models'}`,
        `${given.knowledgeBases} knowledge ${given.knowledgeBases === 1 ? 'base' : 'bases'}`,
        `${given.skills} ${given.skills === 1 ? 'skill' : 'skills'}`,
        `${given.partners} ${given.partners === 1 ? 'partner' : 'partners'}`,
        given.tools === null ? 'every tool' : `${given.tools} ${given.tools === 1 ? 'tool' : 'tools'}`,
        given.mcpTools === null ? 'no MCP tools' : `${given.mcpTools} MCP ${given.mcpTools === 1 ? 'tool' : 'tools'}`,
        given.code === false ? 'never runs code' : 'runs code as the server allows',
      ]
    : [];

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title={username || 'User'} />
      <ScrollView contentContainerStyle={styles.content}>
        {users.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {users.data && !user ? <Text style={[styles.note, { color: palette.textMuted }]}>This account is no longer here.</Text> : null}
        {user ? (
          <>
            <View style={styles.top}>
              <View style={[styles.avatar, { backgroundColor: user.isAdmin ? palette.active : palette.surfaceStrong }]}>
                <Text style={[styles.initials, { color: user.isAdmin ? palette.onActive : palette.text }]}>{initials(user.username)}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={[styles.name, { color: palette.text }]}>{self ? `${user.username} (you)` : user.username}</Text>
                <Text style={[styles.note, { color: palette.textMuted }]}>
                  {[user.isAdmin ? 'Admin' : `${PRESET_NAMES[user.preset] ?? 'Ordinary'} account`, user.createdAt ? `joined ${new Date(user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}` : user.configured ? 'set in DeepTutor’s configuration' : ''].filter(Boolean).join(' · ')}
                </Text>
                {user.mustChangePassword ? <Text style={[styles.note, { color: palette.warning }]}>Must change their password at their next sign-in.</Text> : null}
              </View>
            </View>
            {!user.isAdmin ? (
              <View style={[styles.box, { borderColor: palette.border }]}>
                <Text style={[styles.label, { color: palette.text }]}>Given</Text>
                {grants.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
                {grants.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t read it: ${describeError(grants.error)}`}</Text> : null}
                {lines.length ? <Text style={[styles.note, { color: palette.textMuted }]}>{lines.join(' · ')}</Text> : null}
                {given?.learning ? <Text style={[styles.note, { color: palette.textMuted }]}>{`A learner: ages ${given.learning.ageBand || 'unset'}; ${given.learning.surfaces.join(', ') || 'no pages'}`}</Text> : null}
                {books.data ? <Text style={[styles.note, { color: palette.textMuted }]}>{`Books: ${books.data.create ? 'may make their own' : 'can’t make their own'}; shared ones ${books.data.shared === 'read' ? 'readable' : 'hidden'} unless set (${books.data.books} set)`}</Text> : null}
                <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/learn/web', params: { path: '/admin/users', title: 'User Management' } })} hitSlop={6}>
                  <Text style={[styles.link, { color: palette.link }]}>Change on DeepTutor’s page</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={[styles.note, { color: palette.textMuted }]}>Admins have everything, in the shared main workspace.</Text>
            )}
            {self ? (
              <Text style={[styles.note, { color: palette.textFaint }]}>You can’t change or delete your own account here: your password is in Settings.</Text>
            ) : (
              <View style={styles.actions}>
                {!user.configured ? user.isAdmin ? <Button label="Make Ordinary Account" variant="secondary" disabled={busy} onPress={demote} /> : <Button label="Make Admin" variant="secondary" disabled={busy} onPress={promote} /> : null}
                <Button label="Set a New Password" variant="secondary" disabled={busy || user.configured} onPress={resetPassword} />
                <Button label="Delete Account" variant="secondary" disabled={busy || user.configured} onPress={remove} />
                {user.configured ? <Text style={[styles.note, { color: palette.textFaint }]}>This admin is set in DeepTutor’s configuration, so it’s changed there.</Text> : null}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: fonts.semibold, fontSize: 18 },
  flex: { flex: 1, gap: 3 },
  name: { fontFamily: fonts.semibold, fontSize: 18 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  box: { gap: 6, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  label: { fontFamily: fonts.medium, fontSize: 14 },
  link: { fontFamily: fonts.medium, fontSize: 14, marginTop: 4 },
  actions: { gap: 10 },
});
