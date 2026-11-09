import {
  addUser,
  confirmMfaEnrollment,
  confirmMfaReplacement,
  deleteUser,
  getMfaStatus,
  getSessionUser,
  isAtLeast,
  needsFreshSignIn,
  newRecoveryCodes,
  OwuiClient,
  OwuiHttpError,
  sessionOf,
  signIn,
  signOut,
  startMfaEnrollment,
  startMfaReplacement,
  verifyMfa,
} from '@maviechat/owui-protocol';
import { mfaAdmin, nextStep, totp } from './m5-mfa-probe';
import type { WriteStep } from './write-probe';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** The server's window for a "recent" sign-in before two-step changes (CHALLENGE_SECONDS), and a little. */
const RECENT_MS = 300_000 + 3_000;

/** An authenticator app: a code for a 30-second step the server hasn't seen yet (each works once). */
function authenticator(secret: string) {
  let last = -1;
  return {
    async code(): Promise<string> {
      for (;;) {
        const current = Math.floor(Date.now() / 30_000);
        const next = Math.max(current, last + 1);
        if (next <= current + 1) {
          last = next;
          return totp(secret, next * 30_000);
        }
        await nextStep();
      }
    },
  };
}

/** Whether a client's sign-in still works (false: the server revoked it). */
const stillSignedIn = (client: OwuiClient) =>
  getSessionUser(client).then(
    () => true,
    (error: unknown) => {
      if (error instanceof OwuiHttpError && error.isUnauthorized) return false;
      throw error;
    },
  );

/**
 * Your own two-step sign-in, the app's way (Settings → Account; 0.12 scratch servers only: it
 * switches two-step sign-in on for everyone, then off). With it off, a user's status says it isn't
 * required (the app shows nothing). Switched on, a throwaway user adds an authenticator and the
 * status shows it with its recovery codes. New recovery codes (proven with a code from the app)
 * come back and sign every device out at once, which is why the app holds its session check while
 * they show; the old codes stop working and a new one signs in. Replacing the authenticator
 * (proven with a recovery code): the new setup key; the old authenticator still signs in until the
 * new one's first code is confirmed; then new codes, every device signed out, the old
 * authenticator refused and the new one signing in. A second user's sign-in, left to age past the
 * server's few minutes, is refused either change as "reauthentication_required" (the app's Sign In
 * Again). Two-step sign-in is switched off and both users deleted after. Codes and keys are never printed.
 */
