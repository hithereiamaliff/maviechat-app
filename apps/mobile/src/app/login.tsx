import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { describeSignInError } from '@/session/errors';
import { useSession } from '@/session/SessionProvider';
import { fonts, usePalette } from '@/theme';

type Message = { tone: 'error' | 'info'; text: string };

export default function Login() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { state, signIn } = useSession();
  const [serverUrl, setServerUrl] = useState(() => (state.status === 'signed-out' ? (state.lastServerUrl ?? '') : ''));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(() =>
    state.status === 'signed-out' && state.notice ? { tone: 'info', text: state.notice } : null,
  );

  if (state.status === 'signed-in') return <Redirect href="/home" />;

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
        router.replace('/home');
        return;
      }
      setMessage({
        tone: 'info',
        text:
          outcome.kind === 'pending'
            ? 'Your account is waiting for an administrator to approve it. Try again once it has been approved.'
            : 'This server asks for a two-step sign-in code, which MavieChat does not support yet. Use an account without two-step sign-in for now.',
      });
    } catch (error) {
      setMessage({ tone: 'error', text: describeSignInError(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ backgroundColor: palette.background }}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]}>MavieChat</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>Sign in to your Open WebUI server.</Text>
        </View>

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

          <Button label="Sign in" onPress={() => void submit()} loading={busy} />
        </View>

        <Text style={[styles.footer, { color: palette.textMuted }]}>
          MavieChat is an independent app for Open WebUI servers and is not affiliated with Open WebUI.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
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
  footer: { marginTop: 'auto', fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
