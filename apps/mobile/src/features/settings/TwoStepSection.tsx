import { confirmMfaReplacement, getMfaStatus, needsFreshSignIn, newRecoveryCodes, OwuiHttpError, startMfaReplacement } from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { TextField } from '@/components/TextField';
import { ADD_TO_APP, AuthenticatorSetup, RecoveryCodes } from '@/features/auth/TwoStepSignIn';
import { useAuthed } from '@/lib/server';
import { describeSignInError } from '@/session/errors';
import { useSession } from '@/session/SessionProvider';
import { fonts, usePalette } from '@/theme';
import { Group, Note, SectionTitle } from './rows';

/** The full-screen part: adding the new authenticator, then the recovery codes to keep. */
type Flow = { kind: 'setup'; challengeToken: string } | { kind: 'codes'; codes: string[]; replaced: boolean };

const SAVE_THEM = 'They won’t be shown again: save them somewhere safe, like the Passwords app or a password manager. Then sign in again: every device was signed out, this one too.';
const AGAIN_NOTICE = 'Sign in again, then go back to Settings → Account → Two-Step Sign-In.';

/**
 * Your own two-step sign-in (Open WebUI 0.12, where the server asks for it; the web's
 * multi-factor section): whether an authenticator is set up and how many recovery codes are left;
 * with a fresh code (or a recovery code), replace the authenticator or make new recovery codes.
 * Either signs every device out, so the codes stay on screen until you've saved them, and then
 * you sign in again.
 */
