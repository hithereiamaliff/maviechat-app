import { createHmac } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import {
  addUser,
  confirmMfaEnrollment,
  deleteUser,
  getAdminConfig,
  isAtLeast,
  OwuiClient,
  saveAdminConfig,
  sessionOf,
  signIn,
  signOut,
  startMfaEnrollment,
  verifyMfa,
  type SignInResult,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function base32(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of input.replace(/[\s=]+/g, '').toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error('not a base32 key');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let at = 0; at + 8 <= bits.length; at += 8) bytes.push(parseInt(bits.slice(at, at + 8), 2));
  return Buffer.from(bytes);
}

/** A time-based code as authenticator apps make it (SHA-1, 30 seconds, 6 digits). */
export function totp(secret: string, atMs = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const hash = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = (hash[hash.length - 1] ?? 0) & 0xf;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Waits for the next 30-second step: a code can't be used twice. */
const nextStep = () => sleep(30_000 - (Date.now() % 30_000) + 750);

/**
 * M5: two-step sign-in on a 0.12 scratch server. Two-step sign-in switched on (everyone signed
 * out, as the server does); a fresh user signs in, adds an authenticator (the setup key; the
 * link an iPhone takes) and confirms a code, keeping recovery codes; signs in again with a code,
 * then with a recovery code (which then no longer works); the admin, signed out too, signs in
 * the same way (its key kept in the scratch env file); two-step sign-in switched off again; the
 * user deleted. Skipped on 0.11 (it has no two-step sign-in).
 */
export async function probeM5Mfa({ baseUrl, version, admin, envFile }: { baseUrl: string; version: string | undefined; admin: { email: string; password: string; mfaSecret?: string }; envFile: string }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
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
  if (!isAtLeast(version, '0.12.0')) {
    await step('two-step sign-in', async () => 'skipped: this server has none (0.11)');
    return { steps, fixture };
  }
  const anon = new OwuiClient({ baseUrl, token: null });
  let adminSecret = admin.mfaSecret ?? '';

  /** Signs the admin in, through whatever step the server asks for. */
  const adminSession = async (): Promise<OwuiClient> => {
    const first = await signIn(anon, admin.email, admin.password);
    let done: SignInResult = first;
    if (first.kind === 'mfa' && first.step === 'enroll') {
      const setup = await startMfaEnrollment(anon, first.challengeToken);
      adminSecret = setup.manualKey.replace(/\s+/g, '');
      // Kept where the scratch admin's sign-in is (0600), so a later run can sign in again.
      appendFileSync(envFile, `OWUI_MFA_SECRET=${adminSecret}\n`, { mode: 0o600 });
      done = (await confirmMfaEnrollment(anon, first.challengeToken, totp(adminSecret))).result;
    } else if (first.kind === 'mfa' && first.step === 'verify') {
      if (!adminSecret) throw new Error('the scratch admin has two-step sign-in, but its key isn’t in the env file');
      done = await verifyMfa(anon, first.challengeToken, totp(adminSecret));
      if (done.kind === 'mfa') {
        await nextStep();
        done = await verifyMfa(anon, first.challengeToken, totp(adminSecret));
      }
    }
    const session = sessionOf(done);
    if (!session) throw new Error(`the scratch admin couldn’t sign in (${done.kind})`);
    return anon.withToken(session.token);
  };

  const setMfa = async (client: OwuiClient, on: boolean) => {
    const config = await getAdminConfig(client);
    if (!('ENABLE_MFA' in config)) throw new Error('this server’s admin config has no ENABLE_MFA');
    const answer = await saveAdminConfig(client, { ...config, ENABLE_MFA: on });
    return answer.sessions_revoked === true;
  };

  const stamp = Date.now().toString(36);
  const email = `app-probe-mfa-${stamp}@maviechat.invalid`;
  const password = `Probe-${stamp}-${Math.random().toString(36).slice(2, 10)}`;
  let userId = '';
  let mfaOn = false;
  try {
    let admin1 = await adminSession();
    userId = (await addUser(admin1, { name: 'APP PROBE mfa', email, password, role: 'user' })).id;
    mfaOn = await step('two-step sign-in switched on: everyone signed out', async () => {
      const revoked = await setMfa(admin1, true);
      const stale = await admin1.get<unknown>('/api/v1/auths/').then(
        () => 'still valid',
        () => 'revoked',
      );
      fixture.revoked = revoked;
      if (!revoked || stale !== 'revoked') throw new Error(`sessions ${revoked ? 'said revoked' : 'not revoked'}; the admin’s token is ${stale}`);
      return 'on; the server said sessions were revoked, and the admin’s own token stopped working';
    });
    if (!mfaOn) return { steps, fixture };

    let secret = '';
    let recoveryCodes: string[] = [];
    await step('a new user adds an authenticator and confirms a code', async () => {
      const first = await signIn(anon, email, password);
      if (first.kind !== 'mfa' || first.step !== 'enroll') throw new Error(`the password step answered ${first.kind}${first.kind === 'mfa' ? ` (${first.step})` : ''}`);
      fixture.expiresIn = first.expiresIn;
      const setup = await startMfaEnrollment(anon, first.challengeToken);
      if (!setup.manualKey || !setup.qrCode.startsWith('data:image/')) throw new Error('no setup key or QR code');
      secret = setup.manualKey.replace(/\s+/g, '');
      const confirmed = await confirmMfaEnrollment(anon, first.challengeToken, totp(secret));
      const session = sessionOf(confirmed.result);
      if (!session) throw new Error('confirming didn’t sign in');
      recoveryCodes = confirmed.recoveryCodes;
      if (recoveryCodes.length < 4) throw new Error(`${recoveryCodes.length} recovery codes`);
      await signOut(anon.withToken(session.token)).catch(() => undefined);
      return `enrolled with the setup key; signed in; ${recoveryCodes.length} recovery codes; the challenge lasted ${String(first.expiresIn)} s`;
    });

    await step('signing in again: a code, then a recovery code (once only)', async () => {
      if (!secret) throw new Error('no authenticator');
      await nextStep();
      const byCode = await signIn(anon, email, password);
      if (byCode.kind !== 'mfa' || byCode.step !== 'verify') throw new Error(`the password step answered ${byCode.kind}`);
      const wrong = await verifyMfa(anon, byCode.challengeToken, '000000').then(
        () => 'accepted',
        () => 'refused',
      );
      const coded = sessionOf(await verifyMfa(anon, byCode.challengeToken, totp(secret)));
      if (!coded) throw new Error('a current code didn’t sign in');
      await signOut(anon.withToken(coded.token)).catch(() => undefined);
      const byRecovery = await signIn(anon, email, password);
      if (byRecovery.kind !== 'mfa') throw new Error('no second step the second time');
      const code = recoveryCodes[0] ?? '';
      const recovered = sessionOf(await verifyMfa(anon, byRecovery.challengeToken, code, true));
      if (!recovered) throw new Error('a recovery code didn’t sign in');
      await signOut(anon.withToken(recovered.token)).catch(() => undefined);
      const again = await signIn(anon, email, password);
      if (again.kind !== 'mfa') throw new Error('no second step the third time');
      const reused = await verifyMfa(anon, again.challengeToken, code, true).then(
        () => 'accepted',
        () => 'refused',
      );
      if (reused !== 'refused') throw new Error('a used recovery code worked twice');
      return `a wrong code ${wrong}; a current code signed in; a recovery code signed in once, and was refused after`;
    });

    await step('the admin signs in with two steps too, and switches it off', async () => {
      admin1 = await adminSession();
      const revoked = await setMfa(admin1, false);
      mfaOn = false;
      const plain = await signIn(anon, email, password);
      if (plain.kind !== 'session') throw new Error(`with it off, the password step answered ${plain.kind}`);
      await signOut(anon.withToken(plain.session.token)).catch(() => undefined);
      return `signed in (${admin.mfaSecret ? 'a code from its kept key' : 'enrolled, key kept'}); switched off (${revoked ? 'everyone signed out again' : 'no revocation'}); the password alone works again`;
    });
  } finally {
    if (mfaOn) {
      const cleanup = await adminSession().catch(() => null);
      if (cleanup) await setMfa(cleanup, false).catch(() => undefined);
    }
    if (userId) {
      const cleanup = await adminSession().catch(() => null);
      if (cleanup) {
        await deleteUser(cleanup, userId).catch(() => undefined);
        await signOut(cleanup).catch(() => undefined);
      }
    }
  }
  return { steps, fixture };
}
