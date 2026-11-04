import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { signOutWebView } from '@/features/deeptutor/webSignIn';
import { leaveRelay } from '@/features/notifications/push';
import { serverHost, type AccountEntry, type AccountSpace } from '@/session/accounts';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { saveSpace } from '@/session/storage';
import { fonts, radius, usePalette } from '@/theme';

const SPACES = {
  owui: { title: 'Open WebUI Accounts', home: '/', signIn: '/login' },
  deeptutor: { title: 'DeepTutor Accounts', home: '/learn', signIn: '/deeptutor-login' },
} as const;

/**
 * Signing out of one Open WebUI account: it leaves the notification relay first (while its token
 * still works), then the server revokes the token. True when an account is in use afterwards.
 */
export function useOwuiAccountSignOut(): (id: string) => Promise<boolean> {
  const owui = useSession();
  return async (id) => {
    const stored = await owui.accountSession(id);
    if (stored) await leaveRelay(stored).catch(() => undefined);
    return owui.removeAccount(id);
  };
}

/** A space's accounts in a sheet: switch between them, add one, or sign out of any. */
export function useAccountsSheet(space: AccountSpace) {
  const [visible, setVisible] = useState(false);
  const element = (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVisible(false)}>
      {visible ? <AccountsList space={space} onClose={() => setVisible(false)} /> : null}
    </Modal>
  );
  return { open: () => setVisible(true), element };
}

function AccountsList({ space, onClose }: { space: AccountSpace; onClose: () => void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const owui = useSession();
  const deepTutor = useDeepTutor();
  const owuiSignOut = useOwuiAccountSignOut();
  const source = space === 'owui' ? owui : deepTutor;
  const activeId = source.state.status === 'signed-in' ? source.state.accountId : null;
  const where = SPACES[space];
  const [busy, setBusy] = useState<string | null>(null);

  /** Back to the space's first screen as the account now in use, or to its sign-in. */
  const goTo = (path: string) => {
    void saveSpace(space);
    if (router.canDismiss()) router.dismissAll();
    router.replace(path);
  };

  const choose = async (entry: AccountEntry) => {
    if (entry.id === activeId) {
      onClose();
      return;
    }
    setBusy(entry.id);
    try {
      // A DeepTutor page on screen keeps its own sign-in cookie.
      if (space === 'deeptutor') signOutWebView();
      const result = await source.switchAccount(entry.id);
      onClose();
      goTo(result === 'switched' ? where.home : where.signIn);
    } catch {
      toast("Couldn't switch accounts. Try again.", 'error');
    } finally {
      setBusy(null);
    }
  };

  const signOutOf = (entry: AccountEntry) =>
    Alert.alert(`Sign out of ${entry.login}?`, 'MavieChat forgets this account on this iPhone. You can add it again later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            const wasActive = entry.id === activeId;
            setBusy(entry.id);
            try {
              if (space === 'deeptutor' && wasActive) signOutWebView();
              const stillIn = space === 'owui' ? await owuiSignOut(entry.id) : await deepTutor.removeAccount(entry.id);
              if (!wasActive) return;
              onClose();
              if (stillIn) goTo(where.home);
              // No DeepTutor account left: back to Open WebUI, or the welcome screen.
              else if (space === 'deeptutor') goTo(owui.state.status === 'signed-in' ? '/' : '/welcome');
            } catch {
              toast("Couldn't sign out. Try again.", 'error');
            } finally {
              setBusy(null);
            }
          })(),
      },
    ]);

  const add = () => {
    onClose();
    router.push({ pathname: where.signIn, params: { add: '1' } });
  };

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background, paddingBottom: insets.bottom + 16 }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {where.title}
        </Text>
        <IconButton icon="x-mark" label="Close" onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {source.accounts.map((entry) => {
          const active = entry.id === activeId;
          const host = serverHost(entry.baseUrl);
          return (
            <View key={entry.id} style={[styles.row, { borderColor: active ? palette.link : palette.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active, busy: busy === entry.id }}
                accessibilityLabel={`${entry.name}, ${space === 'owui' ? `${entry.login}, ` : ''}${host}${entry.signedIn ? '' : ', signed out'}${active ? ', in use' : ''}`}
                onPress={() => void choose(entry)}
                disabled={busy !== null}
                style={styles.main}>
                <View style={[styles.initial, { backgroundColor: palette.surface }]}>
                  <Text style={[styles.initialText, { color: palette.text }]}>{(entry.name.trim()[0] ?? '?').toUpperCase()}</Text>
                </View>
                <View style={styles.text}>
                  <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                    {entry.name}
                  </Text>
                  <Text style={[styles.detail, { color: palette.textMuted }]} numberOfLines={1}>
                    {space === 'owui' ? `${entry.login} · ${host}` : host}
                  </Text>
                  {!entry.signedIn ? <Text style={[styles.detail, { color: palette.textFaint }]}>Signed out: tap to sign in again</Text> : null}
                </View>
                {busy === entry.id ? <ActivityIndicator color={palette.textMuted} /> : active ? <Icon name="check" size={20} color={palette.link} strokeWidth={2} /> : null}
              </Pressable>
              <IconButton icon="arrow-right-start-on-rectangle" label={`Sign out of ${entry.login}`} onPress={() => signOutOf(entry)} />
            </View>
          );
        })}
        <Pressable accessibilityRole="button" onPress={add} disabled={busy !== null} style={[styles.add, { borderColor: palette.border }]}>
          <Icon name="plus" size={18} color={palette.link} strokeWidth={2} />
          <Text style={[styles.addText, { color: palette.link }]}>Add Account</Text>
        </Pressable>
        <Text style={[styles.note, { color: palette.textFaint }]}>
          {space === 'owui'
            ? 'Each account keeps its own chats and settings. Accounts on servers run by TechMavie Digital all get notifications.'
            : 'Each account keeps its own sessions and settings.'}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  list: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingRight: 4 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 12 },
  initial: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  initialText: { fontFamily: fonts.semibold, fontSize: 15 },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.medium, fontSize: 15 },
  detail: { fontFamily: fonts.regular, fontSize: 13 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, borderStyle: 'dashed' },
  addText: { fontFamily: fonts.medium, fontSize: 15 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginTop: 6, marginHorizontal: 4 },
});
