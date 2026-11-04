import {
  DtClient,
  DtHttpError,
  getAuthStatus,
  normalizeDtUrl,
  signIn as requestSignIn,
  signOut as requestSignOut,
} from '@maviechat/deeptutor-protocol';
import { uuidv4 } from '@maviechat/owui-protocol';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { accountsIn, activeAccount, dropAccount, markSignedOut, putAccount, setActive, type AccountEntry, type AccountFields } from './accounts';
import { isDtUsable, parseStoredDtSession, toStoredDtSession, type StoredDtSession } from './deeptutor-session';
import { DT_QUERY_ROOT } from './queryRoots';
import { clearDtSession, deleteAccountSecret, loadAccountSecret, loadDtSession, loadLastDtServerUrl, saveAccountSecret, saveDtSession, updateAccountIndex } from './storage';

export type DtState =
  | { status: 'loading' }
  | {
      status: 'signed-out';
      lastServerUrl: string | null;
      notice?: string;
      /** The username of an account that needs its password again, to fill in the form. */
      login?: string;
    }
  | {
      status: 'signed-in';
      session: StoredDtSession;
      /** The account in use: everything that belongs to one account is keyed by it. */
      accountId: string;
    };

interface DeepTutorContextValue {
  state: DtState;
  /** Signed-in client, otherwise null. */
  client: DtClient | null;
  /** The DeepTutor accounts on this phone, in the order added. */
  accounts: AccountEntry[];
  /** Signs in, adding the account (or refreshing it, for the same person on the same server) and putting it in use. */
  signIn(input: { serverUrl: string; username: string; password: string }): Promise<void>;
  /** Signs out of the account in use and forgets it; the latest other account still signed in takes over. True when an account is in use afterwards. */
  signOut(options?: { notice?: string }): Promise<boolean>;
  /** The account in use needs its password again (it expired or was refused); it stays in the list. */
  expireSession(notice?: string): Promise<void>;
  /** Puts another account in use. "sign-in": its sign-in had expired, so the sign-in screen now asks for its password. */
  switchAccount(id: string): Promise<'switched' | 'sign-in'>;
  /** Signs out of one account and forgets it. True when an account is in use afterwards. */
  removeAccount(id: string, options?: { notice?: string }): Promise<boolean>;
}

export { DT_QUERY_ROOT };

const DeepTutorContext = createContext<DeepTutorContextValue | null>(null);

export const DT_EXPIRED_NOTICE = 'Your DeepTutor sign-in expired. Please sign in again.';

const DT = 'deeptutor';
const nowMs = () => Date.now();
const fieldsOf = (stored: StoredDtSession): AccountFields => ({
  space: DT,
  baseUrl: stored.baseUrl,
  userId: stored.account.userId || stored.account.username,
  name: stored.account.username,
  login: stored.account.username,
  expiresAt: stored.expiresAt,
  signedIn: true,
});
const readSecret = async (id: string) => parseStoredDtSession(await loadAccountSecret(id));
const clearDtQueries = (queryClient: QueryClient) => queryClient.removeQueries({ queryKey: [DT_QUERY_ROOT] });

/**
 * Clears DeepTutor's sign-in cookie in iOS's shared store, which may belong to another account on
 * the same server. DeepTutor's tokens are stateless, so this signs no account out; the app's own
 * requests carry their token (which DeepTutor prefers to the cookie), and a DeepTutor page opened
 * later lands on its login page, where the app signs it in as the account in use.
 */
async function clearSharedCookie(stored: StoredDtSession): Promise<void> {
  try {
    await requestSignOut(new DtClient({ baseUrl: stored.baseUrl, token: stored.token || null, timeoutMs: 5000 }));
  } catch {
    // offline: the page's own sign-in check still applies
  }
}

/**
 * The DeepTutor sign-ins, kept beside the Open WebUI ones. Each server and account has its own
 * Keychain entry; switching clears DeepTutor's cached data so accounts never mix.
 */
