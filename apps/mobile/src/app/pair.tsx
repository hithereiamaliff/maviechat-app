import { parsePairingLink } from '@maviechat/opencode-protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AvoidKeyboard } from '@/components/AvoidKeyboard';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { TextField } from '@/components/TextField';
import { describeOcError } from '@/features/opencode/errors';
import { DEVICE } from '@/lib/device';
import { serverHost } from '@/session/accounts';
import { useOpenCode } from '@/session/OpenCodeProvider';
import { useSession } from '@/session/SessionProvider';
import { saveSpace } from '@/session/storage';
import { fonts, usePalette } from '@/theme';

type Message = { tone: 'error' | 'info'; text: string };

/**
 * Pairs this iPhone with a machine's OpenCode, from the link `maviechat-gateway pair` prints
 * (opened here or pasted) or its address and code. A link never pairs without your tap.
 */
export default function Pair() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ url?: string; code?: string }>();
  const { state, pair } = useOpenCode();
  const owuiSignedIn = useSession().state.status === 'signed-in';
  const fromLink = Boolean(params.url && params.code);
  const [link, setLink] = useState('');
  const [url, setUrl] = useState(params.url ?? '');
  const [code, setCode] = useState(params.code ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(() => (state.status === 'signed-out' && state.notice ? { tone: 'info', text: state.notice } : null));

  const submit = async () => {
    const target = parsePairingLink(link) ?? (url.trim() && code.trim() ? { url: url.trim().replace(/\/+$/, ''), code: code.trim() } : null);
    if (!target) {
      setMessage({ tone: 'error', text: 'Paste the pairing link, or enter the machine’s address and code.' });
      return;
    }
    if (!/^https:\/\//i.test(target.url)) {
      setMessage({ tone: 'error', text: 'The address must start with https://.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await pair(target);
      await saveSpace('opencode');
      router.replace('/code');
    } catch (error) {
      setMessage({ tone: 'error', text: describeOcError(error) });
    } finally {
      setBusy(false);
    }
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace(owuiSignedIn ? '/' : '/welcome'));

  return (
    <AvoidKeyboard style={styles.flex}>
      <ScrollView
        style={{ backgroundColor: palette.background }}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]}>OpenCode</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            {fromLink ? `Pair this ${DEVICE} with ${serverHost(params.url ?? '')}? Only do this for a machine you run.` : `Pair this ${DEVICE} with a machine that runs OpenCode and the MavieChat gateway.`}
          </Text>
        </View>

        <View style={styles.form}>
          {fromLink ? null : (
            <>
              <Text style={[styles.help, { color: palette.textMuted }]}>
                {'On the machine, run `maviechat-gateway pair` (with Docker: `docker exec -it maviechat-gateway maviechat-gateway pair`). Open the link it prints on this ' + DEVICE + ', or paste it here.'}
              </Text>
              <TextField label="Pairing link" value={link} onChangeText={setLink} placeholder="maviechat://pair?…" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
              <Text style={[styles.or, { color: palette.textFaint }]}>or</Text>
              <TextField label="Machine address" value={url} onChangeText={setUrl} placeholder="https://code.example.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL" />
              <TextField label="Pairing code" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} returnKeyType="go" onSubmitEditing={() => void submit()} />
            </>
          )}
          {message ? (
            <Text accessibilityLiveRegion="polite" style={[styles.message, { color: message.tone === 'error' ? palette.danger : palette.textMuted }]}>
              {message.text}
            </Text>
          ) : null}
          <Button label={fromLink ? 'Pair' : 'Pair Machine'} onPress={() => void submit()} loading={busy} />
        </View>

        <Text style={[styles.footer, { color: palette.textMuted }]}>
          The machine keeps OpenCode’s own password; this {DEVICE} gets its own key, which you can revoke there at any time.
        </Text>
      </ScrollView>
      <View style={[styles.back, { top: insets.top + 4 }]}>
        <IconButton icon="chevron-left" label="Back" onPress={back} />
      </View>
    </AvoidKeyboard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24, gap: 28 },
  header: { gap: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 28 },
  subtitle: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  form: { gap: 14 },
  help: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  or: { fontFamily: fonts.regular, fontSize: 13, textAlign: 'center' },
  message: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  footer: { marginTop: 'auto', fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  back: { position: 'absolute', left: 8 },
});
