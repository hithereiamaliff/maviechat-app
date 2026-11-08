import { OwuiClient, pendingNotice, signInWithToken, signOut, type Session } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Markdown } from '@/markdown/Markdown';
import { describeSignInError } from '@/session/errors';
import { useSession, type SignInOutcome } from '@/session/SessionProvider';
import { fonts, radius, usePalette } from '@/theme';

/**
 * What an account waiting for an administrator's approval sees (the web's waiting screen): the
 * admin's own title and text where the server has them (it shows them only to the account, so
 * they're read with its session), else the app's words; the admin's contact where the server
 * shares it; Check Again and Sign Out. With no session (0.12 with two-step sign-in on), Check
 * Again signs in again the way it was done.
 */
export function PendingScreen({ baseUrl, session, retry, onBack }: { baseUrl: string; session: Session | null; retry: () => Promise<SignInOutcome>; onBack: (message?: string) => void }) {
  const palette = usePalette();
  const { finishSignIn } = useSession();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const notice = useQuery({
    queryKey: ['pending-notice', baseUrl, session?.token ?? ''],
    queryFn: () => pendingNotice(new OwuiClient({ baseUrl, token: session?.token ?? null })),
    enabled: session !== null,
    staleTime: 60_000,
    gcTime: 0,
  });
  const title = notice.data?.title || 'Waiting for approval';
  const content = notice.data?.content || 'An administrator needs to approve your account before you can use this server. Once they have, tap Check Again.';
  const admin = notice.data?.admin ?? null;

  const check = async () => {
    setBusy(true);
    setNote(null);
    try {
      const outcome = session ? await finishSignIn(baseUrl, await signInWithToken(new OwuiClient({ baseUrl }), session.token)) : await retry();
      if (outcome.kind === 'signed-in') router.replace('/');
      else if (outcome.kind === 'pending') setNote('Still waiting: your account hasn’t been approved yet.');
      else onBack('Sign in again to finish.');
    } catch (error) {
      setNote(describeSignInError(error));
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    // The pending session is ended on the server too.
    if (session) void signOut(new OwuiClient({ baseUrl, token: session.token })).catch(() => undefined);
    onBack();
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
        {title}
      </Text>
      <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
        <Markdown text={content} />
      </View>
      {admin ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`mailto:${admin.email}`)} hitSlop={6}>
          <Text style={[styles.admin, { color: palette.textMuted }]}>
            {'Your admin: '}
            <Text style={{ color: palette.link }}>{admin.name ? `${admin.name} (${admin.email})` : admin.email}</Text>
          </Text>
        </Pressable>
      ) : null}
      {note ? (
        <Text accessibilityLiveRegion="polite" style={[styles.note, { color: palette.textMuted }]}>
          {note}
        </Text>
      ) : null}
      <Button label="Check Again" onPress={() => void check()} loading={busy} />
      <Button label="Sign Out" variant="secondary" onPress={leave} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  title: { fontFamily: fonts.semibold, fontSize: 20 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 14 },
  admin: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
});
