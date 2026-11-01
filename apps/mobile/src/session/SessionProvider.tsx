import {
  getSessionUser,
  normalizeBaseUrl,
  OwuiClient,
  OwuiHttpError,
  signIn as requestSignIn,
  signOut as requestSignOut,
} from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clearSession, loadLastServerUrl, loadSession, saveSession } from './storage';
import { isUsable, toStoredSession, type StoredSession } from './stored-session';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out'; lastServerUrl: string | null; notice?: string }
  | { status: 'signed-in'; session: StoredSession };

export type SignInOutcome = { kind: 'signed-in' } | { kind: 'pending' } | { kind: 'mfa' };

interface SessionContextValue {
  state: SessionState;
  /** Authenticated client while signed in, otherwise null. */
  client: OwuiClient | null;
  signIn(input: { serverUrl: string; email: string; password: string }): Promise<SignInOutcome>;
  signOut(options?: { notice?: string }): Promise<void>;
  /**
   * Call after a 401. Open WebUI also answers 401 for "not permitted", so this re-checks
   * the session (as the web app does) and signs out only when the session itself is gone.
   */
  verifySession(): void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const EXPIRED_NOTICE = 'Your session expired. Please sign in again.';

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stored, lastServerUrl] = await Promise.all([loadSession(), loadLastServerUrl()]);
      if (cancelled) return;
      if (stored && isUsable(stored, Date.now())) {
        setState({ status: 'signed-in', session: stored });
        return;
      }
      if (stored) await clearSession();
      setState({ status: 'signed-out', lastServerUrl, notice: stored ? EXPIRED_NOTICE : undefined });
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

  const signIn = useCallback<SessionContextValue['signIn']>(
    async ({ serverUrl, email, password }) => {
      const baseUrl = normalizeBaseUrl(serverUrl);
      const result = await requestSignIn(new OwuiClient({ baseUrl }), email.trim(), password);
      if (result.kind === 'pending') return { kind: 'pending' };
      if (result.kind === 'mfa') return { kind: 'mfa' };

      const stored = toStoredSession(baseUrl, result.session);
      await saveSession(stored);
      queryClient.clear();
      setState({ status: 'signed-in', session: stored });
      return { kind: 'signed-in' };
    },
    [queryClient],
  );

  const signOut = useCallback<SessionContextValue['signOut']>(
    async (options) => {
      if (state.status !== 'signed-in') return;
      const { baseUrl, token } = state.session;
      try {
        // Revoke the token on the server; sign out locally even when that fails (offline, already expired).
        await requestSignOut(new OwuiClient({ baseUrl, token, timeoutMs: 5000 }));
      } catch {
        // ignored on purpose
      }
      await clearSession();
      queryClient.clear();
      setState({ status: 'signed-out', lastServerUrl: baseUrl, notice: options?.notice });
    },
    [state, queryClient],
  );

  // Kept in refs so the query-cache subscription below doesn't resubscribe on every state change.
  const signOutRef = useRef(signOut);
  const clientRef = useRef(client);
  const verifying = useRef(false);
  useEffect(() => {
    signOutRef.current = signOut;
    clientRef.current = client;
  }, [signOut, client]);

  const verifySession = useCallback(() => {
    const current = clientRef.current;
    if (!current || verifying.current) return;
    verifying.current = true;
    getSessionUser(current)
      .catch((error: unknown) => {
        if (error instanceof OwuiHttpError && error.isUnauthorized) return signOutRef.current({ notice: EXPIRED_NOTICE });
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
    () => ({ state, client, signIn, signOut, verifySession }),
    [state, client, signIn, signOut, verifySession],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export { EXPIRED_NOTICE };
