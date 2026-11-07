import { confirmMfaEnrollment, OwuiClient, otpauthUri, redeemMfaReset, startMfaEnrollment, verifyMfa, type MfaStep } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useToast } from '@/components/Toast';
import { shareFile } from '@/features/settings/exportFile';
import { ANDROID } from '@/lib/device';
import { describeSignInError } from '@/session/errors';
import { useSession, type SignInOutcome } from '@/session/SessionProvider';
import { fonts, radius, usePalette } from '@/theme';

type Challenge = Extract<SignInOutcome, { kind: 'mfa' }>;

/**
 * Open WebUI 0.12's second sign-in step, after the password: a code from the authenticator app
 * (or a recovery code); setting an authenticator up when the server asks for one (it then hands
 * over recovery codes to keep); or an admin's reset token. Each step is short-lived: when one
 * expires, sign in again.
 */
export function TwoStepSignIn({ challenge: first, email, onBack }: { challenge: Challenge; email: string; onBack: (message?: string) => void }) {
  const { finishSignIn } = useSession();
  const [challenge, setChallenge] = useState(first);
  const [codes, setCodes] = useState<{ list: string[]; done: () => Promise<void> } | null>(null);
  const client = new OwuiClient({ baseUrl: challenge.baseUrl, token: null });

  /** The server's answer to a step: signed in, waiting for approval, or another step. */
  const next = async (result: Parameters<typeof finishSignIn>[1]) => {
    const outcome = await finishSignIn(challenge.baseUrl, result);
    if (outcome.kind === 'signed-in') router.replace('/');
    else if (outcome.kind === 'pending') onBack('Your account is waiting for an administrator to approve it. Try again once it has been approved.');
    else setChallenge(outcome);
  };

  if (codes) return <RecoveryCodes codes={codes.list} onDone={codes.done} />;
  if (challenge.step === 'enroll') return <Enroll key={challenge.challengeToken} client={client} challenge={challenge} email={email} onBack={onBack} onConfirmed={(result, list) => setCodes({ list, done: () => next(result) })} />;
  return <CodeStep key={`${challenge.step}:${challenge.challengeToken}`} client={client} challenge={challenge} step={challenge.step} onBack={onBack} onResult={next} />;
}

function CodeStep({ client, challenge, step, onBack, onResult }: { client: OwuiClient; challenge: Challenge; step: MfaStep; onBack: (message?: string) => void; onResult: (result: Awaited<ReturnType<typeof verifyMfa>>) => Promise<void> }) {
  const palette = usePalette();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const reset = step === 'recover';
  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setProblem('');
    try {
      await onResult(reset ? await redeemMfaReset(client, challenge.challengeToken, code) : await verifyMfa(client, challenge.challengeToken, code, recovery));
    } catch (error) {
      const text = describeSignInError(error);
      if (/expired|start again/i.test(text)) onBack('That step expired. Sign in again.');
      else setProblem(text);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.form}>
      <Text style={[styles.title, { color: palette.text }]}>{reset ? 'Reset two-step sign-in' : 'Two-step sign-in'}</Text>
      <Text style={[styles.body, { color: palette.textMuted }]}>
        {reset ? 'An admin reset your two-step sign-in. Enter the reset token they gave you; then you’ll set up an authenticator again.' : recovery ? 'Enter one of the recovery codes you saved. Each works once.' : 'Enter the 6-digit code from your authenticator app.'}
      </Text>
      <TextField
        label={reset ? 'Reset token' : recovery ? 'Recovery code' : 'Code'}
        value={code}
        onChangeText={setCode}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={reset || recovery ? 'default' : 'number-pad'}
        textContentType={reset || recovery ? 'none' : 'oneTimeCode'}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      {problem ? <Text style={[styles.body, { color: palette.danger }]}>{problem}</Text> : null}
      <Button label="Continue" onPress={() => void submit()} loading={busy} disabled={!code.trim()} />
      {!reset ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setRecovery(!recovery);
            setCode('');
            setProblem('');
          }}
          hitSlop={8}
          style={styles.link}>
          <Text style={[styles.linkText, { color: palette.link }]}>{recovery ? 'Use a code from the app instead' : 'Use a recovery code'}</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => onBack()} hitSlop={8} style={styles.link}>
        <Text style={[styles.linkText, { color: palette.link }]}>Back</Text>
      </Pressable>
    </View>
  );
}