export function TwoStepSection() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { client, session } = useAuthed();
  const { expireSession, holdSessionChecks } = useSession();
  const status = useQuery({ queryKey: ['mfa-status'], queryFn: () => getMfaStatus(client), retry: false });
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState<'replace' | 'codes' | null>(null);
  const [problem, setProblem] = useState('');
  const [stale, setStale] = useState(false);
  const [flow, setFlow] = useState<Flow | null>(null);
  // Set while the codes show (the server has signed this device out); released once they're saved.
  const releaseRef = useRef<(() => void) | null>(null);
  const afterCloseRef = useRef<(() => void) | null>(null);

  const refused = status.error instanceof OwuiHttpError && status.error.isUnauthorized;
  const data = status.data;
  if (!data?.required && !(status.isError && !refused)) return null;

  const failed = (error: unknown) => {
    if (needsFreshSignIn(error)) {
      setStale(true);
      setProblem('');
    } else setProblem(describeSignInError(error));
  };

  const replace = async () => {
    setBusy('replace');
    setProblem('');
    try {
      const { challengeToken } = await startMfaReplacement(client, code, recovery);
      setCode('');
      setFlow({ kind: 'setup', challengeToken });
    } catch (error) {
      failed(error);
    } finally {
      setBusy(null);
      // A recovery code used to start it is gone either way.
      if (recovery) void queryClient.invalidateQueries({ queryKey: ['mfa-status'] });
    }
  };

  const makeCodes = async () => {
    setBusy('codes');
    setProblem('');
    // Held before asking: the server signs every device out as it answers.
    const release = holdSessionChecks();
    try {
      const codes = await newRecoveryCodes(client, code, recovery);
      if (!codes.length) throw new Error('The server didn’t send the new codes. Sign in again and look here.');
      releaseRef.current = release;
      setCode('');
      setFlow({ kind: 'codes', codes, replaced: false });
    } catch (error) {
      release();
      failed(error);
    } finally {
      setBusy(null);
    }
  };

  const askForCodes = () =>
    Alert.alert('Make new recovery codes?', 'Your old ones stop working, and every device is signed out, this one too.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Make New Codes', onPress: () => void makeCodes() },
    ]);

  /** Closes the full-screen part, then (once it has gone) signs in again. */
  const finish = (notice: string) => {
    let done = false;
    const signInAgain = () => {
      if (done) return;
      done = true;
      afterCloseRef.current = null;
      releaseRef.current?.();
      releaseRef.current = null;
      void expireSession(notice);
    };
    afterCloseRef.current = signInAgain;
    setFlow(null);
    // In case the sheet's closing is never reported: this device is signed out already.
    setTimeout(signInAgain, 1500);
  };

  const shownCode = (
    <View style={styles.manage}>
      <Note>Prove it’s you with a fresh code. Either change signs out every device, this one too.</Note>
      <TextField
        label={recovery ? 'Recovery code' : 'Code from your authenticator'}
        value={code}
        onChangeText={setCode}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={recovery ? 'default' : 'number-pad'}
        textContentType={recovery ? 'none' : 'oneTimeCode'}
        maxLength={recovery ? 128 : 6}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setRecovery(!recovery);
          setCode('');
          setProblem('');
        }}
        hitSlop={8}
        style={styles.switch}>
        <Text style={[styles.link, { color: palette.link }]}>{recovery ? 'Use a code from the app instead' : 'Use a recovery code'}</Text>
      </Pressable>
      {problem ? <Text style={[styles.problem, { color: palette.danger }]}>{problem}</Text> : null}
      <Button label="Replace Authenticator" loading={busy === 'replace'} disabled={!code.trim() || busy !== null} onPress={() => void replace()} />
      <Button label="New Recovery Codes" variant="secondary" loading={busy === 'codes'} disabled={!code.trim() || busy !== null} onPress={askForCodes} />
    </View>
  );

  return (
    <>
      <View style={styles.heading}>
        <SectionTitle title="Two-Step Sign-In" />
        {data?.required && data.enabled ? (
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={open ? 'Hide two-step sign-in options' : 'Manage two-step sign-in'} onPress={() => setOpen(!open)} hitSlop={8} style={styles.toggle}>
            <Text style={[styles.toggleText, { color: palette.link }]}>{open ? 'Hide' : 'Manage'}</Text>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={13} color={palette.link} />
          </Pressable>
        ) : null}
      </View>
      {data ? (
        <Group>
          <View style={styles.row}>
            <Icon name="shield-check" size={18} color={data.enabled ? palette.text : palette.textFaint} />
            <View style={styles.text}>
              <Text style={[styles.label, { color: palette.text }]}>{data.enabled ? 'Authenticator set up' : 'No authenticator yet'}</Text>
              <Text style={[styles.hint, { color: palette.textMuted }]}>
                {data.enabled
                  ? `${data.recoveryCodesRemaining} recovery ${data.recoveryCodesRemaining === 1 ? 'code' : 'codes'} left`
                  : 'Your administrator manages it: you’ll set one up the next time you sign in.'}
              </Text>
            </View>
          </View>
        </Group>
      ) : status.isError ? (
        <Note>{`Couldn’t check two-step sign-in: ${describeSignInError(status.error)}`}</Note>
      ) : null}
      {stale ? (
        <View style={styles.manage}>
          <Note>To change this, the server wants a sign-in from the last few minutes. Sign in again, then come back here.</Note>
          <Button label="Sign In Again" onPress={() => void expireSession(AGAIN_NOTICE)} />
        </View>
      ) : open && data?.required && data.enabled ? (
        shownCode
      ) : null}

      <Modal
        visible={flow !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          // The codes stay until you say they're saved.
          if (flow?.kind === 'setup') setFlow(null);
        }}
        onDismiss={() => {
          const after = afterCloseRef.current;
          afterCloseRef.current = null;
          after?.();
        }}>
        <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
          <ScrollView contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
            {flow?.kind === 'setup' ? (
              <AuthenticatorSetup
                key={flow.challengeToken}
                client={client}
                challengeToken={flow.challengeToken}
                email={session.user.email}
                title="Replace your authenticator"
                intro={`${ADD_TO_APP}, then enter the code it shows. Your current one keeps working until you confirm; then every device is signed out, this one too.`}
                backLabel="Cancel"
                confirm={async (first) => {
                  const release = holdSessionChecks();
                  try {
                    const codes = await confirmMfaReplacement(client, flow.challengeToken, first);
                    releaseRef.current = release;
                    setFlow({ kind: 'codes', codes, replaced: true });
                  } catch (error) {
                    release();
                    throw error;
                  }
                }}
                onBack={() => setFlow(null)}
                onExpired={() => {
                  setFlow(null);
                  setProblem('That took too long. Start again with a fresh code.');
                }}
              />
            ) : flow?.kind === 'codes' ? (
              <RecoveryCodes
                codes={flow.codes}
                intro={`${flow.replaced ? 'Your new authenticator is set up. If you ever lose it' : 'Your old recovery codes no longer work. If you lose your authenticator'}, each of these signs you in once. ${SAVE_THEM}`}
                onDone={async () =>
                  finish(flow.replaced ? 'Your authenticator was replaced, so every device was signed out. Sign in with a code from the new one.' : 'You have new recovery codes, so every device was signed out. Sign in again.')
                }
              />
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingBottom: 1, paddingRight: 4 },
  toggleText: { fontFamily: fonts.medium, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 14, paddingVertical: 10 },
  text: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.regular, fontSize: 15 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  manage: { gap: 10, marginTop: 4 },
  switch: { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 4 },
  link: { fontFamily: fonts.medium, fontSize: 14 },
  problem: { fontFamily: fonts.regular, fontSize: 14 },
  sheet: { flex: 1 },
  sheetContent: { padding: 24, gap: 16 },
});
