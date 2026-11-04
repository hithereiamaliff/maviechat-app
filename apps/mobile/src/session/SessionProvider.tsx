import {
  getSessionUser,
  normalizeBaseUrl,
  OwuiClient,
  OwuiHttpError,
  signIn as requestSignIn,
  signOut as requestSignOut,
  uuidv4,
  type MfaStep,
  type SignInResult,
} from '@maviechat/owui-protocol';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { accountsIn, activeAccount, dropAccount, markSignedOut, putAccount, setActive, type AccountEntry, type AccountFields } from './accounts';
import { OTHER_SPACE_ROOTS } from './queryRoots';
import { clearSession, deleteAccountSecret, loadAccountSecret, loadLastServerUrl, loadSession, saveAccountSecret, saveSession, updateAccountIndex } from './storage';
import { isUsable, parseStoredSession, toStoredSession, type StoredSession } from './stored-session';

export type SessionState =
  | { status: 'loading' }
  | {
      status: 'signed-out';
      lastServerUrl: string | null;
      notice?: string;
      /** The email of an account that needs its password again, to fill in the form. */
      login?: string;
    }
  | {
      status: 'signed-in';
      session: StoredSession;
      /** The account in use: everything that belongs to one account is keyed by it. */
      accountId: string;
    };

/** A sign-in's next step: done, waiting for approval, or (Open WebUI 0.12) a second step with its challenge. */
export type SignInOutcome = { kind: 'signed-in' } | { kind: 'pending' } | { kind: 'mfa'; step: MfaStep; challengeToken: string; expiresIn: number | null; baseUrl: string };