function Enroll({ client, challenge, email, onBack, onConfirmed }: { client: OwuiClient; challenge: Challenge; email: string; onBack: (message?: string) => void; onConfirmed: (result: Awaited<ReturnType<typeof confirmMfaEnrollment>>['result'], codes: string[]) => void }) {
  const palette = usePalette();
  const toast = useToast();
  // Asked once: each request makes a new key, and the first may already be in the authenticator.
  const setup = useQuery({ queryKey: ['mfa-enroll', challenge.challengeToken], queryFn: () => startMfaEnrollment(client, challenge.challengeToken), staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const key = setup.data?.manualKey ?? '';
  // Opened straight away (asking first would need the scheme declared in a store build).
  const addToApp = () => void Linking.openURL(otpauthUri(key, email)).catch(() => toast('No authenticator app answered: copy the setup key into yours.', 'error'));
  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setProblem('');
    try {
      const { result, recoveryCodes } = await confirmMfaEnrollment(client, challenge.challengeToken, code);
      onConfirmed(result, recoveryCodes);
    } catch (error) {
      const text = describeSignInError(error);
      if (/expired|start again/i.test(text)) onBack('That step expired. Sign in again.');
      else setProblem(text);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.form}>
      <Text style={[styles.title, { color: palette.text }]}>Set up two-step sign-in</Text>
      <Text style={[styles.body, { color: palette.textMuted }]}>This server asks for a code from an authenticator app each time you sign in. {ANDROID ? 'Add it to an authenticator app' : 'Add it to the iPhone’s Passwords or to an authenticator app'}, then enter the code it shows.</Text>
      {setup.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {setup.isError ? <Text style={[styles.body, { color: palette.danger }]}>{describeSignInError(setup.error)}</Text> : null}
      {key ? (
        <>
          <Button label="Add to Passwords or an Authenticator" onPress={addToApp} />
          <View style={[styles.keyBox, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Text style={[styles.small, { color: palette.textMuted }]}>Or type this setup key into your app</Text>
            <Text selectable style={[styles.key, { color: palette.text }]}>
              {key}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void Clipboard.setStringAsync(key.replace(/\s+/g, '')).then(() => toast('Setup key copied'))} hitSlop={8}>
              <Text style={[styles.linkText, { color: palette.link }]}>Copy Key</Text>
            </Pressable>
          </View>
          {setup.data?.qrCode ? (
            <View style={styles.qr}>
              <Image source={{ uri: setup.data.qrCode }} style={styles.qrImage} contentFit="contain" accessibilityLabel="QR code for another device" />
              <Text style={[styles.small, { color: palette.textMuted }]}>Or scan this with another device.</Text>
            </View>
          ) : null}
          <TextField label="Code from the app" value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" autoCorrect={false} returnKeyType="go" onSubmitEditing={() => void submit()} />
          {problem ? <Text style={[styles.body, { color: palette.danger }]}>{problem}</Text> : null}
          <Button label="Confirm" onPress={() => void submit()} loading={busy} disabled={!code.trim()} />
        </>
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => onBack()} hitSlop={8} style={styles.link}>
        <Text style={[styles.linkText, { color: palette.link }]}>Back</Text>
      </Pressable>
    </View>
  );
}

/** Recovery codes, shown once: each signs in once without the authenticator. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => Promise<void> }) {
  const palette = usePalette();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const all = codes.join('\n');
  return (
    <View style={styles.form}>
      <Text style={[styles.title, { color: palette.text }]}>Keep your recovery codes</Text>
      <Text style={[styles.body, { color: palette.textMuted }]}>If you lose your authenticator, each of these signs you in once. They won’t be shown again: save them somewhere safe, like the Passwords app or a password manager.</Text>
      <View style={[styles.keyBox, { borderColor: palette.border, backgroundColor: palette.surface }]}>
        <Text selectable style={[styles.codes, { color: palette.text }]}>
          {all}
        </Text>
      </View>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" onPress={() => void Clipboard.setStringAsync(all).then(() => toast('Recovery codes copied'))} hitSlop={8}>
          <Text style={[styles.linkText, { color: palette.link }]}>Copy Codes</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void shareFile('recovery-codes.txt', `${all}\n`).catch(() => undefined)} hitSlop={8}>
          <Text style={[styles.linkText, { color: palette.link }]}>Save to Files…</Text>
        </Pressable>
      </View>
      <Button
        label="I’ve Saved Them"
        loading={busy}
        onPress={() => {
          setBusy(true);
          void onDone().finally(() => setBusy(false));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  title: { fontFamily: fonts.semibold, fontSize: 22 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  small: { fontFamily: fonts.regular, fontSize: 13 },
  link: { alignSelf: 'center', paddingVertical: 4 },
  linkText: { fontFamily: fonts.medium, fontSize: 15 },
  keyBox: { gap: 8, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  key: { fontFamily: fonts.mono, fontSize: 17, letterSpacing: 1 },
  codes: { fontFamily: fonts.mono, fontSize: 15, lineHeight: 24 },
  qr: { alignItems: 'center', gap: 6 },
  qrImage: { width: 180, height: 180, backgroundColor: '#FFFFFF', borderRadius: radius.md },
  row: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
});
