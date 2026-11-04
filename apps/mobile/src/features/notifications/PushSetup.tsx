import { useEffect } from 'react';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { owuiAccountOf, setUpPushOnLaunch } from './push';

/**
 * In each space: switches notifications on (asking once) and keeps the token and every Open
 * WebUI account's registration fresh, when a signed-in server is one the relay serves. It runs
 * again when an account is added, removed or signs in again. In DeepTutor, Open WebUI may not be
 * signed in; DeepTutor's replies need only the token.
 */
export function PushSetup() {
  const { state, signedInSessions } = useSession();
  const deepTutor = useDeepTutor().state;
  const deepTutorBaseUrl = deepTutor.status === 'signed-in' ? deepTutor.session.baseUrl : null;
  const loading = state.status === 'loading' || deepTutor.status === 'loading';
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    // Failures show in Settings → General; nothing here interrupts you.
    signedInSessions()
      .then((sessions) => (cancelled ? undefined : setUpPushOnLaunch(sessions.map(owuiAccountOf), deepTutorBaseUrl)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [signedInSessions, deepTutorBaseUrl, loading]);
  return null;
}
