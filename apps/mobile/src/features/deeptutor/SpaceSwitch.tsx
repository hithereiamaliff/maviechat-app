import { IconButton } from '@/components/IconButton';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { switchToDeepTutor, switchToOpenWebUI } from './switch';

/** Top left in Open WebUI: over to DeepTutor, once you're signed in there. */
export function SwitchToDeepTutorButton() {
  const signedIn = useDeepTutor().state.status === 'signed-in';
  return signedIn ? <IconButton icon="arrows-right-left" label="Switch to DeepTutor" onPress={() => switchToDeepTutor(true)} /> : null;
}

/** Top left in DeepTutor: over to Open WebUI, once you're signed in there. */
export function SwitchToOpenWebUIButton() {
  const signedIn = useSession().state.status === 'signed-in';
  return signedIn ? <IconButton icon="arrows-right-left" label="Switch to Open WebUI" onPress={switchToOpenWebUI} /> : null;
}