export async function probeAccountMfa({ baseUrl, version, admin, envFile }: { baseUrl: string; version: string | undefined; admin: { email: string; password: string; mfaSecret?: string }; envFile: string }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const step = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
      return true;
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };
  const anon = new OwuiClient({ baseUrl, token: null });
  const { session: adminSession, setMfa } = mfaAdmin({ baseUrl, admin, envFile });

  if (!isAtLeast(version, '0.12.0')) {
    await step('0.11: no two-step sign-in, so the app shows no section', async () => {
      const client = await adminSession();
      try {
        const status = await getMfaStatus(client);
        if (status !== null) throw new Error('a status came back');
        return 'no status (the server answers with its web page)';
      } finally {
        await signOut(client).catch(() => undefined);
      }
    });
    return { steps, fixture };
  }

  const stamp = Date.now().toString(36);
  const users = [0, 1].map((n) => ({ email: `app-probe-acctmfa${n}-${stamp}@maviechat.invalid`, password: `Probe-${stamp}-${n}-${Math.random().toString(36).slice(2, 10)}`, id: '' }));
  const [a, b] = users as [(typeof users)[number], (typeof users)[number]];
  let mfaOn = false;

  /** A user's password step, then the given second step; the signed-in client. */
  const signInWith = async (user: { email: string; password: string }, second: (challengeToken: string) => Promise<ReturnType<typeof sessionOf>>) => {
    const first = await signIn(anon, user.email, user.password);
    if (first.kind !== 'mfa' || first.step !== 'verify') throw new Error(`the password step answered ${first.kind}${first.kind === 'mfa' ? ` (${first.step})` : ''}`);
    const session = await second(first.challengeToken);
    if (!session) throw new Error('the second step didn’t sign in');
    return anon.withToken(session.token);
  };
  /** A new user's first sign-in with two-step sign-in on: adds an authenticator. */
  const enrol = async (user: { email: string; password: string }) => {
    const first = await signIn(anon, user.email, user.password);
    if (first.kind !== 'mfa' || first.step !== 'enroll') throw new Error(`the password step answered ${first.kind}`);
    const signedInAt = Date.now();
    const setup = await startMfaEnrollment(anon, first.challengeToken);
    const app = authenticator(setup.manualKey.replace(/\s+/g, ''));
    const confirmed = await confirmMfaEnrollment(anon, first.challengeToken, await app.code());
    const session = sessionOf(confirmed.result);
    if (!session) throw new Error('confirming didn’t sign in');
    return { client: anon.withToken(session.token), app, codes: confirmed.recoveryCodes, signedInAt };
  };

  try {
    const admin1 = await adminSession();
    for (const user of users) user.id = (await addUser(admin1, { name: 'APP PROBE account mfa', email: user.email, password: user.password, role: 'user' })).id;

    await step('two-step sign-in off: a user’s status says it isn’t asked for (the app shows nothing)', async () => {
      const first = await signIn(anon, a.email, a.password);
      if (first.kind !== 'session') throw new Error(`the password step answered ${first.kind}`);
      const client = anon.withToken(first.session.token);
      const status = await getMfaStatus(client);
      await signOut(client).catch(() => undefined);
      if (!status || status.required || status.enabled) throw new Error(`status ${JSON.stringify(status)}`);
      return 'not asked for, no authenticator';
    });

    mfaOn = await step('two-step sign-in switched on for everyone', async () => {
      const revoked = await setMfa(admin1, true);
      return `on${revoked ? '; everyone signed out, as the server does' : ''}`;
    });
    if (!mfaOn) return { steps, fixture };

    // User B signs in now and is left alone: by the end, the sign-in is too old for changes.
    let aged: Awaited<ReturnType<typeof enrol>> | null = null;
    await step('a second user signs in (left to age for the last check)', async () => {
      aged = await enrol(b);
      return 'authenticator added, signed in';
    });

    let current: Awaited<ReturnType<typeof enrol>> | null = null;
    await step('a user adds an authenticator; the status shows it and the recovery codes', async () => {
      current = await enrol(a);
      const status = await getMfaStatus(current.client);
      if (!status?.required || !status.enabled) throw new Error(`status ${JSON.stringify(status)}`);
      if (status.recoveryCodesRemaining !== current.codes.length) throw new Error(`${status.recoveryCodesRemaining} codes left, ${current.codes.length} given`);
      fixture.codes = current.codes.length;
      return `asked for, set up, ${status.recoveryCodesRemaining} recovery codes left`;
    });

    let codes: string[] = [];
    await step('new recovery codes (a code from the app): they come back, and every device is signed out at once', async () => {
      if (!current) throw new Error('no user signed in');
      codes = await newRecoveryCodes(current.client, await current.app.code(), false);
      if (codes.length !== current.codes.length) throw new Error(`${codes.length} codes`);
      if (await stillSignedIn(current.client)) throw new Error('this device stayed signed in');
      return `${codes.length} new codes; this device’s sign-in stopped working as they arrived`;
    });

    await step('the old recovery codes stop working; a new one signs in', async () => {
      if (!current || !codes.length) throw new Error('no new codes');
      const old = current.codes[1] ?? '';
      const client = await signInWith(a, async (challenge) => {
        const refused = await verifyMfa(anon, challenge, old, true).then(
          () => false,
          () => true,
        );
        if (!refused) throw new Error('an old recovery code still worked');
        return sessionOf(await verifyMfa(anon, challenge, codes[0] ?? '', true));
      });
      const status = await getMfaStatus(client);
      current = { ...current, client };
      if (status?.recoveryCodesRemaining !== codes.length - 1) throw new Error(`${String(status?.recoveryCodesRemaining)} left after using one`);
      return `the old one refused; a new one signed in; ${status.recoveryCodesRemaining} left`;
    });

    await step('replacing the authenticator (a recovery code): the old one works until the new one is confirmed, then every device is signed out', async () => {
      if (!current) throw new Error('no user signed in');
      const signedIn = current;
      const { challengeToken, expiresIn } = await startMfaReplacement(signedIn.client, codes[1] ?? '', true);
      fixture.replaceExpiresIn = expiresIn;
      const setup = await startMfaEnrollment(signedIn.client, challengeToken);
      if (!setup.manualKey || !setup.qrCode.startsWith('data:image/')) throw new Error('no setup key or QR code');
      const fresh = authenticator(setup.manualKey.replace(/\s+/g, ''));
      // Not yet confirmed: the old authenticator still signs in.
      const meanwhile = await signInWith(a, async (challenge) => sessionOf(await verifyMfa(anon, challenge, await signedIn.app.code())));
      const newCodes = await confirmMfaReplacement(anon, challengeToken, await fresh.code());
      if (newCodes.length < 4) throw new Error(`${newCodes.length} recovery codes`);
      if (await stillSignedIn(signedIn.client)) throw new Error('this device stayed signed in');
      if (await stillSignedIn(meanwhile)) throw new Error('the other sign-in stayed signed in');
      const after = await signInWith(a, async (challenge) => {
        const refused = await verifyMfa(anon, challenge, await signedIn.app.code()).then(
          () => false,
          () => true,
        );
        if (!refused) throw new Error('the old authenticator still worked');
        return sessionOf(await verifyMfa(anon, challenge, await fresh.code()));
      });
      const status = await getMfaStatus(after);
      await signOut(after).catch(() => undefined);
      if (!status?.enabled || status.recoveryCodesRemaining !== newCodes.length) throw new Error(`status ${JSON.stringify(status)}`);
      return `the new key and QR code; the old authenticator signed in meanwhile; confirmed: ${newCodes.length} new codes, both sign-ins stopped; the old authenticator refused, the new one signed in`;
    });

    await step('a sign-in older than a few minutes is refused either change (the app’s Sign In Again)', async () => {
      if (!aged) throw new Error('the second user didn’t sign in');
      const { client, app, codes: bCodes, signedInAt } = aged;
      const wait = signedInAt + RECENT_MS - Date.now();
      if (wait > 0) await sleep(wait);
      const results = await Promise.all([
        startMfaReplacement(client, await app.code(), false).then(
          () => 'accepted',
          (error: unknown) => (needsFreshSignIn(error) ? 'fresh' : String(error)),
        ),
        newRecoveryCodes(client, bCodes[0] ?? '', true).then(
          () => 'accepted',
          (error: unknown) => (needsFreshSignIn(error) ? 'fresh' : String(error)),
        ),
      ]);
      if (results.some((result) => result !== 'fresh')) throw new Error(`answers: ${results.join(', ')}`);
      return `both refused as reauthentication_required (403)${wait > 0 ? `, after waiting ${Math.round(wait / 1000)} s` : ''}`;
    });
  } finally {
    // A code the admin just used can't be used again: once more, at the next step.
    const cleanup = await adminSession().catch(async () => {
      await nextStep();
      return adminSession().catch(() => null);
    });
    if (cleanup) {
      if (mfaOn) mfaOn = !(await setMfa(cleanup, false).then(() => true).catch(() => false));
      // Switching it off signs everyone out: sign in again for the rest.
      const again = await adminSession().catch(() => null);
      if (again) {
        await step('cleaned up: two-step sign-in off, the throwaway users deleted', async () => {
          if (mfaOn) throw new Error('two-step sign-in is still on');
          for (const user of users) if (user.id) await deleteUser(again, user.id);
          return `off; ${users.filter((user) => user.id).length} users deleted`;
        });
        await signOut(again).catch(() => undefined);
      }
    }
  }
  return { steps, fixture };
}
