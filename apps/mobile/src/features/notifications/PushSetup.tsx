import { useEffect } from 'react';
import { useSession } from '@/session/SessionProvider';
import { setUpPushOnLaunch } from './push';

/**
 * In each space: switches notifications on (asking once) and keeps the token and the Open WebUI
 * registration fresh. In DeepTutor, Open WebUI may not be signed in; DeepTutor's replies need only the token.
 */
export function PushSetup() {
  const { state, client } = useSession();
  const session = state.status === 'signed-in' ? state.session : null;
  const loading = state.status === 'loading';
  useEffect(() => {
    if (loading) return;
    // Failures show in Settings → General; nothing here interrupts you.
    setUpPushOnLaunch(session && client ? { client, session } : null).catch(() => undefined);
  }, [client, session, loading]);
  return null;
}
