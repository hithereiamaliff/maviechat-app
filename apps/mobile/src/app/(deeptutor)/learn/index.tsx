import { router } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';
import { IconButton } from '@/components/IconButton';
import { MenuButton } from '@/components/Menu';
import { hostOf } from '@/features/deeptutor/crossReference';
import { SessionList } from '@/features/deeptutor/SessionList';
import { SpaceHeader } from '@/features/deeptutor/SpaceHeader';
import { switchToOpenWebUI } from '@/features/deeptutor/switch';
import { useDeepTutor, useDtAuthed } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { saveSpace } from '@/session/storage';

/** The DeepTutor space's home: your DeepTutor chats, newest first, and a new chat. */
export default function DeepTutorHome() {
  const { session } = useDtAuthed();
  const { signOut } = useDeepTutor();
  const owuiSignedIn = useSession().state.status === 'signed-in';

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
          <>
            <IconButton icon="pencil-square" label="New chat" onPress={() => router.push('/learn/new')} />
            <MenuButton
              label="DeepTutor options"
              items={[
                { key: 'web', label: 'DeepTutor Web App', icon: 'globe-alt', onPress: () => router.push('/learn/web') },
                ...(owuiSignedIn ? [{ key: 'switch', label: 'Switch to Open WebUI', icon: 'arrows-right-left' as const, onPress: switchToOpenWebUI }] : []),
                { key: 'signout', label: 'Sign out of DeepTutor', icon: 'arrow-right-start-on-rectangle', destructive: true, onPress: confirmSignOut },
              ]}
            />
          </>
        }
      />
      <SessionList
        rowHint="Opens the chat"
        empty="No DeepTutor chats yet. Start one with the New Chat button at the top."
        onOpen={(item) => router.push({ pathname: '/learn/[id]', params: { id: item.id } })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
