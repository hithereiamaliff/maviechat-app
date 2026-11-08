import { getFolder, isAtLeast, listFolderChats, listFolderChatsForAll, listFolders, updateFolder, type FolderChatsPage } from '@maviechat/owui-protocol';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { EmojiPicker } from '@/components/EmojiPicker';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { ChatBackground } from '@/features/chat/ChatBackground';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { Composer, type OutgoingMessage } from '@/features/chat/Composer';
import { carryOver } from '@/features/chat/drafts';
import { ModelPicker } from '@/features/chat/ModelPicker';
import { useModelChoice } from '@/features/chat/useModelChoice';
import { useSendMessage } from '@/features/chat/useSendMessage';
import { useSharedFolders } from '@/features/folders/queries';
import { useFolderActions } from '@/features/folders/useFolderActions';
import { isUnread } from '@/features/sidebar/rows';
import { emojiOfName, nameOfEmoji } from '@/lib/emoji';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

/** The server's page of a folder's chats. */
const FOLDER_PAGE_SIZE = 10;

function day(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => b[index] === id);

/**
 * A folder's page, as on the web: its icon (an emoji you pick, shown in the sidebar too), its
 * name (and from 0.12 its description), an input that starts chats inside it with the folder's
 * models, its chats (everyone's: people it's shared with may write in it), and its menu. Its
 * picture, if it has one, shows faintly behind. A folder shared with you to read shows its chats
 * only.
 */
