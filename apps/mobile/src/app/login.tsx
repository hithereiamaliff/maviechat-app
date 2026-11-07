import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AvoidKeyboard } from '@/components/AvoidKeyboard';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { TextField } from '@/components/TextField';
import { useAccountsSheet } from '@/features/accounts/AccountsSheet';
import { TwoStepSignIn } from '@/features/auth/TwoStepSignIn';
import { switchToDeepTutor } from '@/features/deeptutor/switch';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { describeSignInError } from '@/session/errors';
import { useSession, type SignInOutcome } from '@/session/SessionProvider';
import { fonts, usePalette } from '@/theme';

type Message = { tone: 'error' | 'info'; text: string };

export default function Login() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { state, signIn, accounts } = useSession();
  const deepTutorSignedIn = useDeepTutor().state.status === 'signed-in';
  const params = useLocalSearchParams<{ from?: string; add?: string }>();
  // Opened from the welcome screen: a way back to the choice.
  const fromWelcome = params.from === 'welcome';
  // Opened from Accounts: adds another account beside the one in use.
  const adding = params.add === '1';
  const accountsSheet = useAccountsSheet('owui');
  const [serverUrl, setServerUrl] = useState(() =>
    state.status === 'signed-out' ? (state.lastServerUrl ?? '') : state.status === 'signed-in' ? state.session.baseUrl : '',
  );
  const [email, setEmail] = useState(() => (state.status === 'signed-out' ? (state.login ?? '') : ''));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // Open WebUI 0.12's second step, after the password.
  const [twoStep, setTwoStep] = useState<Extract<SignInOutcome, { kind: 'mfa' }> | null>(null);
  const [message, setMessage] = useState<Message | null>(() =>
    state.status === 'signed-out' && state.notice ? { tone: 'info', text: state.notice } : null,
  );

  if (state.status === 'signed-in' && !adding) return <Redirect href="/" />;
  // Another account to switch to instead of signing in here.
  const others = accounts.some((entry) => entry.signedIn && (state.status !== 'signed-in' || entry.id !== state.accountId));

  async function submit() {
    if (!serverUrl.trim() || !email.trim() || !password) {
      setMessage({ tone: 'error', text: 'Enter the server address, your email and your password.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await signIn({ serverUrl, email, password });
      if (outcome.kind === 'signed-in') {
        router.replace('/');
        return;
      }
      if (outcome.kind === 'mfa') {
        setPassword('');
        setTwoStep(outcome);
        return;
      }
      setMessage({ tone: 'info', text: 'Your account is waiting for an administrator to approve it. Try again once it has been approved.' });
    } catch (error) {
      setMessage({ tone: 'error', text: describeSignInError(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AvoidKeyboard style={styles.flex}>
      <ScrollView
        style={{ backgroundColor: palette.background }}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]}>MavieChat</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>{adding ? 'Add another Open WebUI account. The one in use stays signed in.' : 'Sign in to your Open WebUI server.'}</Text>
        </View>

        {twoStep ? (
          <TwoStepSignIn
            challenge={twoStep}
            email={email.trim()}
            onBack={(text) => {
              setTwoStep(null);
              setMessage(text ? { tone: 'info', text } : null);
            }}
          />
        ) : (
        <View style={styles.form}>
          <TextField
            label="Server address"
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="https://chat.example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            returnKeyType="next"
          />
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="next"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />

          {message ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.message, { color: message.tone === 'error' ? palette.danger : palette.textMuted }]}>
              {message.text}
            </Text>
          ) : null}

          <Button label={adding ? 'Add Account' : 'Sign in'} onPress={() => void submit()} loading={busy} />
          {others && !adding ? (
            <Pressable accessibilityRole="button" onPress={accountsSheet.open} hitSlop={8} style={styles.other}>
              <Text style={[styles.otherText, { color: palette.link }]}>Use Another Account</Text>
            </Pressable>
          ) : null}
          {/* Either space works on its own: DeepTutor alone needs no Open WebUI account. */}
          {adding ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              deepTutorSignedIn ? switchToDeepTutor(true) : router.replace({ pathname: '/deeptutor-login', params: fromWelcome ? { from: 'welcome' } : {} })
            }
            hitSlop={8}
            style={styles.other}>
            <Text style={[styles.otherText, { color: palette.link }]}>{deepTutorSignedIn ? 'Back to DeepTutor' : 'Sign in to DeepTutor instead'}</Text>
          </Pressable>
          )}
        </View>
        )}

        <Text style={[styles.footer, { color: palette.textMuted }]}>
          MavieChat is an independent app for Open WebUI and DeepTutor servers and is not affiliated with either.
        </Text>
      </ScrollView>
      {fromWelcome || adding ? (
        <View style={[styles.back, { top: insets.top + 4 }]}>
          {adding ? (
            <IconButton icon="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          ) : (
            <IconButton icon="chevron-left" label="Back to the choice" onPress={() => router.replace('/welcome')} />
          )}
        </View>
      ) : null}
      {accountsSheet.element}
    </AvoidKeyboard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24, gap: 32 },
  header: { gap: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 28 },
  subtitle: { fontFamily: fonts.regular, fontSize: 16 },
  form: { gap: 16 },
  message: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  other: { alignSelf: 'center', paddingVertical: 4 },
  back: { position: 'absolute', left: 8 },
  otherText: { fontFamily: fonts.medium, fontSize: 15 },
  footer: { marginTop: 'auto', fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
