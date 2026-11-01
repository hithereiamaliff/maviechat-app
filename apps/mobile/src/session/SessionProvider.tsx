import {
  normalizeBaseUrl,
  OwuiClient,
  signIn as requestSignIn,
  signOut as requestSignOut,
} from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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

  const value = useMemo(() => ({ state, client, signIn, signOut }), [state, client, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export { EXPIRED_NOTICE };