export function DeepTutorProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<DtState>({ status: 'loading' });
  const [accounts, setAccounts] = useState<AccountEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The single sign-in from before accounts becomes the first account, once.
      const [index, active] = await updateAccountIndex(async (current) => {
        let next = current;
        if (!next.migrated.includes(DT)) {
          const legacy = await loadDtSession();
          if (legacy && accountsIn(next, DT).length === 0) {
            const put = putAccount(next, fieldsOf(legacy), uuidv4, nowMs());
            await saveAccountSecret(put.id, JSON.stringify(legacy));
            next = put.index;
          }
          next = { ...next, migrated: [...next.migrated, DT] };
        }
        return [next, activeAccount(next, DT)];
      });
      const lastServerUrl = await loadLastDtServerUrl();
      const stored = active ? await readSecret(active.id) : null;
      if (cancelled) return;
      setAccounts(accountsIn(index, DT));
      if (active && stored && isDtUsable(stored, nowMs())) {
        setState({ status: 'signed-in', session: stored, accountId: active.id });
        return;
      }
      if (!active) {
        setState({ status: 'signed-out', lastServerUrl });
        return;
      }
      const [after] = await updateAccountIndex(async (current) => {
        await deleteAccountSecret(active.id);
        return [markSignedOut(current, active.id), null];
      });
      await clearDtSession();
      if (cancelled) return;
      setAccounts(accountsIn(after, DT));
      setState({ status: 'signed-out', lastServerUrl: active.baseUrl, notice: active.signedIn ? DT_EXPIRED_NOTICE : undefined, login: active.login });
    })().catch(() => {
      if (!cancelled) setState({ status: 'signed-out', lastServerUrl: null });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const client = useMemo(
    // Without a token (a platform that hides the sign-in cookie) the cookie store carries the sign-in.
    () => (state.status === 'signed-in' ? new DtClient({ baseUrl: state.session.baseUrl, token: state.session.token || null }) : null),
    [state],
  );

  const activate = useCallback(
    async (id: string, stored: StoredDtSession) => {
      const [index] = await updateAccountIndex((current) => [setActive(current, DT, id), null]);
      await saveDtSession(stored);
      await clearSharedCookie(stored);
      clearDtQueries(queryClient);
      setAccounts(accountsIn(index, DT));
      setState({ status: 'signed-in', session: stored, accountId: id });
    },
    [queryClient],
  );

  const showSignInFor = useCallback(
    async (id: string, notice?: string) => {
      const [index, entry] = await updateAccountIndex(async (current) => {
        await deleteAccountSecret(id);
        const next = setActive(markSignedOut(current, id), DT, id);
        return [next, next.accounts.find((item) => item.id === id) ?? null];
      });
      await clearDtSession();
      clearDtQueries(queryClient);
      setAccounts(accountsIn(index, DT));
      setState({ status: 'signed-out', lastServerUrl: entry?.baseUrl ?? null, notice, login: entry?.login });
    },
    [queryClient],
  );

  const signIn = useCallback<DeepTutorContextValue['signIn']>(
    async ({ serverUrl, username, password }) => {
      const baseUrl = normalizeDtUrl(serverUrl);
      const result = await requestSignIn(new DtClient({ baseUrl }), username, password);
      const stored = toStoredDtSession(baseUrl, result.token ?? '', result.account);
      const [index, id] = await updateAccountIndex(async (current) => {
        const put = putAccount(current, fieldsOf(stored), uuidv4, nowMs());
        await saveAccountSecret(put.id, JSON.stringify(stored));
        return [put.index, put.id];
      });
      await saveDtSession(stored);
      clearDtQueries(queryClient);
      setAccounts(accountsIn(index, DT));
      setState({ status: 'signed-in', session: stored, accountId: id });
    },
    [queryClient],
  );

  const switchAccount = useCallback<DeepTutorContextValue['switchAccount']>(
    async (id) => {
      const stored = await readSecret(id);
      if (stored && isDtUsable(stored, nowMs())) {
        await activate(id, stored);
        return 'switched';
      }
      const entry = accounts.find((item) => item.id === id);
      await showSignInFor(id, entry ? `Sign in again as ${entry.login}.` : undefined);
      return 'sign-in';
    },
    [accounts, activate, showSignInFor],
  );

  const removeAccount = useCallback<DeepTutorContextValue['removeAccount']>(
    async (id, options) => {
      const stored = await readSecret(id);
      // Clears the cookie, which a DeepTutor page would otherwise keep using.
      if (stored) await clearSharedCookie(stored);
      const [index, dropped] = await updateAccountIndex(async (current) => {
        await deleteAccountSecret(id);
        const result = dropAccount(current, id);
        return [result.index, { ...result, baseUrl: current.accounts.find((item) => item.id === id)?.baseUrl ?? null }];
      });
      setAccounts(accountsIn(index, DT));
      if (!dropped.wasActive) return activeAccount(index, DT)?.signedIn ?? false;
      if (dropped.next) return (await switchAccount(dropped.next.id)) === 'switched';
      await clearDtSession();
      clearDtQueries(queryClient);
      setState({ status: 'signed-out', lastServerUrl: dropped.baseUrl, notice: options?.notice });
      return false;
    },
    [queryClient, switchAccount],
  );

  const signOut = useCallback<DeepTutorContextValue['signOut']>(
    async (options) => {
      return state.status === 'signed-in' ? removeAccount(state.accountId, options) : false;
    },
    [state, removeAccount],
  );

  const expireSession = useCallback<DeepTutorContextValue['expireSession']>(
    async (notice = DT_EXPIRED_NOTICE) => {
      if (state.status === 'signed-in') await showSignInFor(state.accountId, notice);
    },
    [state, showSignInFor],
  );

  // A 401 from DeepTutor: confirm with /api/auth/status before asking for the password again.
  const expireRef = useRef(expireSession);
  const clientRef = useRef(client);
  const verifying = useRef(false);
  useEffect(() => {
    expireRef.current = expireSession;
    clientRef.current = client;
  }, [expireSession, client]);

  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'error') return;
        const error = event.action.error;
        const current = clientRef.current;
        if (!(error instanceof DtHttpError) || !error.isUnauthorized || !current || verifying.current) return;
        verifying.current = true;
        getAuthStatus(current)
          .then((status) => (status.authenticated ? undefined : expireRef.current(DT_EXPIRED_NOTICE)))
          .catch(() => undefined)
          .finally(() => {
            verifying.current = false;
          });
      }),
    [queryClient],
  );

  const value = useMemo(
    () => ({ state, client, accounts, signIn, signOut, expireSession, switchAccount, removeAccount }),
    [state, client, accounts, signIn, signOut, expireSession, switchAccount, removeAccount],
  );
  return <DeepTutorContext.Provider value={value}>{children}</DeepTutorContext.Provider>;
}

export function useDeepTutor(): DeepTutorContextValue {
  const value = useContext(DeepTutorContext);
  if (!value) throw new Error('useDeepTutor must be used inside DeepTutorProvider');
  return value;
}

/** The signed-in DeepTutor client and session. Only for screens behind the DeepTutor sign-in guard. */
export function useDtAuthed(): { client: DtClient; session: StoredDtSession } {
  const { state, client } = useDeepTutor();
  if (state.status !== 'signed-in' || !client) throw new Error('useDtAuthed outside a DeepTutor screen');
  return { client, session: state.session };
}
