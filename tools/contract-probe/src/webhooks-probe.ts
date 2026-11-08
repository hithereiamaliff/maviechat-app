import {
  createNotificationTarget,
  deleteNotificationTarget,
  listNotificationEvents,
  listNotificationTargets,
  maskedTargetUrl,
  OwuiHttpError,
  setDefaultNotificationTarget,
  testNotificationTarget,
  updateNotificationTarget,
  type Capabilities,
  type NotificationTarget,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

const ID = 'app-probe-hook';
const RENAMED = 'app-probe-hook-2';
// A public name the server can resolve; nothing is ever sent to it: the target stays off with no
// events, and the only test asked for is for a target that doesn't exist.
const URL = 'https://example.com/app-probe-hook';

/**
 * Your notification targets the app's way, on the test account, put back as it was after: the
 * server's events; a webhook added off and with no events; its whole address never shown again;
 * on and off; events and delivery changed without sending the address; made the default; renamed
 * (the default follows); a test for a target that doesn't exist (nothing sent); removed. Where
 * the server or the account doesn't allow webhooks, only that refusal is checked.
 */
export async function probeWebhooks({ client, capabilities }: { client: OwuiClient; capabilities: Capabilities }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  const find = async (id: string): Promise<NotificationTarget | undefined> => (await listNotificationTargets(client)).find((target) => target.id === id);

  if (!capabilities.feature('userWebhooks')) {
    await check('refused where webhooks aren’t allowed', async () => {
      try {
        await listNotificationTargets(client);
      } catch (error) {
        if (error instanceof OwuiHttpError && (error.status === 404 || error.status === 403)) {
          fixture.refused = error.status;
          return `skipped: HTTP ${error.status} (${error.status === 404 ? 'the admin has webhooks off' : 'this account may not use them'}), and the app hides the section`;
        }
        throw error;
      }
      throw new Error('the server listed targets the app would hide');
    });
    return { steps, fixture };
  }

  const before = await listNotificationTargets(client);
  const beforeDefault = before.find((target) => target.is_default)?.id;
  fixture.before = { count: before.length, hasDefault: Boolean(beforeDefault) };
  try {
    await check('the server’s events', async () => {
      const events = await listNotificationEvents(client);
      fixture.events = events.map((event) => event.event);
      if (!events.some((event) => event.event === 'chat.finished')) throw new Error('no chat.finished event');
      return events.map((event) => event.event).join(', ');
    });

    await check('a webhook added off and with no events; its whole address never shown again', async () => {
      const made = await createNotificationTarget(client, { id: ID, url: URL, enabled: false, events: [], delivery: 'away' });
      const listed = await find(ID);
      const masked = maskedTargetUrl(listed ?? made);
      fixture.created = { id: made.id === ID, enabled: listed?.enabled, masked: masked.replace(/\/\.\.\..*$/, '/...'), wholeAddress: JSON.stringify([made, listed]).includes(URL) };
      if (!listed) throw new Error('not listed');
      if (listed.enabled !== false || listed.events.length) throw new Error('not off with no events');
      if (JSON.stringify([made, listed]).includes(URL)) throw new Error('the whole address came back');
      if (!/^https:\/\/example\.com\/\.\.\./.test(masked)) throw new Error(`masked as ${masked}`);
      return `listed off, masked as ${masked}`;
    });

    await check('on, then off (with no events nothing goes out by itself)', async () => {
      const on = await updateNotificationTarget(client, ID, { enabled: true });
      const off = await updateNotificationTarget(client, ID, { enabled: false });
      if (on.enabled !== true || off.enabled !== false) throw new Error('the switch didn’t stick');
      return 'on, then off';
    });

    await check('events and delivery changed without sending the address: it stays', async () => {
      const masked = maskedTargetUrl((await find(ID)) as NotificationTarget);
      await updateNotificationTarget(client, ID, { events: ['chat.finished', 'chat.failed'], delivery: 'always' });
      const after = await find(ID);
      if (!after || after.delivery !== 'always' || after.events.join() !== 'chat.finished,chat.failed') throw new Error('the change didn’t stick');
      if (maskedTargetUrl(after) !== masked) throw new Error('the address changed');
      if (after.enabled !== false) throw new Error('it was switched on');
      return 'chat.finished, chat.failed · always; the same address; still off';
    });

    await check('made the default, then renamed: the default follows', async () => {
      await setDefaultNotificationTarget(client, ID);
      if (!(await find(ID))?.is_default) throw new Error('not the default');
      await updateNotificationTarget(client, ID, { id: RENAMED });
      const list = await listNotificationTargets(client);
      const renamed = list.find((target) => target.id === RENAMED);
      if (!renamed || list.some((target) => target.id === ID)) throw new Error('not renamed');
      if (!renamed.is_default) throw new Error('the default didn’t follow');
      return `${RENAMED}, still the default`;
    });

    await check('a test for a target that doesn’t exist: refused, nothing sent', async () => {
      try {
        await testNotificationTarget(client, 'app-probe-missing');
      } catch (error) {
        if (error instanceof OwuiHttpError && error.status === 400) return `HTTP 400: ${error.detail ?? ''}`.trim();
        throw error;
      }
      throw new Error('the server said it sent one');
    });

    await check('removed; removing it again finds nothing', async () => {
      await deleteNotificationTarget(client, RENAMED);
      try {
        await deleteNotificationTarget(client, RENAMED);
      } catch (error) {
        if (error instanceof OwuiHttpError && error.status === 404) return 'gone (HTTP 404 the second time)';
        throw error;
      }
      throw new Error('removed twice');
    });
  } finally {
    await deleteNotificationTarget(client, ID).catch(() => undefined);
    await deleteNotificationTarget(client, RENAMED).catch(() => undefined);
    const now = await listNotificationTargets(client).catch(() => []);
    if (beforeDefault && !now.find((target) => target.id === beforeDefault)?.is_default) await setDefaultNotificationTarget(client, beforeDefault).catch(() => undefined);
  }

  await check('put back as it was', async () => {
    const after = await listNotificationTargets(client);
    const same = after.length === before.length && before.every((target) => after.some((item) => item.id === target.id));
    if (!same) throw new Error('the targets differ from before');
    if ((after.find((target) => target.is_default)?.id ?? null) !== (beforeDefault ?? null)) throw new Error('the default differs from before');
    return before.length ? `the ${before.length} earlier targets, same default` : 'no targets, as before';
  });

  return { steps, fixture };
}
