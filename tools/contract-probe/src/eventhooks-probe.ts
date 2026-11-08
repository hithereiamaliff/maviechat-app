import {
  createEventWebhook,
  deleteEventWebhook,
  listEventKinds,
  listEventWebhooks,
  OwuiHttpError,
  updateEventWebhook,
  type Capabilities,
  type EventWebhook,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

// A public name the server can resolve. Nothing is posted to it: the webhook is off, or on only
// for events about a person who doesn't exist.
const URL = 'https://example.com/app-probe-events';
const NOBODY = [{ type: 'user' as const, id: 'app-probe-nobody' }];

/**
 * The server's event webhooks the app's way (admins), put back as they were: the event list; one
 * added off, for a person who doesn't exist; on and off; whose (everyone, the server's own,
 * chosen) and events changed alone, the address kept; a bad pattern, an unknown event and an
 * address the server can't reach refused; deleted, then not found. For a non-admin, the refusal.
 * Addresses are compared in memory and never printed.
 */
export async function probeEventHooks({ client, capabilities }: { client: OwuiClient; capabilities: Capabilities }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  const refusal = async (run: () => Promise<unknown>, statuses: number[]): Promise<string> => {
    try {
      await run();
    } catch (error) {
      if (error instanceof OwuiHttpError && statuses.includes(error.status)) return `HTTP ${error.status}${error.detail ? `: ${error.detail}` : ''}`;
      throw error;
    }
    throw new Error('the server took it');
  };

  if (!capabilities.isAdmin) {
    await check('refused for a non-admin', async () => `skipped: ${await refusal(() => listEventWebhooks(client), [401, 403])}`);
    return { steps, fixture };
  }

  const shape = (hooks: EventWebhook[]) => JSON.stringify([...hooks].sort((a, b) => a.id.localeCompare(b.id)));
  const before = await listEventWebhooks(client);
  fixture.before = { count: before.length, hasDefault: before.some((hook) => hook.id === 'default') };
  let made: EventWebhook | null = null;
  try {
    await check('the server’s events', async () => {
      const kinds = await listEventKinds(client);
      fixture.events = { count: kinds.length, chat: kinds.filter((kind) => kind.event.startsWith('chat.')).length };
      if (!kinds.some((kind) => kind.event === 'chat.finished') || !kinds.some((kind) => kind.event === 'chat.failed')) throw new Error('no chat.finished or chat.failed');
      return `${kinds.length} events, chat.finished and chat.failed among them`;
    });

    await check('added off, only for a person who doesn’t exist', async () => {
      made = await createEventWebhook(client, { name: 'APP PROBE webhook', url: URL, enabled: false, events: ['chat.finished'], targets: NOBODY });
      const listed = (await listEventWebhooks(client)).find((hook) => hook.id === made?.id);
      if (!listed) throw new Error('not listed');
      if (listed.enabled || listed.url !== URL || listed.events.join() !== 'chat.finished' || JSON.stringify(listed.targets) !== JSON.stringify(NOBODY)) throw new Error('not kept as sent');
      fixture.created = { generatedId: made.id.length > 8, name: listed.name };
      return 'listed off, with its address, event and person as sent';
    });

    await check('on, then off (nothing can match a person who doesn’t exist)', async () => {
      if (!made) throw new Error('not added');
      const on = await updateEventWebhook(client, made.id, { enabled: true });
      const off = await updateEventWebhook(client, made.id, { enabled: false });
      if (!on.enabled || off.enabled) throw new Error('the switch didn’t stick');
      return 'on, then off';
    });

    await check('whose and events changed alone: the address and name stay', async () => {
      if (!made) throw new Error('not added');
      const everyone = await updateEventWebhook(client, made.id, { targets: null });
      const server = await updateEventWebhook(client, made.id, { targets: [] });
      const events = await updateEventWebhook(client, made.id, { events: ['chat.*', 'user.created'] });
      const back = await updateEventWebhook(client, made.id, { targets: NOBODY });
      if (everyone.targets !== null) throw new Error('everyone didn’t stick');
      if (!server.targets || server.targets.length) throw new Error('the server’s own didn’t stick');
      if (events.events.join() !== 'chat.*,user.created') throw new Error('the events didn’t stick');
      if (back.url !== URL || back.name !== 'APP PROBE webhook' || back.enabled) throw new Error('something else changed');
      return 'everyone, then the server’s own, then chat.* + user.created; the address, name and switch as they were';
    });

    await check('a bad pattern, an unknown event and an unreachable address refused', async () => {
      if (!made) throw new Error('not added');
      const id = made.id;
      const pattern = await refusal(() => updateEventWebhook(client, id, { events: ['nope.*'] }), [400]);
      const unknown = await refusal(() => updateEventWebhook(client, id, { events: ['chat.started'] }), [400]);
      const address = await refusal(() => updateEventWebhook(client, id, { url: 'https://app-probe.invalid/events' }), [400]);
      const still = (await listEventWebhooks(client)).find((hook) => hook.id === id);
      if (!still || still.url !== URL || still.events.join() !== 'chat.*,user.created') throw new Error('a refused change was kept');
      fixture.refused = { pattern: pattern.slice(0, 8), unknown: unknown.slice(0, 8), address: address.slice(0, 8) };
      return `${pattern}; ${unknown}; ${address.replace(/:.*/, '')}; nothing kept`;
    });

    await check('deleted; not found the second time', async () => {
      if (!made) throw new Error('not added');
      const id = made.id;
      await deleteEventWebhook(client, id);
      const again = await refusal(() => deleteEventWebhook(client, id), [404]);
      made = null;
      return `gone (${again.replace(/:.*/, '')} the second time)`;
    });
  } finally {
    const leftover: EventWebhook | null = made;
    if (leftover) await deleteEventWebhook(client, (leftover as EventWebhook).id).catch(() => undefined);
  }

  await check('put back as it was', async () => {
    const after = await listEventWebhooks(client);
    if (shape(after) !== shape(before)) throw new Error('the webhooks differ from before');
    return before.length ? `the ${before.length} earlier webhooks, unchanged` : 'none, as before';
  });

  return { steps, fixture };
}
