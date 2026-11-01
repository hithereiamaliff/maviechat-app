import { OwuiHttpError } from '@maviechat/owui-protocol';

/** MavieChat's push relay (services/push-relay): turns Open WebUI's events into notifications. */
export const PUSH_RELAY_URL = 'https://push.techmavie.digital';

/** The name of the per-phone Open WebUI target earlier app versions saved (removed now). */
export function legacyTargetId(deviceId: string): string {
  return `maviechat-${deviceId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toLowerCase()}`;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface RelayAnswer {
  /** When Open WebUI last sent the relay an event; null means its admin hasn't added the webhook yet. */
  lastEventAt: number | null;
}

async function call(fetchImpl: Fetch, method: 'POST' | 'DELETE', path: string, owuiToken: string, pushToken: string, relayUrl: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(`${relayUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${owuiToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ pushToken }),
    });
  } catch {
    throw new Error("couldn't reach the notification service");
  }
  const body = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined;
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `the notification service answered ${response.status}`);
  return body ?? {};
}

const lastEvent = (body: Record<string, unknown>): RelayAnswer => ({ lastEventAt: typeof body.lastEventAt === 'number' ? body.lastEventAt : null });

/** Adds this phone under your Open WebUI account; the relay checks the sign-in once and keeps only ids and tokens. */
export async function registerWithRelay(fetchImpl: Fetch, owuiToken: string, pushToken: string, relayUrl = PUSH_RELAY_URL): Promise<RelayAnswer> {
  return lastEvent(await call(fetchImpl, 'POST', '/v1/devices', owuiToken, pushToken, relayUrl));
}

export async function unregisterFromRelay(fetchImpl: Fetch, owuiToken: string, pushToken: string, relayUrl = PUSH_RELAY_URL): Promise<void> {
  await call(fetchImpl, 'DELETE', '/v1/devices', owuiToken, pushToken, relayUrl);
}

/** A test notification to this phone, straight from the relay. */
export async function testThroughRelay(fetchImpl: Fetch, owuiToken: string, pushToken: string, relayUrl = PUSH_RELAY_URL): Promise<RelayAnswer> {
  return lastEvent(await call(fetchImpl, 'POST', '/v1/devices/test', owuiToken, pushToken, relayUrl));
}

/** Why notifications couldn't be switched on, in words. */
export function describePushError(error: unknown): string {
  if (error instanceof OwuiHttpError) return error.detail ?? `Open WebUI answered ${error.status}.`;
  return error instanceof Error ? `Notifications couldn't be set up: ${error.message}.` : "Notifications couldn't be set up.";
}
