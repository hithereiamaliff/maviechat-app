import { getMachine, OcClient, OcHttpError, pairDevice, revokeDevice } from '@maviechat/opencode-protocol';
import { uuidv4 } from '@maviechat/owui-protocol';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ANDROID, DEVICE } from '@/lib/device';
import { accountsIn, activeAccount, dropAccount, markSignedOut, putAccount, sameServer, setActive, type AccountEntry } from './accounts';
import { ocAccountName, parseStoredOcSession, type StoredOcSession } from './opencode-session';
import { OC_QUERY_ROOT } from './queryRoots';
import { deleteAccountSecret, loadAccountSecret, saveAccountSecret, updateAccountIndex } from './storage';

export type OcState =
  | { status: 'loading' }
  | { status: 'signed-out'; notice?: string }
  | {
      status: 'signed-in';
      session: StoredOcSession;
      /** The account in use: everything that belongs to one account is keyed by it. */
      accountId: string;
    };

interface OpenCodeContextValue {
  state: OcState;
  /** The client for the OpenCode login in use, otherwise null. */
  client: OcClient | null;
  /** OpenCode accounts (one per machine and login), in the order added. */
  accounts: AccountEntry[];
  /** Pairs this phone with a machine (its gateway address and a pairing code). Each OpenCode login there becomes an account; the first is put in use. */
  pair(input: { url: string; code: string }): Promise<void>;
  /** Puts another account in use. "sign-in": that machine no longer knows this phone, so it needs pairing again. */
  switchAccount(id: string): Promise<'switched' | 'sign-in'>;
  /** Forgets one account. When it was the machine's last, the machine unpairs this phone. True when an account is in use afterwards. */
  removeAccount(id: string): Promise<boolean>;
  /** Forgets the account in use. */
  signOut(): Promise<boolean>;
  /** The machine refused this phone (unpaired there): the account stays, needing a new pairing. */
  expireSession(notice?: string): Promise<void>;
}

const OpenCodeContext = createContext<OpenCodeContextValue | null>(null);

const OC = 'opencode';
const nowMs = () => Date.now();
const readSecret = async (id: string) => parseStoredOcSession(await loadAccountSecret(id));
const clearOcQueries = (queryClient: QueryClient) => queryClient.removeQueries({ queryKey: [OC_QUERY_ROOT] });
const deviceName = () => (Constants.deviceName ? String(Constants.deviceName) : ANDROID ? 'Android phone' : 'iPhone').slice(0, 80);
const clientOf = (session: StoredOcSession, timeoutMs?: number) => new OcClient({ gatewayUrl: session.gatewayUrl, token: session.token, login: session.login.id, timeoutMs });

export const unpairedNotice = (machine: string) => `This ${DEVICE} isn't paired with ${machine} any more. Pair it again.`;

