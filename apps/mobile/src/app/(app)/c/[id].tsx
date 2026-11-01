import { OwuiHttpError } from '@maviechat/owui-protocol';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import type { MenuItem } from '@/components/Menu';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { Composer } from '@/features/chat/Composer';
import { MessageList } from '@/features/chat/MessageList';
import { ModelPicker } from '@/features/chat/ModelPicker';
import { useChatView } from '@/features/chat/useChatView';
import { useModelChoice } from '@/features/chat/useModelChoice';
import { useSendMessage } from '@/features/chat/useSendMessage';
import { useChatActions } from '@/features/chats/useChatActions';
import { useAuthed, useModels } from '@/lib/server';
import { fonts, usePalette } from '@/theme';

export default function ChatScreen() {
  const palette = usePalette();
  const params = useLocalSearchParams<{ id: string }>();
  const chatId = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const { session } = useAuthed();
  const models = useModels();
  const actions = useChatActions();
  const { query, messages, position, step, select } = useChatView(chatId);
  const choice = useModelChoice(query.data);
  const { send, stop } = useSendMessage();
  const [pickerOpen, setPickerOpen] = useState(false);

  const chat = query.data;
  const ref = { id: chatId, title: chat?.title ?? 'this chat' };
  const pinned = chat?.pinned === true;
  const toNewChat = () => router.replace('/');
  const menu: MenuItem[] = chat
    ? [
        { key: 'rename', label: 'Rename', icon: 'pencil', onPress: () => actions.rename(ref) },
        { key: 'pin', label: pinned ? 'Unpin' : 'Pin', icon: pinned ? 'bookmark-slash' : 'bookmark', onPress: () => actions.togglePin(ref, pinned) },
        { key: 'archive', label: 'Archive', icon: 'archive-box', onPress: () => void actions.archive(ref, toNewChat) },
        ...(actions.canDelete
          ? [{ key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => actions.remove(ref, toNewChat) }]
          : []),
      ]
    : [];

  const status = query.error instanceof OwuiHttpError ? query.error.status : null;
  const notFound = status === 404;
  const noAccess = status === 401 || status === 403;
  const streaming = messages.some((message) => message.role === 'assistant' && message.done === false);
  const lastId = messages[messages.length - 1]?.id;

  const onSend = async (text: string) => {
    if (!choice.model) return false;
    const result = await send({ chatId, leafId: lastId ?? null, content: text, model: choice.model });
    if (result) select(result.replyId);
    return Boolean(result);
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ChatHeader title={chat?.title} menu={menu} />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        {query.isLoading ? (
          <ActivityIndicator style={styles.center} color={palette.textMuted} />
        ) : query.isError ? (
          <View style={styles.center}>
            <Text style={[styles.message, { color: palette.textMuted }]}>
              {notFound
                ? "This chat doesn't exist anymore."
                : noAccess
                  ? "You don't have access to this chat."
                  : "Couldn't load this chat. Check your connection."}
            </Text>
            <View style={styles.retry}>
              {notFound || noAccess ? (
                <Button label="New chat" onPress={toNewChat} />
              ) : (
                <Button label="Try again" onPress={() => void query.refetch()} />
              )}
            </View>
          </View>
        ) : (
          <MessageList
            messages={messages}
            models={models.data}
            position={position}
            onStep={step}
            onFollowUp={(text) => void onSend(text)}
            pinToBottomKey={lastId}
            baseUrl={session.baseUrl}
            token={session.token}
          />
        )}
        {query.isError ? null : (
          <Composer
            modelLabel={choice.model?.name ?? 'Select a model'}
            onPickModel={() => setPickerOpen(true)}
            onSend={onSend}
            onStop={() => void stop(chatId)}
            streaming={streaming}
          />
        )}
      </KeyboardAvoidingView>
      <ModelPicker
        visible={pickerOpen}
        models={choice.models}
        selectedId={choice.model?.id ?? null}
        defaultId={choice.defaultId}
        onSelect={choice.pick}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  message: { fontFamily: fonts.regular, fontSize: 15, textAlign: 'center' },
  retry: { alignSelf: 'stretch' },
});