interface SessionContextValue {
  state: SessionState;
  /** Authenticated client while signed in, otherwise null. */
  client: OwuiClient | null;
  /** The Open WebUI accounts on this phone, in the order added. */
  accounts: AccountEntry[];
  /** Signs in, adding the account (or refreshing it, for the same person on the same server) and putting it in use. */
  signIn(input: { serverUrl: string; email: string; password: string }): Promise<SignInOutcome>;
  /** Takes a second step's answer (Open WebUI 0.12's two-step sign-in): signs in, or says what's next. */
  finishSignIn(baseUrl: string, result: SignInResult): Promise<SignInOutcome>;
  /**
   * Signs out of the account in use (the server revokes its token) and forgets it; the latest
   * other account still signed in takes over. True when an account is in use afterwards.
   */
  signOut(options?: { notice?: string }): Promise<boolean>;
  /** The account in use needs its password again (it expired, or the server signed everyone out); it stays in the list. */
  expireSession(notice?: string): Promise<void>;
  /** Puts another account in use. "sign-in": its sign-in had expired, so the sign-in screen now asks for its password. */
  switchAccount(id: string): Promise<'switched' | 'sign-in'>;
  /** Signs out of one account and forgets it. True when an account is in use afterwards. */
  removeAccount(id: string, options?: { notice?: string }): Promise<boolean>;
  /** One account's sign-in while it still works (for leaving the notification relay before signing out of it). */
  accountSession(id: string): Promise<StoredSession | null>;
  /** Every account still signed in, tokens included: for registering them all for notifications. */
  signedInSessions(): Promise<StoredSession[]>;
  /**
   * Call after a 401. Open WebUI also answers 401 for "not permitted", so this re-checks
   * the session (as the web app does) and signs out only when the session itself is gone.
   */
  verifySession(): void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const EXPIRED_NOTICE = 'Your session expired. Please sign in again.';

const OWUI = 'owui';
const nowMs = () => Date.now();
const fieldsOf = (stored: StoredSession): AccountFields => ({
  space: OWUI,
  baseUrl: stored.baseUrl,
  userId: stored.user.id,
  name: stored.user.name,
  login: stored.user.email,
  expiresAt: stored.expiresAt,
  signedIn: true,
});
const readSecret = async (id: string) => parseStoredSession(await loadAccountSecret(id));
/** Open WebUI's cached data: every query outside the other spaces' roots. Its keys aren't per account, so a change of account clears them. */
const clearOwuiQueries = (queryClient: QueryClient) => queryClient.removeQueries({ predicate: (query) => !OTHER_SPACE_ROOTS.includes(String(query.queryKey[0])) });

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [accounts, setAccounts] = useState<AccountEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The single sign-in from before accounts becomes the first account, once.
      const [index, active] = await updateAccountIndex(async (current) => {
        let next = current;
        if (!next.migrated.includes(OWUI)) {
          const legacy = await loadSession();
          if (legacy && accountsIn(next, OWUI).length === 0) {
            const put = putAccount(next, fieldsOf(legacy), uuidv4, nowMs());
            await saveAccountSecret(put.id, JSON.stringify(legacy));
            next = put.index;
          }
          next = { ...next, migrated: [...next.migrated, OWUI] };
        }
        return [next, activeAccount(next, OWUI)];
      });
      const lastServerUrl = await loadLastServerUrl();
      const stored = active ? await readSecret(active.id) : null;
      if (cancelled) return;
      setAccounts(accountsIn(index, OWUI));
      if (active && stored && isUsable(stored, nowMs())) {
        setState({ status: 'signed-in', session: stored, accountId: active.id });
        return;
      }
      if (!active) {
        setState({ status: 'signed-out', lastServerUrl });
        return;
      }
      // Expired: the account stays in the list without its token, and the sign-in screen asks for its password.
      const [after] = await updateAccountIndex(async (current) => {
        await deleteAccountSecret(active.id);
        return [markSignedOut(current, active.id), null];
      });
      await clearSession();
      if (cancelled) return;
      setAccounts(accountsIn(after, OWUI));
      setState({ status: 'signed-out', lastServerUrl: active.baseUrl, notice: active.signedIn ? EXPIRED_NOTICE : undefined, login: active.login });
    })().catch(() => {
      if (!cancelled) setState({ status: 'signed-out', lastServerUrl: null });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const client = useMemo(
    () =>
      state.status === 'signed-in'
        ? new OwuiClient({ baseUrl: state.session.baseUrl, token: state.session.token })
        : null,
    [state],
  );

  /** Puts an account in use: mirrored to the old single sign-in (for rollbacks), with Open WebUI's cached data cleared. */
  const activate = useCallback(
    async (id: string, stored: StoredSession) => {
      const [index] = await updateAccountIndex((current) => [setActive(current, OWUI, id), null]);
      await saveSession(stored);
      clearOwuiQueries(queryClient);
      setAccounts(accountsIn(index, OWUI));
      setState({ status: 'signed-in', session: stored, accountId: id });
    },
    [queryClient],
  );

  /** The account stays, needing its password: it's put in use signed out, so the sign-in screen asks for it. */
  const showSignInFor = useCallback(
    async (id: string, notice?: string) => {
      const [index, entry] = await updateAccountIndex(async (current) => {
        await deleteAccountSecret(id);
        const next = setActive(markSignedOut(current, id), OWUI, id);
        return [next, next.accounts.find((item) => item.id === id) ?? null];
      });
      await clearSession();
      clearOwuiQueries(queryClient);
      setAccounts(accountsIn(index, OWUI));
      setState({ status: 'signed-out', lastServerUrl: entry?.baseUrl ?? null, notice, login: entry?.login });
    },
    [queryClient],
  );

  const finishSignIn = useCallback<SessionContextValue['finishSignIn']>(
    async (baseUrl, result) => {
      if (result.kind === 'pending') return { kind: 'pending' };
      if (result.kind === 'mfa') return { kind: 'mfa', step: result.step, challengeToken: result.challengeToken, expiresIn: result.expiresIn, baseUrl };
      const stored = toStoredSession(baseUrl, result.session);
      const [index, id] = await updateAccountIndex(async (current) => {
        const put = putAccount(current, fieldsOf(stored), uuidv4, nowMs());
        await saveAccountSecret(put.id, JSON.stringify(stored));
        return [put.index, put.id];
      });
      await saveSession(stored);
      clearOwuiQueries(queryClient);
      setAccounts(accountsIn(index, OWUI));
      setState({ status: 'signed-in', session: stored, accountId: id });
      return { kind: 'signed-in' };
    },
    [queryClient],
  );

  const signIn = useCallback<SessionContextValue['signIn']>(
    async ({ serverUrl, email, password }) => {
      const baseUrl = normalizeBaseUrl(serverUrl);
      return finishSignIn(baseUrl, await requestSignIn(new OwuiClient({ baseUrl }), email.trim(), password));
    },
    [finishSignIn],
  );

  const switchAccount = useCallback<SessionContextValue['switchAccount']>(
    async (id) => {
      const stored = await readSecret(id);
      if (stored && isUsable(stored, nowMs())) {
        await activate(id, stored);
        return 'switched';
      }
      const entry = accounts.find((item) => item.id === id);
      await showSignInFor(id, entry ? `Sign in again to ${entry.login}.` : undefined);
      return 'sign-in';
    },
    [accounts, activate, showSignInFor],
  );

  const removeAccount = useCallback<SessionContextValue['removeAccount']>(
    async (id, options) => {
      const stored = await readSecret(id);
      if (stored) {
        try {
          // Revoke the token on the server; forget it locally even when that fails (offline, already expired).
          await requestSignOut(new OwuiClient({ baseUrl: stored.baseUrl, token: stored.token, timeoutMs: 5000 }));
        } catch {
          // ignored on purpose
        }
      }
      const [index, dropped] = await updateAccountIndex(async (current) => {
        await deleteAccountSecret(id);
        const result = dropAccount(current, id);
        return [result.index, { ...result, baseUrl: current.accounts.find((item) => item.id === id)?.baseUrl ?? null }];
      });
      setAccounts(accountsIn(index, OWUI));
      if (!dropped.wasActive) return activeAccount(index, OWUI)?.signedIn ?? false;
      if (dropped.next) return (await switchAccount(dropped.next.id)) === 'switched';
      await clearSession();
      clearOwuiQueries(queryClient);
      setState({ status: 'signed-out', lastServerUrl: dropped.baseUrl, notice: options?.notice });
      return false;
    },
    [queryClient, switchAccount],
  );

  const signOut = useCallback<SessionContextValue['signOut']>(
    async (options) => {
      return state.status === 'signed-in' ? removeAccount(state.accountId, options) : false;
    },
    [state, removeAccount],
  );

  const expireSession = useCallback<SessionContextValue['expireSession']>(
    async (notice = EXPIRED_NOTICE) => {
      if (state.status === 'signed-in') await showSignInFor(state.accountId, notice);
    },
    [state, showSignInFor],
  );

  const accountSession = useCallback<SessionContextValue['accountSession']>(async (id) => {
    const stored = await readSecret(id);
    return stored && isUsable(stored, nowMs()) ? stored : null;
  }, []);

  const signedInSessions = useCallback<SessionContextValue['signedInSessions']>(async () => {
    const found = await Promise.all(accounts.filter((item) => item.signedIn).map((item) => readSecret(item.id).catch(() => null)));
    return found.filter((stored): stored is StoredSession => stored !== null && isUsable(stored, nowMs()));
  }, [accounts]);

  // Kept in refs so the query-cache subscription below doesn't resubscribe on every state change.
  const expireRef = useRef(expireSession);
  const clientRef = useRef(client);
  const verifying = useRef(false);
  useEffect(() => {
    expireRef.current = expireSession;
    clientRef.current = client;
  }, [expireSession, client]);

  const verifySession = useCallback(() => {
    const current = clientRef.current;
    if (!current || verifying.current) return;
    verifying.current = true;
    getSessionUser(current)
      .catch((error: unknown) => {
        if (error instanceof OwuiHttpError && error.isUnauthorized) return expireRef.current(EXPIRED_NOTICE);
        return undefined;
      })
      .finally(() => {
        verifying.current = false;
      });
  }, []);

  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'error') return;
        const error = event.action.error;
        if (error instanceof OwuiHttpError && error.isUnauthorized) verifySession();
      }),
    [queryClient, verifySession],
  );

  const value = useMemo(
    () => ({ state, client, accounts, signIn, finishSignIn, signOut, expireSession, switchAccount, removeAccount, accountSession, signedInSessions, verifySession }),
    [state, client, accounts, signIn, finishSignIn, signOut, expireSession, switchAccount, removeAccount, accountSession, signedInSessions, verifySession],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export { EXPIRED_NOTICE };
