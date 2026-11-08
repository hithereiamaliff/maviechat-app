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

/** Something that happens on the server that a target can be told about. */
export interface NotificationEvent {
  event: string;
  label: string;
  description: string;
}

/** What the web shows when the server's own list can't be read. */
export const FALLBACK_NOTIFICATION_EVENTS: NotificationEvent[] = [
  { event: 'chat.finished', label: 'Chat finished', description: 'A reply finished.' },
  { event: 'chat.failed', label: 'Chat failed', description: 'A reply failed.' },
];

/** The events a target can follow, as the server lists them (0.12 adds automation runs). */
export async function listNotificationEvents(client: OwuiClient): Promise<NotificationEvent[]> {
  try {
    const answer = await client.get<{ events?: unknown } | unknown[]>(`/api/v1/notifications/events`);
    const raw = Array.isArray(answer) ? answer : (answer as { events?: unknown }).events;
    const events = (Array.isArray(raw) ? raw : []).flatMap((item) => {
      const row = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
      if (typeof row.event !== 'string' || !row.event) return [];
      return [{ event: row.event, label: typeof row.label === 'string' && row.label ? row.label : row.event, description: typeof row.description === 'string' ? row.description : '' }];
    });
    return events.length ? events : FALLBACK_NOTIFICATION_EVENTS;
  } catch {
    return FALLBACK_NOTIFICATION_EVENTS;
  }
}

/** A target as you change it. A field left out stays as it is; an address left out keeps the saved one. */
export interface NotificationTargetChange {
  /** Its name, which the notify tool can use. A new one with none is named after the address. */
  id?: string;
  enabled?: boolean;
  events?: string[];
  delivery?: 'away' | 'always';
  url?: string;
}

function targetBody(change: NotificationTargetChange): Record<string, unknown> {
  const id = change.id?.trim();
  const url = change.url?.trim();
  return {
    ...(id ? { id } : {}),
    type: 'webhook',
    ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
    ...(change.events ? { events: change.events } : {}),
    ...(change.delivery ? { delivery: change.delivery } : {}),
    ...(url ? { config: { url } } : {}),
  };
}

/** Adds a webhook target; the server checks the address and answers with the target, its address masked. */
export function createNotificationTarget(client: OwuiClient, change: NotificationTargetChange & { url: string }): Promise<NotificationTarget> {
  return client.post<NotificationTarget>(TARGETS, { enabled: true, ...targetBody(change) });
}

/** Changes a target (renamed when `id` differs; the default follows it). */
export function updateNotificationTarget(client: OwuiClient, id: string, change: NotificationTargetChange): Promise<NotificationTarget> {
  return client.request<NotificationTarget>('PUT', `${TARGETS}/${encodeURIComponent(id)}`, { body: targetBody(change) });
}

/** The target the notify tool uses when it names none. */
export function setDefaultNotificationTarget(client: OwuiClient, id: string): Promise<NotificationTarget> {
  return client.request<NotificationTarget>('PUT', `${TARGETS}/${encodeURIComponent(id)}/default`);
}

/** The target's address as the server shows it: scheme, host and the end of the path. */
export const maskedTargetUrl = (target: NotificationTarget): string => (typeof target.config?.url_masked === 'string' ? target.config.url_masked : '');

/** Its events by name, and when they go out; or that none do by themselves. */
export function targetEventsLine(target: NotificationTarget, events: NotificationEvent[]): string {
  const names = target.events.map((event) => events.find((item) => item.event === event)?.label ?? event);
  if (!names.length) return 'No automatic events';
  return `${names.join(', ')} · ${target.delivery === 'always' ? 'Always' : 'Only when away'}`;
}
