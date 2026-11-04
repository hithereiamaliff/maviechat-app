import { useEffect } from 'react';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { setUpPushOnLaunch } from './push';

/**
 * In each space: switches notifications on (asking once) and keeps the token and the Open WebUI
 * registration fresh, when a signed-in server is one the relay serves. In DeepTutor, Open WebUI
 * may not be signed in; DeepTutor's replies need only the token.
 */
export function PushSetup() {
  const { state, client } = useSession();
  const deepTutor = useDeepTutor().state;
  const session = state.status === 'signed-in' ? state.session : null;
  const deepTutorBaseUrl = deepTutor.status === 'signed-in' ? deepTutor.session.baseUrl : null;
  const loading = state.status === 'loading' || deepTutor.status === 'loading';
  useEffect(() => {
    if (loading) return;
    // Failures show in Settings → General; nothing here interrupts you.
    setUpPushOnLaunch(session && client ? { client, session } : null, deepTutorBaseUrl).catch(() => undefined);
  }, [client, session, deepTutorBaseUrl, loading]);
  return null;
}
