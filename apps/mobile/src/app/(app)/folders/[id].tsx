import { listFolderChats, listFolders } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { Composer, type OutgoingMessage } from '@/features/chat/Composer';
import { carryOver } from '@/features/chat/drafts';
import { ModelPicker } from '@/features/chat/ModelPicker';
import { useModelChoice } from '@/features/chat/useModelChoice';
import { useSendMessage } from '@/features/chat/useSendMessage';
import { isUnread } from '@/features/sidebar/rows';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

function day(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** A folder's page, as on the web: its name, an input that starts chats inside it, and its chats. */
export default function FolderScreen() {
  const palette = usePalette();
  const toast = useToast();
  const params = useLocalSearchParams<{ id: string }>();
  const folderId = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const foldersOn = capabilities?.feature('folders') ?? false;
  const folders = useQuery({ queryKey: ['folders'], queryFn: () => listFolders(client), enabled: foldersOn });
  const chats = useQuery({ queryKey: ['folder-chats', folderId], queryFn: () => listFolderChats(client, folderId), enabled: foldersOn && Boolean(folderId) });
  const choice = useModelChoice(undefined);
  const { send } = useSendMessage();
  const [pickerOpen, setPickerOpen] = useState(false);

  const folder = folders.data?.find((item) => item.id === folderId);
  const missing = capabilities !== null && (!foldersOn || (folders.isSuccess && !folder));
  const draftKey = `folder:${folderId}`;
  const model = choice.model;

  const start = async ({ text, files, toggles, toolIds }: OutgoingMessage) => {
    if (!model) {
      toast(choice.loading ? 'Loading models…' : 'No model is available to this account.', 'error');
      return false;
    }
    const result = await send({ chatId: null, parentId: null, content: text, files, model, models: choice.selected, toggles, toolIds, folderId });
    if (!result) return false;
    carryOver(draftKey, result.chatId);
    router.replace({ pathname: '/c/[id]', params: { id: result.chatId } });
    return true;
  };

  if (missing) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <ChatHeader title="Folder" />
        <View style={styles.center}>
          <Text style={[styles.message, { color: palette.textMuted }]}>
            {foldersOn ? "This folder doesn't exist anymore." : 'Folders are turned off for this account.'}
          </Text>
          <View style={styles.retry}>
            <Button label="New chat" onPress={() => router.replace('/')} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ChatHeader title={folder?.name} />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.greeting}>
            <Icon name="folder-open" size={30} color={palette.textMuted} />
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
              {folder?.name ?? ''}
            </Text>
          </View>

          <Composer
            floating
            draftKey={draftKey}
            placeholder="How can I help you today?"
            model={model}
            models={choice.selected}
            modelLabel={choice.label}
            onPickModel={() => setPickerOpen(true)}
            onSend={start}
            onStop={() => {}}
            streaming={false}
          />

          <View style={styles.chats}>
            <Text style={[styles.section, { color: palette.textFaint }]}>Chats</Text>
            {chats.isLoading ? (
              <ActivityIndicator style={styles.loading} color={palette.textMuted} />
            ) : (chats.data ?? []).length === 0 ? (
              <Text style={[styles.empty, { color: palette.textMuted }]}>No chats in this folder yet.</Text>
            ) : (
              chats.data?.map((chat) => (
                <Pressable
                  key={chat.id}
                  accessibilityRole="button"
                  onPress={() => router.replace({ pathname: '/c/[id]', params: { id: chat.id } })}
                  style={({ pressed }) => [styles.row, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                  <Text style={[styles.chatTitle, { color: palette.text }]} numberOfLines={1}>
                    {chat.title || 'New Chat'}
                  </Text>
                  {chat.active ? (
                    <ActivityIndicator size="small" color={palette.textMuted} />
                  ) : isUnread(chat) ? (
                    <View style={[styles.dot, { backgroundColor: palette.unread }]} accessibilityLabel="Unread" />
                  ) : null}
                  <Text style={[styles.date, { color: palette.textFaint }]}>{day(chat.updated_at)}</Text>
                </Pressable>
              ))
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <ModelPicker
        visible={pickerOpen}
        models={choice.models}
        selectedIds={choice.selected.map((item) => item.id)}
        defaultIds={choice.defaultIds}
        onChange={choice.pick}
        compareAllowed={choice.compareAllowed}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, paddingTop: 32, paddingBottom: 48, gap: 20 },
  greeting: { paddingHorizontal: 24, gap: 8, alignItems: 'center' },
  title: { fontFamily: fonts.semibold, fontSize: 24, textAlign: 'center' },
  chats: { paddingHorizontal: 16, gap: 6 },
  section: { fontFamily: fonts.medium, fontSize: 13, paddingHorizontal: 4, marginBottom: 2 },
  loading: { marginVertical: 16 },
  empty: { fontFamily: fonts.regular, fontSize: 14, paddingHorizontal: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chatTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 15 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  date: { fontFamily: fonts.regular, fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  message: { fontFamily: fonts.regular, fontSize: 15, textAlign: 'center' },
  retry: { alignSelf: 'stretch' },
});