/** The OpenCode machines this phone is paired with, beside the Open WebUI and DeepTutor sign-ins. */
export function OpenCodeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<OcState>({ status: 'loading' });
  const [accounts, setAccounts] = useState<AccountEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [index, active] = await updateAccountIndex((current) => [current, activeAccount(current, OC)]);
      const stored = active?.signedIn ? await readSecret(active.id) : null;
      if (cancelled) return;
      setAccounts(accountsIn(index, OC));
      if (active && stored) setState({ status: 'signed-in', session: stored, accountId: active.id });
      else setState({ status: 'signed-out', notice: active ? unpairedNotice(active.name) : undefined });
    })().catch(() => {
      if (!cancelled) setState({ status: 'signed-out' });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const client = useMemo(() => (state.status === 'signed-in' ? clientOf(state.session) : null), [state]);

  const activate = useCallback(
    async (id: string, stored: StoredOcSession) => {
      const [index] = await updateAccountIndex((current) => [setActive(current, OC, id), null]);
      clearOcQueries(queryClient);
      setAccounts(accountsIn(index, OC));
      setState({ status: 'signed-in', session: stored, accountId: id });
    },
    [queryClient],
  );

  const pair = useCallback<OpenCodeContextValue['pair']>(
    async ({ url, code }) => {
      const gatewayUrl = url.trim().replace(/\/+$/, '');
      const result = await pairDevice((input, init) => fetch(input, init), gatewayUrl, code, deviceName());
      const machine = await getMachine(new OcClient({ gatewayUrl, token: result.token, login: '' }));
      if (machine.logins.length === 0) throw new Error('That machine has no OpenCode server set up for MavieChat.');
      // Pairing the same machine again replaces the old pairing: its device is unpaired afterwards.
      const previous = new Set<string>();
      for (const entry of accounts.filter((item) => sameServer(item.baseUrl, gatewayUrl))) {
        const old = await readSecret(entry.id);
        if (old && old.deviceId !== result.deviceId) previous.add(old.deviceId);
      }
      const [index, first] = await updateAccountIndex(async (current) => {
        let next = current;
        let firstId: string | null = null;
        for (const login of machine.logins) {
          const stored: StoredOcSession = { version: 1, gatewayUrl, token: result.token, deviceId: result.deviceId, machineName: machine.name, login: { id: login.id, name: login.name } };
          const put = putAccount(
            next,
            { space: OC, baseUrl: gatewayUrl, userId: login.id, name: ocAccountName(machine.name, login.name, machine.logins.length), login: login.name, expiresAt: null, signedIn: true },
            uuidv4,
            nowMs(),
          );
          await saveAccountSecret(put.id, JSON.stringify(stored));
          next = put.index;
          firstId ??= put.id;
        }
        return [setActive(next, OC, firstId), firstId];
      });
      const newClient = new OcClient({ gatewayUrl, token: result.token, login: '' });
      for (const deviceId of previous) await revokeDevice(newClient, deviceId).catch(() => undefined);
      const stored = first ? await readSecret(first) : null;
      if (!first || !stored) throw new Error('Pairing worked, but the account could not be saved.');
      clearOcQueries(queryClient);
      setAccounts(accountsIn(index, OC));
      setState({ status: 'signed-in', session: stored, accountId: first });
    },
    [accounts, queryClient],
  );

  const showUnpaired = useCallback(
    async (id: string, notice?: string) => {
      const [index, entry] = await updateAccountIndex((current) => {
        const next = setActive(markSignedOut(current, id), OC, id);
        return [next, next.accounts.find((item) => item.id === id) ?? null];
      });
      clearOcQueries(queryClient);
      setAccounts(accountsIn(index, OC));
      setState({ status: 'signed-out', notice: notice ?? (entry ? unpairedNotice(entry.name) : undefined) });
    },
    [queryClient],
  );

  const switchAccount = useCallback<OpenCodeContextValue['switchAccount']>(
    async (id) => {
      const entry = accounts.find((item) => item.id === id);
      const stored = entry?.signedIn ? await readSecret(id) : null;
      if (stored) {
        await activate(id, stored);
        return 'switched';
      }
      await showUnpaired(id);
      return 'sign-in';
    },
    [accounts, activate, showUnpaired],
  );

  const removeAccount = useCallback<OpenCodeContextValue['removeAccount']>(
    async (id) => {
      const stored = await readSecret(id);
      const [index, dropped] = await updateAccountIndex(async (current) => {
        await deleteAccountSecret(id);
        const result = dropAccount(current, id);
        return [result.index, result];
      });
      // The machine's last account: it unpairs this phone, so the token stops working there too.
      if (stored && !accountsIn(index, OC).some((item) => sameServer(item.baseUrl, stored.gatewayUrl))) {
        await revokeDevice(clientOf(stored, 5000), stored.deviceId).catch(() => undefined);
      }
      setAccounts(accountsIn(index, OC));
      if (!dropped.wasActive) return activeAccount(index, OC)?.signedIn ?? false;
      if (dropped.next) return (await switchAccount(dropped.next.id)) === 'switched';
      clearOcQueries(queryClient);
      setState({ status: 'signed-out' });
      return false;
    },
    [queryClient, switchAccount],
  );

  const signOut = useCallback<OpenCodeContextValue['signOut']>(async () => (state.status === 'signed-in' ? removeAccount(state.accountId) : false), [state, removeAccount]);

  const expireSession = useCallback<OpenCodeContextValue['expireSession']>(
    async (notice) => {
      if (state.status === 'signed-in') await showUnpaired(state.accountId, notice ?? unpairedNotice(state.session.machineName));
    },
    [state, showUnpaired],
  );

  // A 401 from the gateway means the machine no longer knows this phone.
  const expireRef = useRef(expireSession);
  useEffect(() => {
    expireRef.current = expireSession;
  }, [expireSession]);
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'error') return;
        const error = event.action.error;
        if (error instanceof OcHttpError && error.isUnpaired && event.query.queryKey[0] === OC_QUERY_ROOT) void expireRef.current();
      }),
    [queryClient],
  );

  const value = useMemo(
    () => ({ state, client, accounts, pair, switchAccount, removeAccount, signOut, expireSession }),
    [state, client, accounts, pair, switchAccount, removeAccount, signOut, expireSession],
  );
  return <OpenCodeContext.Provider value={value}>{children}</OpenCodeContext.Provider>;
}

export function useOpenCode(): OpenCodeContextValue {
  const value = useContext(OpenCodeContext);
  if (!value) throw new Error('useOpenCode must be used inside OpenCodeProvider');
  return value;
}

/** The OpenCode client, session and account in use. Only for screens behind the OpenCode guard. */
export function useOcAuthed(): { client: OcClient; session: StoredOcSession; accountId: string } {
  const { state, client } = useOpenCode();
  if (state.status !== 'signed-in' || !client) throw new Error('useOcAuthed outside an OpenCode screen');
  return { client, session: state.session, accountId: state.accountId };
}
