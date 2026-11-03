import { router } from 'expo-router';
import { Alert } from 'react-native';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { saveSpace } from '@/session/storage';
import { signOutWebView } from './webSignIn';

/** Signing out of DeepTutor, after asking: Open WebUI stays signed in, and the app goes there (or to DeepTutor's sign-in). */
export function useDtSignOut(): () => void {
  const { signOut } = useDeepTutor();
  const owuiSignedIn = useSession().state.status === 'signed-in';
  return () =>
    Alert.alert('Sign out of DeepTutor?', 'Your Open WebUI sign-in stays as it is.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          // A DeepTutor page on screen keeps its own cookie, so it signs out too.
          signOutWebView();
          void signOut().then(() => {
            void saveSpace('owui');
            if (router.canDismiss()) router.dismissAll();
            router.replace(owuiSignedIn ? '/' : '/deeptutor-login');
          });
        },
      },
    ]);
}
