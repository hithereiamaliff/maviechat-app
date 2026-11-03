import { changePassword, MIN_PASSWORD_LENGTH } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { TextField } from '@/components/TextField';
import { hostOf } from '@/features/deeptutor/crossReference';
import { useDtProfile } from '@/features/deeptutor/queries';
import { useDtSignOut } from '@/features/deeptutor/useDtSignOut';
import { initials } from '@/features/sidebar/parts';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { openDtPage } from './DtGeneralSettings';

type Outcome = { tone: 'error' | 'success'; text: string } | null;

function joined(value: string | undefined): string | null {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : null;
}

/** Account in DeepTutor's Settings, like its profile page: who you are, your password, and signing out. */
export function DtAccountSettings() {
  const palette = usePalette();
  const { client, session } = useDtAuthed();
  const queryClient = useQueryClient();
  const profile = useDtProfile();
  const signOut = useDtSignOut();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const data = profile.data;
  const role = session.account.isAdmin ? 'Admin' : data?.preset === 'learner' ? 'Learner' : 'User';
  const since = joined(data?.created_at);

  const submit = async () => {
    if (!current || !next) return setOutcome({ tone: 'error', text: 'Enter your current password and a new one.' });
    if (next.length < MIN_PASSWORD_LENGTH) return setOutcome({ tone: 'error', text: `The new password needs at least ${MIN_PASSWORD_LENGTH} characters.` });
    if (next !== confirm) return setOutcome({ tone: 'error', text: "The new passwords don't match." });
    if (next === current) return setOutcome({ tone: 'error', text: 'The new password must differ from the current one.' });
    setBusy(true);
    setOutcome(null);
    try {
      await changePassword(client, current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setOutcome({ tone: 'success', text: 'Password changed. You stay signed in here and on your other devices.' });
      void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'profile'] });
    } catch (error) {
      setOutcome({ tone: 'error', text: `Couldn't change the password: ${describeError(error)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.card, { borderColor: palette.border }]}>
        <View style={[styles.avatar, { backgroundColor: palette.surfaceStrong }]}>
          <Text style={[styles.avatarText, { color: palette.text }]}>{initials(session.account.username)}</Text>
        </View>
        <View style={styles.who}>
          <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
            {session.account.username}
          </Text>
          <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={2}>
            {[role, hostOf(session.baseUrl), since ? `joined ${since}` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens your profile in DeepTutor, for your picture"
        onPress={() => openDtPage('/profile', 'Profile')}
        style={({ pressed }) => [styles.group, styles.linkRow, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
        <Text style={[styles.label, { color: palette.text }]}>Profile Picture</Text>
        <Icon name="arrow-top-right-on-square" size={15} color={palette.textFaint} />
      </Pressable>

      {data?.can_change_password === false ? null : (
        <View style={styles.form}>
          <Text style={[styles.section, { color: palette.textMuted }]}>Change Password</Text>
          {data?.must_change_password ? (
            <Text style={[styles.note, { color: palette.warning }]}>You still have the password an admin gave you. Choose your own.</Text>
          ) : null}
          <TextField label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" />
          <TextField label="New password" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
          <TextField
            label="Confirm new password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
          {outcome ? (
            <Text accessibilityLiveRegion="polite" style={[styles.note, { color: outcome.tone === 'error' ? palette.danger : palette.success }]}>
              {outcome.text}
            </Text>
          ) : null}
          <Button label="Change Password" onPress={() => void submit()} loading={busy} />
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={signOut}
        style={({ pressed }) => [styles.group, styles.linkRow, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
        <Text style={[styles.label, { color: palette.danger }]}>Sign Out of DeepTutor</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.semibold, fontSize: 15 },
  who: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 17 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  linkRow: { flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: 14 },
  label: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  form: { gap: 12, marginTop: 8 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginLeft: 4 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginHorizontal: 4 },
});
