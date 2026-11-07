import { router } from 'expo-router';
import { Alert } from 'react-native';
import { DEVICE } from '@/lib/device';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { saveSpace } from '@/session/storage';
import { signOutWebView } from './webSignIn';

/**
 * Signing out of the DeepTutor account in use, after asking. Another DeepTutor account still signed
 * in takes over; with none left, the app goes to Open WebUI (or the welcome screen).
 */
export function useDtSignOut(): () => void {
  const { signOut, state } = useDeepTutor();
  const who = state.status === 'signed-in' ? state.session.account.username : 'DeepTutor';
  const owuiSignedIn = useSession().state.status === 'signed-in';
  return () =>
    Alert.alert(`Sign out of ${who}?`, `MavieChat forgets this DeepTutor account on this ${DEVICE}. Your Open WebUI sign-in stays as it is.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          // A DeepTutor page on screen keeps its own cookie, so it signs out too.
          signOutWebView();
          void signOut().then((stillIn) => {
            if (router.canDismiss()) router.dismissAll();
            if (stillIn) {
              router.replace('/learn');
              return;
            }
            void saveSpace('owui');
            router.replace(owuiSignedIn ? '/' : '/welcome');
          });
        },
      },
    ]);
}
