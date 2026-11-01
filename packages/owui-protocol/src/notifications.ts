import type { OwuiClient } from './http';

/**
 * A notification target in your Open WebUI settings (`/api/v1/notifications/targets`, 0.11.x).
 * The server masks the webhook address when listing (`config.url_masked`).
 */
export interface NotificationTarget {
  id: string;
  type: string;
  enabled: boolean;
  events: string[];
  /** `away`: only when you have been inactive for three minutes; `always`: every time. */
  delivery: 'away' | 'always' | string;
  config?: { url_masked?: string; [key: string]: unknown };
  is_default?: boolean;
  [key: string]: unknown;
}

/** The events MavieChat asks for: a reply finished, or failed. */
export const CHAT_NOTIFICATION_EVENTS = ['chat.finished', 'chat.failed'];

const TARGETS = '/api/v1/notifications/targets';

/**
 * Your targets. The server answers 404 when its admin turned user webhooks off, and 403
 * when your account may not use them.
 */
export async function listNotificationTargets(client: OwuiClient): Promise<NotificationTarget[]> {
  return (await client.get<{ targets?: NotificationTarget[] }>(TARGETS)).targets ?? [];
}

/** Creates the webhook target with this id, or points the existing one at `url`. */
export async function saveWebhookTarget(
  client: OwuiClient,
  target: { id: string; url: string; events?: string[]; delivery?: 'away' | 'always' },
): Promise<NotificationTarget> {
  const body = {
    type: 'webhook',
    enabled: true,
    events: target.events ?? CHAT_NOTIFICATION_EVENTS,
    delivery: target.delivery ?? 'always',
    config: { url: target.url },
  };
  const exists = (await listNotificationTargets(client)).some((item) => item.id.toLowerCase() === target.id.toLowerCase());
  return exists
    ? client.request<NotificationTarget>('PUT', `${TARGETS}/${encodeURIComponent(target.id)}`, { body })
    : client.post<NotificationTarget>(TARGETS, { id: target.id, ...body });
}

export async function deleteNotificationTarget(client: OwuiClient, id: string): Promise<void> {
  await client.delete(`${TARGETS}/${encodeURIComponent(id)}`);
}

/** Asks the server to call the target once (Open WebUI's "test" event). */
export async function testNotificationTarget(client: OwuiClient, id: string): Promise<void> {
  await client.post(`${TARGETS}/${encodeURIComponent(id)}/test`);
}
