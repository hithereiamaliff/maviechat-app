import { deleteSession, groupImportedChats, renameSession, sessionTitle, type DtImportedChat } from '@maviechat/deeptutor-protocol';
import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MenuButton } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { showPrompt } from '@/components/dialogs';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useImportedChats, usePersonalizationRefresh } from '@/features/deeptutor/personalization/queries';
import { sessionDate } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));
const lastWords = (chat: DtImportedChat) => (typeof chat.last_message === 'string' ? chat.last_message : '');

/** One group of imported conversations: search them, open one (it carries on as a DeepTutor chat), rename or delete. */
export default function ImportedGroup() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const key = one(useLocalSearchParams<{ key: string }>().key);
  const imported = useImportedChats();
  const refresh = usePersonalizationRefresh();
  const [query, setQuery] = useState('');
  const group = groupImportedChats(imported.data ?? []).find((item) => item.key === key);
  const needle = query.trim().toLowerCase();
  const chats = (group?.chats ?? []).filter((chat) => !needle || chat.title.toLowerCase().includes(needle) || lastWords(chat).toLowerCase().includes(needle));

  const rename = (chat: DtImportedChat) =>
    showPrompt(
      'Rename',
      undefined,
      (value) => {
        const title = (value ?? '').trim();
        if (!title || title === chat.title) return;
        void renameSession(client, chat.id, title).then(refresh, (error: unknown) => toast(`Couldn’t rename it: ${describeError(error)}`, 'error'));
      },
      'plain-text',
      chat.title,
    );
  const remove = (chat: DtImportedChat) =>
    Alert.alert(`Delete “${sessionTitle(chat)}”?`, 'It’s deleted for good; importing the file again brings it back.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteSession(client, chat.id).then(
            () => {
              refresh();
              toast('Deleted');
            },
            (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title={group?.label ?? 'Imported'} />
      <View style={styles.top}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search titles and last messages"
          placeholderTextColor={palette.textFaint}
          clearButtonMode="while-editing"
          accessibilityLabel="Search"
          style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
        />
      </View>
      {imported.isLoading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
      {imported.data && !group ? <Text style={[styles.empty, { color: palette.textMuted }]}>Nothing here any more.</Text> : null}
      <FlashList
        data={chats}
        keyExtractor={(chat) => chat.id}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={group && needle ? <Text style={[styles.empty, { color: palette.textMuted }]}>Nothing matches.</Text> : null}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/learn/[id]', params: { id: item.id } })}
            style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <View style={styles.text}>
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                {sessionTitle(item)}
              </Text>
              {lastWords(item) ? (
                <Text style={[styles.detail, { color: palette.textMuted }]} numberOfLines={1}>
                  {lastWords(item)}
                </Text>
              ) : null}
              <Text style={[styles.meta, { color: palette.textFaint }]}>{[sessionDate(item.updated_at ?? item.created_at), item.message_count ? `${item.message_count} messages` : ''].filter(Boolean).join(' · ')}</Text>
            </View>
            <MenuButton
              label={`Options for ${sessionTitle(item)}`}
              size={18}
              color={palette.textMuted}
              items={[
                { key: 'rename', label: 'Rename', icon: 'pencil', onPress: () => rename(item) },
                { key: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: () => remove(item) },
              ]}
            />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  search: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  loading: { marginTop: 24 },
  list: { paddingHorizontal: 16, paddingBottom: 48 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.medium, fontSize: 15 },
  detail: { fontFamily: fonts.regular, fontSize: 13 },
  meta: { fontFamily: fonts.regular, fontSize: 11 },
});
