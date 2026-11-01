import { useEffect } from 'react';
import { useAuthed } from '@/lib/server';
import { setUpPushOnLaunch } from './push';

/** Inside the signed-in Open WebUI space: switches notifications on (asking once) and keeps the link fresh. */
export function PushSetup() {
  const { client, session } = useAuthed();
  useEffect(() => {
    // Failures show in Settings → General; nothing here interrupts you.
    setUpPushOnLaunch(client, session).catch(() => undefined);
  }, [client, session]);
  return null;
}