export default function FolderScreen() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const folderId = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const { client, session } = useAuthed();
  const capabilities = useCapabilities();
  const foldersOn = capabilities?.feature('folders') ?? false;
  const newer = isAtLeast(capabilities?.version, '0.12.0');
  const folders = useQuery({ queryKey: ['folders'], queryFn: () => listFolders(client), enabled: foldersOn });
  const shared = useSharedFolders(foldersOn);
  const detail = useQuery({ queryKey: ['folder', folderId], queryFn: () => getFolder(client, folderId), enabled: foldersOn && Boolean(folderId) });
  // Everyone's chats, as the web lists a folder's (else yours alone, where a server lists only those).
  const chats = useInfiniteQuery({
    queryKey: ['folder-chats', folderId, 'everyone'],
    queryFn: ({ pageParam }): Promise<FolderChatsPage> =>
      listFolderChatsForAll(client, folderId, pageParam).catch(() =>
        listFolderChats(client, folderId, pageParam).then((list) => ({ chats: list, permission: 'write' as const, hasMore: list.length >= FOLDER_PAGE_SIZE })),
      ),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.hasMore ? all.length + 1 : undefined),
    enabled: foldersOn && Boolean(folderId),
  });
  const folderModelIds = (detail.data?.data?.model_ids ?? []).filter((id): id is string => typeof id === 'string');
  const choice = useModelChoice(undefined, folderModelIds);
  const { send } = useSendMessage();
  const folderActions = useFolderActions();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);

  const own = folders.data?.find((item) => item.id === folderId);
  const sharedFolder = own ? undefined : shared.data?.find((item) => item.id === folderId);
  const folder = own ?? sharedFolder;
  const missing = capabilities !== null && (!foldersOn || (folders.isSuccess && shared.isFetched && !folder));
  // Yours, or shared with you to write in: chats can start here, and it can be changed.
  const writable = Boolean(own) || sharedFolder?.permission === 'write';
  const draftKey = `folder:${folderId}`;
  const model = choice.model;
  const description = newer && typeof detail.data?.data?.description === 'string' ? detail.data.data.description.trim() : '';
  const backgroundUrl = detail.data?.meta?.background_image_url;
  const background = typeof backgroundUrl === 'string' && backgroundUrl ? backgroundUrl : null;
  const listed = chats.data?.pages.flatMap((page) => page.chats) ?? [];
  // The web's folder icon: an emoji's short name in `meta.icon` ('' for none).
  const savedIcon = typeof folder?.meta?.icon === 'string' ? folder.meta.icon : '';
  const icon = savedIcon ? emojiOfName(savedIcon) : '';
  const setIcon = (picked: string | null) => {
    updateFolder(client, folderId, { meta: { icon: picked ? nameOfEmoji(picked) : '' } }).then(
      () => {
        toast(picked ? 'Folder icon changed' : 'Folder icon removed');
        void queryClient.invalidateQueries({ queryKey: ['folders'] });
        void queryClient.invalidateQueries({ queryKey: ['folder', folderId] });
      },
      (error: unknown) => toast(`Couldn’t change the folder’s icon: ${describeError(error)}`, 'error'),
    );
  };

  // The web of 0.11 keeps the models last picked on a folder's page as the folder's own; from 0.12 they're set in its form.
  const pickModels = (ids: string[]) => {
    choice.pick(ids);
    if (newer || !ids.length || sameIds(ids, folderModelIds)) return;
    updateFolder(client, folderId, { data: { model_ids: ids } }).then(
      () => queryClient.invalidateQueries({ queryKey: ['folder', folderId] }),
      () => undefined,
    );
  };

  const start = async ({ text, files, toggles, toolIds, skillIds, filterIds, atModelId, chatVariables }: OutgoingMessage) => {
    const at = atModelId ? choice.models.find((item) => item.id === atModelId) : undefined;
    if (!model) {
      toast(choice.loading ? 'Loading models…' : 'No model is available to this account.', 'error');
      return false;
    }
    const result = await send({
      chatId: null,
      parentId: null,
      content: text,
      files,
      model: at ?? model,
      models: at ? [at] : choice.selected,
      toggles,
      toolIds,
      skillIds,
      filterIds,
      chatVariables,
      folderId,
    });
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
      <ChatHeader
        title={folder?.name}
        menu={folder && writable ? folderActions.items({ id: folder.id, name: folder.name }, { newChat: false, shared: Boolean(sharedFolder), onDeleted: () => router.replace('/') }) : undefined}
      />
      <View style={styles.screen}>
        {background ? <ChatBackground uri={background} /> : null}
        <KeyboardAvoidingView behavior="padding" style={styles.screen}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.greeting}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={icon ? `Folder icon ${icon}, change it` : 'Choose a folder icon'}
                disabled={!folder || !writable}
                onPress={() => setIconOpen(true)}
                style={({ pressed }) => [styles.icon, { backgroundColor: pressed ? palette.surfaceStrong : palette.surface }]}>
                {icon ? <Text style={styles.iconEmoji}>{icon}</Text> : <Icon name="folder-open" size={24} color={palette.textMuted} />}
              </Pressable>
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
                {folder?.name ?? ''}
              </Text>
              {description ? (
                <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={4}>
                  {description}
                </Text>
              ) : null}
              {sharedFolder ? (
                <Text style={[styles.description, { color: palette.textMuted }]}>
                  {`Shared with you by ${sharedFolder.owner_name || 'someone'}${sharedFolder.permission === 'write' ? '' : ', to read'}.`}
                </Text>
              ) : null}
            </View>

            {writable ? (
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
            ) : null}

            <View style={styles.chats}>
              <Text style={[styles.section, { color: palette.textFaint }]}>Chats</Text>
              {chats.isLoading ? (
                <ActivityIndicator style={styles.loading} color={palette.textMuted} />
              ) : listed.length === 0 ? (
                <Text style={[styles.empty, { color: palette.textMuted }]}>No chats in this folder yet.</Text>
              ) : (
                listed.map((chat) => (
                  <Pressable
                    key={chat.id}
                    accessibilityRole="button"
                    onPress={() => router.replace({ pathname: '/c/[id]', params: { id: chat.id } })}
                    style={({ pressed }) => [styles.row, { borderColor: palette.border, backgroundColor: background ? palette.background : undefined }, pressed && { backgroundColor: palette.surface }]}>
                    <Text style={[styles.chatTitle, { color: palette.text }]} numberOfLines={1}>
                      {chat.title || 'New Chat'}
                    </Text>
                    {chat.user_id && chat.user_id !== session.user.id ? (
                      <Text style={[styles.date, { color: palette.textFaint }]} numberOfLines={1}>
                        {`by ${chat.owner_name || 'someone'}`}
                      </Text>
                    ) : null}
                    {chat.active ? (
                      <ActivityIndicator size="small" color={palette.textMuted} />
                    ) : isUnread(chat) ? (
                      <View style={[styles.dot, { backgroundColor: palette.unread }]} accessibilityLabel="Unread" />
                    ) : null}
                    <Text style={[styles.date, { color: palette.textFaint }]}>{day(chat.updated_at)}</Text>
                  </Pressable>
                ))
              )}
              {chats.hasNextPage ? (
                <Pressable accessibilityRole="button" onPress={() => void chats.fetchNextPage()} disabled={chats.isFetchingNextPage} style={styles.more} hitSlop={6}>
                  {chats.isFetchingNextPage ? <ActivityIndicator color={palette.textMuted} /> : <Text style={[styles.moreText, { color: palette.link }]}>Show More</Text>}
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
      <ModelPicker
        visible={pickerOpen}
        models={choice.models}
        selectedIds={choice.selected.map((item) => item.id)}
        defaultIds={choice.defaultIds}
        onChange={pickModels}
        compareAllowed={choice.compareAllowed}
        onClose={() => setPickerOpen(false)}
      />
      {folderActions.element}
      <EmojiPicker visible={iconOpen} selected={icon || undefined} onClose={() => setIconOpen(false)} onPick={setIcon} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, paddingTop: 32, paddingBottom: 48, gap: 20 },
  greeting: { paddingHorizontal: 24, gap: 8, alignItems: 'center' },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  iconEmoji: { fontSize: 28 },
  title: { fontFamily: fonts.semibold, fontSize: 24, textAlign: 'center' },
  description: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
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
  more: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16 },
  moreText: { fontFamily: fonts.medium, fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  message: { fontFamily: fonts.regular, fontSize: 15, textAlign: 'center' },
  retry: { alignSelf: 'stretch' },
});
