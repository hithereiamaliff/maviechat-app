import { router } from 'expo-router';
import { saveSpace } from '@/session/storage';

/** Opens the DeepTutor space (or its sign-in) and makes it the one a launch returns to. */
export function switchToDeepTutor(signedIn: boolean): void {
  if (signedIn) void saveSpace('deeptutor');
  router.replace(signedIn ? '/learn' : '/deeptutor-login');
}

/** Back to Open WebUI's new-chat screen, which a launch then returns to. */
export function switchToOpenWebUI(): void {
  void saveSpace('owui');
  router.replace('/');
}
