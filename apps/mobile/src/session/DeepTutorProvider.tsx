import {
  DtClient,
  DtHttpError,
  getAuthStatus,
  normalizeDtUrl,
  signIn as requestSignIn,
  signOut as requestSignOut,
} from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isDtUsable, toStoredDtSession, type StoredDtSession } from './deeptutor-session';
import { clearDtSession, loadDtSession, loadLastDtServerUrl, saveDtSession } from './storage';

export type DtState =
  | { status: 'loading' }
  | { status: 'signed-out'; lastServerUrl: string | null; notice?: string }
  | { status: 'signed-in'; session: StoredDtSession };

interface DeepTutorContextValue {
  state: DtState;
  /** Signed-in client, otherwise null. */
  client: DtClient | null;
  signIn(input: { serverUrl: string; username: string; password: string }): Promise<void>;
  signOut(options?: { notice?: string }): Promise<void>;
}

/** Every DeepTutor query key starts with this, so signing out clears exactly those. */
export const DT_QUERY_ROOT = 'dt';

const DeepTutorContext = createContext<DeepTutorContextValue | null>(null);

export const DT_EXPIRED_NOTICE = 'Your DeepTutor sign-in expired. Please sign in again.';

/**
 * The DeepTutor sign-in, kept beside the Open WebUI one. Each server has its own
 * Keychain entry and its own cached data; switching never mixes them.
 */
export function DeepTutorProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<DtState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stored, lastServerUrl] = await Promise.all([loadDtSession(), loadLastDtServerUrl()]);
      if (cancelled) return;
      if (stored && isDtUsable(stored, Date.now())) {
        setState({ status: 'signed-in', session: stored });
        return;
      }
      if (stored) await clearDtSession();
      setState({ status: 'signed-out', lastServerUrl, notice: stored ? DT_EXPIRED_NOTICE : undefined });
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

  const signIn = useCallback<DeepTutorContextValue['signIn']>(
    async ({ serverUrl, username, password }) => {
      const baseUrl = normalizeDtUrl(serverUrl);
      const result = await requestSignIn(new DtClient({ baseUrl }), username, password);
      const stored = toStoredDtSession(baseUrl, result.token ?? '', result.account);
      await saveDtSession(stored);
      queryClient.removeQueries({ queryKey: [DT_QUERY_ROOT] });
      setState({ status: 'signed-in', session: stored });
    },
    [queryClient],
  );

  const signOut = useCallback<DeepTutorContextValue['signOut']>(
    async (options) => {
      if (state.status !== 'signed-in') return;
      const { baseUrl, token } = state.session;
      try {
        // Clears the cookie, which the web view would otherwise keep using.
        await requestSignOut(new DtClient({ baseUrl, token: token || null, timeoutMs: 5000 }));
      } catch {
        // ignored on purpose: sign out locally even offline
      }
      await clearDtSession();
      queryClient.removeQueries({ queryKey: [DT_QUERY_ROOT] });
      setState({ status: 'signed-out', lastServerUrl: baseUrl, notice: options?.notice });
    },
    [state, queryClient],
  );

  // A 401 from DeepTutor: confirm with /api/auth/status before signing out.
  const signOutRef = useRef(signOut);
  const clientRef = useRef(client);
  const verifying = useRef(false);
  useEffect(() => {
    signOutRef.current = signOut;
    clientRef.current = client;
  }, [signOut, client]);

  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'error') return;
        const error = event.action.error;
        const current = clientRef.current;
        if (!(error instanceof DtHttpError) || !error.isUnauthorized || !current || verifying.current) return;
        verifying.current = true;
        getAuthStatus(current)
          .then((status) => (status.authenticated ? undefined : signOutRef.current({ notice: DT_EXPIRED_NOTICE })))
          .catch(() => undefined)
          .finally(() => {
            verifying.current = false;
          });
      }),
    [queryClient],
  );

  const value = useMemo(() => ({ state, client, signIn, signOut }), [state, client, signIn, signOut]);
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
