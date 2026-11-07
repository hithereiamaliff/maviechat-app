import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AvoidKeyboard } from '@/components/AvoidKeyboard';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { TextField } from '@/components/TextField';
import { useAccountsSheet } from '@/features/accounts/AccountsSheet';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { describeDtSignInError } from '@/session/errors';
import { useSession } from '@/session/SessionProvider';
import { saveSpace } from '@/session/storage';
import { fonts, usePalette } from '@/theme';

type Message = { tone: 'error' | 'info'; text: string };

/** Sign in to a DeepTutor server. It sits beside your Open WebUI sign-in; neither replaces the other. */
export default function DeepTutorLogin() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { state, signIn, accounts } = useDeepTutor();
  const owui = useSession();
  const params = useLocalSearchParams<{ from?: string; add?: string }>();
  // Opened from the welcome screen: a way back to the choice.
  const fromWelcome = params.from === 'welcome';
  // Opened from Accounts: adds another account beside the one in use.
  const adding = params.add === '1';
  const accountsSheet = useAccountsSheet('deeptutor');
  const [serverUrl, setServerUrl] = useState(() =>
    state.status === 'signed-out' ? (state.lastServerUrl ?? '') : state.status === 'signed-in' ? state.session.baseUrl : '',
  );
  const [username, setUsername] = useState(() => (state.status === 'signed-out' ? (state.login ?? '') : ''));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(() =>
    state.status === 'signed-out' && state.notice ? { tone: 'info', text: state.notice } : null,
  );

  if (state.status === 'signed-in' && !adding) return <Redirect href="/learn" />;
  // Another account to switch to instead of signing in here.
  const others = accounts.some((entry) => entry.signedIn && (state.status !== 'signed-in' || entry.id !== state.accountId));

  async function submit() {
    if (!serverUrl.trim() || !username.trim() || !password) {
      setMessage({ tone: 'error', text: 'Enter the DeepTutor address, your username and your password.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await signIn({ serverUrl, username, password });
      await saveSpace('deeptutor');
      router.replace('/learn');
    } catch (error) {
      setMessage({ tone: 'error', text: describeDtSignInError(error) });
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
          <Text style={[styles.title, { color: palette.text }]}>DeepTutor</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            {adding
              ? 'Add another DeepTutor account. The one in use stays signed in.'
              : 'Sign in to your DeepTutor server. Your Open WebUI sign-in stays as it is, and you can switch between the two.'}
          </Text>
        </View>

        <View style={styles.form}>
          <TextField
            label="DeepTutor address"
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="https://learn.example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            returnKeyType="next"
          />
          <TextField
            label="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
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
            <Pressable accessibilityRole="button" onPress={accountsSheet.open} hitSlop={8} style={styles.back}>
              <Text style={[styles.backText, { color: palette.link }]}>Use Another Account</Text>
            </Pressable>
          ) : null}
          {/* Either space works on its own: Open WebUI alone needs no DeepTutor account. */}
          {adding ? null : (
          <Pressable accessibilityRole="button" onPress={() =>
              owui.state.status === 'signed-in' ? router.replace('/') : router.replace({ pathname: '/login', params: fromWelcome ? { from: 'welcome' } : {} })
            } hitSlop={8} style={styles.back}>
            <Text style={[styles.backText, { color: palette.link }]}>{owui.state.status === 'signed-in' ? 'Back to Open WebUI' : 'Sign in to Open WebUI instead'}</Text>
          </Pressable>
          )}
        </View>

        <Text style={[styles.footer, { color: palette.textMuted }]}>
          MavieChat is an independent app for Open WebUI and DeepTutor servers and is not affiliated with either.
        </Text>
      </ScrollView>
      {fromWelcome || adding ? (
        <View style={[styles.backButton, { top: insets.top + 4 }]}>
          {adding ? (
            <IconButton icon="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/learn'))} />
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
  subtitle: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  form: { gap: 16 },
  message: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  back: { alignSelf: 'center', paddingVertical: 4 },
  backButton: { position: 'absolute', left: 8 },
  backText: { fontFamily: fonts.medium, fontSize: 15 },
  footer: { marginTop: 'auto', fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
