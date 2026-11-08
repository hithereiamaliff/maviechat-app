import { addUser, deleteUser, getAdminConfig, OwuiClient, pendingNotice, saveAdminConfig, signIn, signInWithToken, updateUser, type Capabilities } from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

type Tree = Record<string, unknown>;
const KEYS = ['PENDING_USER_OVERLAY_TITLE', 'PENDING_USER_OVERLAY_CONTENT'];

/**
 * A pending account the app's way (admins, scratch servers only: it adds an account and sets
 * everyone's waiting screen for a moment): the waiting screen's title and text set; a throwaway
 * pending account signed in (0.11 and 0.12 without two-step sign-in give it a session); what the
 * server tells it, read with that session; still pending on a check; approved, then the check
 * signs it in. The account is deleted and the two settings put back exactly.
 */
export async function probePending({ client, anonymous, capabilities, baseUrl }: { client: OwuiClient; anonymous: OwuiClient; capabilities: Capabilities; baseUrl: string }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  if (!capabilities.isAdmin || !/^http:\/\/127\.0\.0\.1:(3013|3014)\/?$/.test(baseUrl)) {
    steps.push({ name: 'pending account', ok: true, note: 'skipped: admins on the scratch servers only' });
    return { steps, fixture };
  }

  const before = await getAdminConfig(client);
  const stamp = Date.now().toString(36);
  const email = `app-probe-pending-${stamp}@maviechat.invalid`;
  const password = `Probe-${stamp}-${Math.random().toString(36).slice(2, 10)}`;
  let userId = '';
  try {
    await check('a pending account: the waiting screen’s words, read with its session; approved, the check signs it in', async () => {
      await saveAdminConfig(client, { ...before, PENDING_USER_OVERLAY_TITLE: 'APP PROBE: hold on', PENDING_USER_OVERLAY_CONTENT: 'APP PROBE: ask **the admin**.' });
      userId = (await addUser(client, { name: 'APP PROBE pending', email, password, role: 'pending' })).id;
      const first = await signIn(anonymous, email, password);
      if (first.kind !== 'pending') throw new Error(`the sign-in answered ${first.kind}`);
      if (!first.session) return 'pending with no session (0.12 with two-step sign-in on): the app shows its own words';
      const notice = await pendingNotice(anonymous.withToken(first.session.token));
      if (notice.title !== 'APP PROBE: hold on' || notice.content !== 'APP PROBE: ask **the admin**.') throw new Error('the waiting screen’s words didn’t come back');
      const still = await signInWithToken(anonymous, first.session.token);
      if (still.kind !== 'pending') throw new Error(`a check before approval answered ${still.kind}`);
      await updateUser(client, userId, { role: 'user' });
      const after = await signInWithToken(anonymous, first.session.token);
      if (after.kind !== 'session') throw new Error(`a check after approval answered ${after.kind}`);
      return `pending with a session; the words read with it${notice.admin ? ', and the admin’s contact' : ' (the admin’s contact isn’t shared here)'}; still pending on a check; approved, the check signs in`;
    });
  } finally {
    if (userId) await check('the throwaway account deleted', async () => {
      await deleteUser(client, userId);
      return 'gone';
    });
    await check('the waiting screen’s words put back as they were', async () => {
      const now = await getAdminConfig(client);
      await saveAdminConfig(client, { ...now, ...Object.fromEntries(KEYS.map((key) => [key, (before as Tree)[key] ?? ''])) });
      const back = (await getAdminConfig(client)) as Tree;
      for (const key of KEYS) if ((back[key] ?? '') !== ((before as Tree)[key] ?? '')) throw new Error(`${key} differs from before`);
      return 'as before';
    });
  }
  return { steps, fixture };
}
