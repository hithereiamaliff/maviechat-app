import * as Notifications from 'expo-notifications';
import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';
import { sameServer, type AccountEntry } from '@/session/accounts';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useOpenCode } from '@/session/OpenCodeProvider';
import { isRelayServer } from './relay';
import { useSession } from '@/session/SessionProvider';
import { saveSpace } from '@/session/storage';
import { shouldPresent } from './presence';

// While the app is open: a banner for everything except the chat on screen.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const show = shouldPresent(notification.request.content.data as { chatId?: unknown; sessionId?: unknown; kind?: unknown } | null);
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
  },
});

type NotificationData = { kind?: unknown; chatId?: unknown; sessionId?: unknown; userId?: unknown; machine?: unknown; login?: unknown; directory?: unknown };

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** An OpenCode notification opens its session, in the machine and login it came from. */
function openOpenCode(data: NotificationData, oc: { accounts: AccountEntry[]; activeId: string | null; switchAccount: (id: string) => Promise<'switched' | 'sign-in'> }) {
  const sessionId = text(data.sessionId);
  const directory = text(data.directory);
  const open = () => {
    void saveSpace('opencode');
    if (sessionId && directory) router.replace({ pathname: '/code/s/[id]', params: { id: sessionId, dir: directory } });
    else router.replace('/code');
  };
  const account = oc.accounts.find((entry) => entry.signedIn && entry.userId === text(data.login) && sameServer(entry.baseUrl, text(data.machine)));
  // That machine isn't paired on this phone any more.
  if (!account) return;
  if (account.id === oc.activeId) {
    open();
    return;
  }
  void oc.switchAccount(account.id).then(
    (result) => (result === 'switched' ? open() : router.replace('/pair')),
    () => open(),
  );
}

/**
 * Opens the chat a tapped notification is about (Open WebUI's, DeepTutor's or an OpenCode
 * session), from a cold start too. One for another account switches to that account first.
 */
export function NotificationRoot() {
  const response = Notifications.useLastNotificationResponse();
  const ready = Boolean(useRootNavigationState()?.key);
  const owui = useSession();
  const owuiStatus = owui.state.status;
  const activeUserId = owui.state.status === 'signed-in' ? owui.state.session.user.id : null;
  const { accounts, switchAccount } = owui;
  const deeptutor = useDeepTutor().state.status;
  const openCode = useOpenCode();
  const ocStatus = openCode.state.status;
  const ocActiveId = openCode.state.status === 'signed-in' ? openCode.state.accountId : null;
  const ocAccounts = openCode.accounts;
  const ocSwitch = openCode.switchAccount;
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const data = response.notification.request.content.data as NotificationData | null;
    const forOpenCode = data?.kind === 'opencode';
    const forDeepTutor = !forOpenCode && typeof data?.kind === 'string' && data.kind.startsWith('deeptutor');
    // Wait for the space's own sign-in to load before going there.
    if (forOpenCode ? ocStatus === 'loading' : (forDeepTutor ? deeptutor : owuiStatus) !== 'signed-in') return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    Notifications.clearLastNotificationResponse();
    if (forOpenCode && data) {
      openOpenCode(data, { accounts: ocAccounts, activeId: ocActiveId, switchAccount: ocSwitch });
      return;
    }
    if (forDeepTutor) {
      void saveSpace('deeptutor');
      if (typeof data?.sessionId === 'string' && data.sessionId) router.replace({ pathname: '/learn/[id]', params: { id: data.sessionId } });
      else router.replace('/learn');
      return;
    }
    const open = () => {
      void saveSpace('owui');
      if (typeof data?.chatId === 'string' && data.chatId) router.replace({ pathname: '/c/[id]', params: { id: data.chatId } });
      else router.replace('/');
    };
    const userId = typeof data?.userId === 'string' ? data.userId : null;
    const account = userId && userId !== activeUserId ? accounts.find((entry) => entry.userId === userId && entry.signedIn && isRelayServer('owui', entry.baseUrl)) : undefined;
    if (!account) {
      open();
      return;
    }
    void switchAccount(account.id)
      .then((result) => (result === 'switched' ? open() : router.replace('/login')))
      .catch(() => open());
  }, [ready, owuiStatus, deeptutor, ocStatus, ocActiveId, ocAccounts, ocSwitch, response, activeUserId, accounts, switchAccount]);

  return null;
}
