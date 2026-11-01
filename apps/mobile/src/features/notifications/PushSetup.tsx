import { useEffect } from 'react';
import { useAuthed, useCapabilities } from '@/lib/server';
import { setUpPushOnLaunch } from './push';

/**
 * Inside the signed-in Open WebUI space: switches notifications on (asking once) and keeps the
 * link fresh, for accounts Open WebUI lets use webhooks.
 */
export function PushSetup() {
  const { client, session } = useAuthed();
  // Only admins and accounts with "User Webhooks" can save a notification target; others aren't asked.
  const allowed = useCapabilities()?.feature('userWebhooks') ?? false;
  useEffect(() => {
    if (!allowed) return;
    // Failures show in Settings → General; nothing here interrupts you.
    setUpPushOnLaunch(client, session).catch(() => undefined);
  }, [allowed, client, session]);
  return null;
}
