import type { OwuiClient } from './http';

/** An event the server can announce (`GET /api/events`, admins only). */
export interface EventKind {
  event: string;
  /** Its short name, e.g. "Chat finished". */
  message: string;
  description: string;
}

/** A person or a group whose events a webhook gets. */
export interface EventWebhookTarget {
  type: 'user' | 'group';
  id: string;
}

/**
 * A server-wide webhook (Admin → Settings → General → Events on the web; admins only): the server
 * posts each event it matches to `url`. `targets` null: everyone's events and the server's own;
 * empty: only the server's own (not tied to a person); a list: only events tied to those people,
 * or to people now in those groups.
 */
export interface EventWebhook {
  id: string;
  name: string;
  /** The whole address, secrets in it included: shown only when asked. */
  url: string;
  enabled: boolean;
  /** `*`, exact event names, or patterns such as `user.*`. */
  events: string[];
  targets: EventWebhookTarget[] | null;
}

/** The one the server made from the single webhook address of earlier versions. */
export const DEFAULT_EVENT_WEBHOOK_ID = 'default';

const WEBHOOKS = '/api/events/webhooks';

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function targetsOf(value: unknown): EventWebhookTarget[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) => {
    const row = record(item);
    return (row.type === 'user' || row.type === 'group') && text(row.id) ? [{ type: row.type, id: text(row.id) }] : [];
  });
}

export function eventWebhookOf(raw: unknown): EventWebhook | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const events = Array.isArray(row.events) ? row.events.filter((event): event is string => typeof event === 'string' && event.length > 0) : [];
  return {
    id,
    name: text(row.name),
    url: text(row.url),
    enabled: row.enabled !== false,
    events: events.length ? events : ['*'],
    targets: targetsOf(row.targets),
  };
}

/** Every event the server announces, by name. */
export async function listEventKinds(client: OwuiClient): Promise<EventKind[]> {
  const raw = record(await client.get<unknown>('/api/events')).events;
  return (Array.isArray(raw) ? raw : [])
    .flatMap((item) => {
      const row = record(item);
      return text(row.event) ? [{ event: text(row.event), message: text(row.message), description: text(row.description) }] : [];
    })
    .sort((a, b) => a.event.localeCompare(b.event));
}

/** The server's webhooks, the default first, then by name (as the web lists them). */
export async function listEventWebhooks(client: OwuiClient): Promise<EventWebhook[]> {
  const raw = await client.get<unknown>(WEBHOOKS);
  return (Array.isArray(raw) ? raw : [])
    .flatMap((item) => {
      const webhook = eventWebhookOf(item);
      return webhook ? [webhook] : [];
    })
    .sort((a, b) => (a.id === DEFAULT_EVENT_WEBHOOK_ID ? -1 : b.id === DEFAULT_EVENT_WEBHOOK_ID ? 1 : a.name.localeCompare(b.name)));
}

export type EventWebhookFields = Pick<EventWebhook, 'name' | 'url' | 'enabled' | 'events' | 'targets'>;

/** Adds one; the server checks the address and the events, and names it "Webhook" when it has no name. */
export async function createEventWebhook(client: OwuiClient, fields: EventWebhookFields): Promise<EventWebhook> {
  const body = { name: fields.name.trim(), url: fields.url.trim(), enabled: fields.enabled, events: fields.events.length ? fields.events : ['*'], targets: fields.targets };
  const made = eventWebhookOf(await client.post<unknown>(WEBHOOKS, body));
  if (!made) throw new Error('The server didn’t answer with the webhook');
  return made;
}

/**
 * Changes only what's given; the server keeps the rest as it was. `targets: null` means
 * everyone again, so it's sent as such.
 */
export async function updateEventWebhook(client: OwuiClient, id: string, change: Partial<EventWebhookFields>): Promise<EventWebhook> {
  const body: Record<string, unknown> = {};
  if (change.name !== undefined) body.name = change.name.trim();
  if (change.url !== undefined) body.url = change.url.trim();
  if (change.enabled !== undefined) body.enabled = change.enabled;
  if (change.events !== undefined) body.events = change.events.length ? change.events : ['*'];
  if (change.targets !== undefined) body.targets = change.targets;
  const saved = eventWebhookOf(await client.request<unknown>('PUT', `${WEBHOOKS}/${encodeURIComponent(id)}`, { body }));
  if (!saved) throw new Error('The server didn’t answer with the webhook');
  return saved;
}

/** Deleting the default one also clears the old single webhook address. */
export async function deleteEventWebhook(client: OwuiClient, id: string): Promise<void> {
  await client.delete(`${WEBHOOKS}/${encodeURIComponent(id)}`);
}

/**
 * What's wrong with an event filter, as the server checks it: `*`, an event it announces, or
 * `kind.*` where some event starts with `kind.`; null when it's fine.
 */
export function eventFilterProblem(value: string, known: string[]): string | null {
  const filter = value.trim();
  if (!filter || filter === '*' || known.includes(filter)) return null;
  if (filter.endsWith('.*') && filter.length > 2 && known.some((event) => event.startsWith(filter.slice(0, -1)))) return null;
  return filter.endsWith('.*') ? `No event starts with ${filter.slice(0, -1)}` : `The server has no event called ${filter}`;
}

/** Its events in a few words: all of them, one or two by name, or how many filters. */
export function eventsLine(events: string[]): string {
  if (!events.length || events.includes('*')) return 'All events';
  return events.length <= 2 ? events.join(' + ') : `${events.length} filters`;
}

export type WebhookAudience = 'everyone' | 'server' | 'chosen';

export const audienceOf = (targets: EventWebhookTarget[] | null): WebhookAudience => (targets === null ? 'everyone' : targets.length ? 'chosen' : 'server');

/** Whose events it gets, in a few words. */
export function audienceLine(targets: EventWebhookTarget[] | null): string {
  if (targets === null) return 'Everyone’s and the server’s';
  if (!targets.length) return 'The server’s own only';
  const people = targets.filter((target) => target.type === 'user').length;
  const groups = targets.filter((target) => target.type === 'group').length;
  return [people ? `${people} ${people === 1 ? 'person' : 'people'}` : '', groups ? `${groups} ${groups === 1 ? 'group' : 'groups'}` : ''].filter(Boolean).join(' + ');
}

/** The address's host, which is all the list shows of it. */
export function webhookHost(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url.trim());
  return match?.[1] ?? (url.trim() ? 'An address that isn’t a web address' : 'No address');
}

export const webhookName = (webhook: Pick<EventWebhook, 'id' | 'name'>): string => webhook.name || (webhook.id === DEFAULT_EVENT_WEBHOOK_ID ? 'Default webhook' : 'Webhook');
