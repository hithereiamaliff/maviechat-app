import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { IconButton } from '@/components/IconButton';
import { MenuButton } from '@/components/Menu';
import { hostOf } from '@/features/deeptutor/crossReference';
import { SessionList } from '@/features/deeptutor/SessionList';
import { SpaceHeader } from '@/features/deeptutor/SpaceHeader';
import { switchToOpenWebUI } from '@/features/deeptutor/switch';
import { useDeepTutor, useDtAuthed } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { saveSpace } from '@/session/storage';
import { fonts, radius, usePalette } from '@/theme';

/**
 * The DeepTutor space. Until the in-app web view arrives (store build 3) it lists your
 * DeepTutor chats here, and the full workspace opens in the browser.
 */
export default function DeepTutorHome() {
  const palette = usePalette();
  const { session } = useDtAuthed();
  const { signOut } = useDeepTutor();
  const owui = useSession();
  const owuiSignedIn = owui.state.status === 'signed-in';

  const confirmSignOut = () =>
    Alert.alert('Sign out of DeepTutor?', 'Your Open WebUI sign-in stays as it is.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () =>
          void signOut().then(() => {
            void saveSpace('owui');
            router.replace(owuiSignedIn ? '/' : '/deeptutor-login');
          }),
      },
    ]);

  return (
    <View style={styles.screen}>
      <SpaceHeader
        leading={owuiSignedIn ? <IconButton icon="arrows-right-left" label="Switch to Open WebUI" onPress={switchToOpenWebUI} /> : null}
        title="DeepTutor"
        subtitle={`${session.account.username} · ${hostOf(session.baseUrl)}`}
        trailing={
          <MenuButton
            label="DeepTutor options"
            items={[
              { key: 'open', label: 'Open DeepTutor', icon: 'globe-alt', onPress: () => void WebBrowser.openBrowserAsync(session.baseUrl) },
              ...(owuiSignedIn ? [{ key: 'switch', label: 'Switch to Open WebUI', icon: 'arrows-right-left' as const, onPress: switchToOpenWebUI }] : []),
              { key: 'signout', label: 'Sign out of DeepTutor', icon: 'arrow-right-start-on-rectangle', destructive: true, onPress: confirmSignOut },
            ]}
          />
        }
      />
      <SessionList
        rowHint="Opens the chat"
        empty="No DeepTutor chats yet. Open DeepTutor from the menu to start one."
        onOpen={(item) => router.push({ pathname: '/learn/[id]', params: { id: item.id } })}
        header={
          <View style={[styles.note, { backgroundColor: palette.surface }]}>
            <Text style={[styles.noteText, { color: palette.textMuted }]}>
              Your DeepTutor chats. Open one to read it or to ask about it in Open WebUI. The full DeepTutor workspace opens in
              the browser for now (sign in there once); it moves into the app with the next app build.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  note: { marginHorizontal: 16, marginTop: 10, padding: 12, borderRadius: radius.md },
  noteText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
