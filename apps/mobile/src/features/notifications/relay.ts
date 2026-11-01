import { OwuiHttpError } from '@maviechat/owui-protocol';

/** MavieChat's push relay (services/push-relay): turns Open WebUI's webhooks into notifications. */
export const PUSH_RELAY_URL = 'https://push.techmavie.digital';

/** One notification target per phone, so two phones never overwrite each other. */
export function targetIdFor(deviceId: string): string {
  return `maviechat-${deviceId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toLowerCase()}`;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Trades this phone's Expo push token for a webhook link. The relay checks the Open WebUI
 * sign-in once and keeps nothing; the link itself carries the sealed push token.
 */
export async function registerWithRelay(fetchImpl: Fetch, owuiToken: string, pushToken: string, relayUrl = PUSH_RELAY_URL): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(`${relayUrl}/v1/devices`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${owuiToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ pushToken }),
    });
  } catch {
    throw new Error("couldn't reach the notification service");
  }
  const body = (await response.json().catch(() => undefined)) as { webhookUrl?: unknown; error?: unknown } | undefined;
  if (!response.ok || typeof body?.webhookUrl !== 'string') {
    throw new Error(typeof body?.error === 'string' ? body.error : `the notification service answered ${response.status}`);
  }
  return body.webhookUrl;
}

/** The server's admin switched user webhooks off (Admin Panel → Settings). */
export const WEBHOOKS_OFF = 'Notifications need user webhooks, and this Open WebUI server has them turned off.';

/** The account lacks the "User Webhooks" permission (admins always have it). */
export const WEBHOOKS_NOT_ALLOWED =
  'Notifications need the User Webhooks permission, which this Open WebUI account doesn\'t have. Sign in with an admin account, or turn on User Webhooks for it in Open WebUI: Admin Panel → Users → Groups (Default permissions, or its group).';

/** Why notifications can't be switched on, in words. */
export function describePushError(error: unknown): string {
  if (error instanceof OwuiHttpError) {
    if (error.status === 404) return WEBHOOKS_OFF;
    if (error.status === 403) return WEBHOOKS_NOT_ALLOWED;
    return error.detail ?? `Open WebUI answered ${error.status}.`;
  }
  return error instanceof Error ? `Notifications couldn't be set up: ${error.message}.` : "Notifications couldn't be set up.";
}
