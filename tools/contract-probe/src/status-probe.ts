import { getSessionUser, getUserSettings, saveUiSettings, setUserStatus, userStatusOf, userStatusOn, type OwuiClient, type ServerConfig } from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

/**
 * Your status the app's way, on the test account, put back as it was after: set with an emoji's
 * short name and read back from the session user and `/users/user/status`; an emoji with no short
 * name kept as itself; cleared with both empty. Then the web's recent emoji list in your settings
 * (`ui.recentEmojis`, code points), also put back.
 */
export async function probeStatus({ client, config }: { client: OwuiClient; config: ServerConfig | undefined }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  if (!userStatusOn(config)) {
    steps.push({ name: 'status', ok: true, note: 'skipped: statuses are off on this server' });
    return { steps, fixture };
  }

  const before = userStatusOf(await getSessionUser(client));
  fixture.before = { emoji: Boolean(before.emoji), message: Boolean(before.message) };
  try {
    await check('set with a short name; read back from the session user and the status endpoint', async () => {
      const answer = await setUserStatus(client, { emoji: 'grinning', message: 'APP PROBE status' });
      const session = userStatusOf(await getSessionUser(client));
      const endpoint = userStatusOf(await client.get<unknown>('/api/v1/users/user/status'));
      fixture.set = { answer: answer.emoji === 'grinning', session: session.emoji === 'grinning' && session.message === 'APP PROBE status', endpoint: endpoint.emoji === 'grinning' };
      if (answer.emoji !== 'grinning' || answer.message !== 'APP PROBE status') throw new Error('the answer didn’t carry the status');
      if (session.emoji !== 'grinning' || session.message !== 'APP PROBE status') throw new Error('the session user didn’t carry the status');
      if (endpoint.emoji !== 'grinning') throw new Error('the status endpoint didn’t carry it');
      return 'kept as sent, on the session user and the status endpoint';
    });
    await check('an emoji sent as itself kept as itself (what the app sends for one with no short name)', async () => {
      await setUserStatus(client, { emoji: '🫥', message: 'APP PROBE status' });
      const back = userStatusOf(await getSessionUser(client));
      if (back.emoji !== '🫥') throw new Error('the emoji came back changed');
      return 'kept as the emoji itself';
    });
    await check('cleared with both empty, as the web’s Clear does', async () => {
      await setUserStatus(client, { emoji: '', message: '' });
      const back = userStatusOf(await getSessionUser(client));
      if (back.emoji || back.message) throw new Error('the status stayed');
      return 'both empty';
    });
  } finally {
    await setUserStatus(client, before).catch(() => undefined);
  }
  await check('put back as it was', async () => {
    const after = userStatusOf(await getSessionUser(client));
    if (after.emoji !== before.emoji || after.message !== before.message) throw new Error('the status differs from before');
    return before.emoji || before.message ? 'the earlier status back' : 'no status, as before';
  });

  await check('the web’s recent emoji kept in your settings, then put back', async () => {
    const had = ((await getUserSettings(client)).ui as Record<string, unknown> | undefined)?.recentEmojis;
    let back: unknown;
    try {
      await saveUiSettings(client, { recentEmojis: ['1F600', '1F44D'] });
      back = ((await getUserSettings(client)).ui as Record<string, unknown> | undefined)?.recentEmojis;
    } finally {
      await saveUiSettings(client, { recentEmojis: had });
    }
    const restored = ((await getUserSettings(client)).ui as Record<string, unknown> | undefined)?.recentEmojis;
    fixture.recent = { kept: JSON.stringify(back) === JSON.stringify(['1F600', '1F44D']), restored: JSON.stringify(restored) === JSON.stringify(had) };
    if (JSON.stringify(back) !== JSON.stringify(['1F600', '1F44D'])) throw new Error('the list didn’t read back as saved');
    if (JSON.stringify(restored) !== JSON.stringify(had)) throw new Error('the list wasn’t put back');
    return `read back as saved; put back (${Array.isArray(had) ? `${had.length} as before` : 'none, as before'})`;
  });
  return { steps, fixture };
}
