import { getFolder, isAtLeast, listFolderChats, listFolders, updateFolder } from '@maviechat/owui-protocol';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { Composer, type OutgoingMessage } from '@/features/chat/Composer';
import { carryOver } from '@/features/chat/drafts';
import { ModelPicker } from '@/features/chat/ModelPicker';
import { useModelChoice } from '@/features/chat/useModelChoice';
import { useSendMessage } from '@/features/chat/useSendMessage';
import { useFolderActions } from '@/features/folders/useFolderActions';
import { isUnread } from '@/features/sidebar/rows';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

/** The server's page of a folder's chats. */
const FOLDER_PAGE_SIZE = 10;

function day(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => b[index] === id);

/**
 * A folder's page, as on the web: its name (and from 0.12 its description), an input that starts
 * chats inside it with the folder's models, its chats, and its menu. Its picture, if it has one,
 * shows faintly behind.
 */
export default function FolderScreen() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const folderId = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const foldersOn = capabilities?.feature('folders') ?? false;
  const newer = isAtLeast(capabilities?.version, '0.12.0');
  const folders = useQuery({ queryKey: ['folders'], queryFn: () => listFolders(client), enabled: foldersOn });
  const detail = useQuery({ queryKey: ['folder', folderId], queryFn: () => getFolder(client, folderId), enabled: foldersOn && Boolean(folderId) });
  const chats = useInfiniteQuery({
    queryKey: ['folder-chats', folderId, 'pages'],
    queryFn: ({ pageParam }) => listFolderChats(client, folderId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.length >= FOLDER_PAGE_SIZE ? all.length + 1 : undefined),
    enabled: foldersOn && Boolean(folderId),
  });
  const folderModelIds = (detail.data?.data?.model_ids ?? []).filter((id): id is string => typeof id === 'string');
  const choice = useModelChoice(undefined, folderModelIds);
  const { send } = useSendMessage();
  const folderActions = useFolderActions();
  const [pickerOpen, setPickerOpen] = useState(false);

  const folder = folders.data?.find((item) => item.id === folderId);
  const missing = capabilities !== null && (!foldersOn || (folders.isSuccess && !folder));
  const draftKey = `folder:${folderId}`;
  const model = choice.model;
  const description = newer && typeof detail.data?.data?.description === 'string' ? detail.data.data.description.trim() : '';
  const backgroundUrl = detail.data?.meta?.background_image_url;
  const background = typeof backgroundUrl === 'string' && backgroundUrl ? backgroundUrl : null;
  const listed = chats.data?.pages.flat() ?? [];

  // The web of 0.11 keeps the models last picked on a folder's page as the folder's own; from 0.12 they're set in its form.
  const pickModels = (ids: string[]) => {
    choice.pick(ids);
    if (newer || !ids.length || sameIds(ids, folderModelIds)) return;
    updateFolder(client, folderId, { data: { model_ids: ids } }).then(
      () => queryClient.invalidateQueries({ queryKey: ['folder', folderId] }),
      () => undefined,
    );
  };

  const start = async ({ text, files, toggles, toolIds, skillIds, filterIds, atModelId }: OutgoingMessage) => {
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
        menu={folder ? folderActions.items({ id: folder.id, name: folder.name }, { newChat: false, onDeleted: () => router.replace('/') }) : undefined}
      />
      <View style={styles.screen}>
        {background ? <FolderBackground uri={background} /> : null}
        <KeyboardAvoidingView behavior="padding" style={styles.screen}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.greeting}>
              <Icon name="folder-open" size={30} color={palette.textMuted} />
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
                {folder?.name ?? ''}
              </Text>
              {description ? (
                <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={4}>
                  {description}
                </Text>
              ) : null}
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
    </View>
  );
}

/** The folder's picture under the page, fading into the page's colour towards the bottom, as on the web. */
function FolderBackground({ uri }: { uri: string }) {
  const palette = usePalette();
  const dark = useColorScheme() === 'dark';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="folder-fade" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={palette.background} stopOpacity={1} />
            <Stop offset="1" stopColor={palette.background} stopOpacity={dark ? 0.9 : 0.85} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#folder-fade)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, paddingTop: 32, paddingBottom: 48, gap: 20 },
  greeting: { paddingHorizontal: 24, gap: 8, alignItems: 'center' },
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
