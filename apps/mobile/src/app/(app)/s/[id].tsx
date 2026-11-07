import { branchPath, cloneSharedChat, getSharedChat, getUserInfo, initialLeaf, OwuiHttpError, siblingPosition, switchSibling, type ChatHistory } from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackHeader } from '@/components/BackHeader';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { MessageList } from '@/features/chat/MessageList';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useModels } from '@/lib/server';
import { useInterface } from '@/lib/uiSettings';
import { fonts, usePalette } from '@/theme';

const EMPTY: ChatHistory = { messages: {}, currentId: null };
const READ_ONLY = { canDeleteMessage: false, canDeleteReply: false };

/**
 * A chat shared by link (the web's `/s/…` page): its title, when it was shared and by whom, and
 * its messages to read (switching a reply's versions stays on the phone), with Clone Chat to
 * carry on in a copy of your own, as on the web.
 */
export default function SharedChatScreen() {
  const palette = usePalette();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { client, session } = useAuthed();
  const capabilities = useCapabilities();
  const models = useModels();
  const ui = useInterface();
  const params = useLocalSearchParams<{ id: string }>();
  const shareId = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const shared = useQuery({ queryKey: ['shared-chat', shareId], queryFn: () => getSharedChat(client, shareId), enabled: Boolean(shareId) });
  const chat = shared.data;
  const ownerId = typeof chat?.user_id === 'string' ? chat.user_id : '';
  const owner = useQuery({ queryKey: ['user-info', ownerId], queryFn: () => getUserInfo(client, ownerId), enabled: Boolean(ownerId) && ownerId !== session.user.id, staleTime: 10 * 60_000 });
  const history = chat?.chat?.history ?? EMPTY;
  const [picked, setPicked] = useState<string | null>(null);
  const leaf = picked && history.messages[picked] ? picked : initialLeaf(history, chat?.current_message_id);
  const messages = useMemo(() => branchPath(history, leaf), [history, leaf]);
  const [cloning, setCloning] = useState(false);
  // As on the web: admins, and accounts allowed to import chats.
  const canClone = capabilities ? capabilities.isAdmin || capabilities.can('chat.import', true) : false;

  const stamp = typeof chat?.chat?.timestamp === 'number' ? chat.chat.timestamp : chat?.updated_at ? chat.updated_at * 1000 : 0;
  const when = stamp ? new Date(stamp).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const by = ownerId === session.user.id ? 'you' : owner.data?.name;
  const status = shared.error instanceof OwuiHttpError ? shared.error.status : null;

  const clone = async () => {
    if (!chat) return;
    setCloning(true);
    try {
      const copy = await cloneSharedChat(client, chat.id);
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      router.replace({ pathname: '/c/[id]', params: { id: copy.id } });
    } catch (error) {
      toast(`Couldn’t clone the chat: ${describeError(error)}`, 'error');
    } finally {
      setCloning(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <BackHeader title={chat?.title || 'Shared Chat'} fallback="/" />
      {shared.isLoading ? (
        <ActivityIndicator style={styles.center} color={palette.textMuted} />
      ) : !chat ? (
        <View style={styles.center}>
          <Text style={[styles.message, { color: palette.textMuted }]}>
            {status === 401 || status === 403 || status === 404 ? 'This shared chat isn’t there, or isn’t shared with you.' : `Couldn’t open the shared chat: ${describeError(shared.error)}`}
          </Text>
          {status === null ? <Button label="Try again" onPress={() => void shared.refetch()} /> : null}
        </View>
      ) : (
        <>
          <Text style={[styles.facts, { color: palette.textMuted }]} numberOfLines={1}>
            {['Shared chat', when, by ? `by ${by}` : ''].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.screen}>
            <MessageList
              messages={messages}
              actions={READ_ONLY}
              models={models.data}
              position={(id) => siblingPosition(history, id)}
              onStep={(id, step) => {
                const next = switchSibling(history, id, step);
                if (next) setPicked(next);
              }}
              baseUrl={session.baseUrl}
              token={session.token}
              history={history}
              onShow={setPicked}
              multiAsTabs={ui('displayMultiModelResponsesInTabs')}
              scrollOnBranchChange={ui('scrollOnBranchChange')}
            />
          </View>
          {canClone ? (
            <View style={[styles.bottom, { paddingBottom: insets.bottom + 10, borderTopColor: palette.border }]}>
              <Button label="Clone Chat" onPress={() => void clone()} loading={cloning} />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  message: { fontFamily: fonts.regular, fontSize: 15, textAlign: 'center' },
  facts: { fontFamily: fonts.regular, fontSize: 12, paddingHorizontal: 16, paddingBottom: 6 },
  bottom: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
