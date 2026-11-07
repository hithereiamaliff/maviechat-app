import { createNotebook, deleteNotebook, updateNotebook, type DtNotebook } from '@maviechat/deeptutor-protocol';
import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MenuButton } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { showPrompt } from '@/components/dialogs';
import { startChatWith } from '@/features/deeptutor/chat/extras';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { sessionDate, useDtNotebooks } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

/**
 * Favorites, DeepTutor's notebooks: the answers, chats and clips you saved, kept in notebooks
 * you can refer to in any chat.
 */
export default function Favorites() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const notebooks = useDtNotebooks();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'notebooks'] });

  const create = () =>
    showPrompt('New Notebook', 'A name for it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Create',
        onPress: (value?: string) => {
          const name = value?.trim();
          if (!name) return;
          void createNotebook(client, name)
            .then((notebook) => {
              refresh();
              router.push({ pathname: '/learn/notebook/[id]', params: { id: notebook.id } });
            })
            .catch((error: unknown) => toast(`Couldn't create it: ${describeError(error)}`, 'error'));
        },
      },
    ]);

  const rename = (notebook: DtNotebook) =>
    showPrompt(
      'Rename Notebook',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: (value?: string) => {
            const name = value?.trim();
            if (!name || name === notebook.name) return;
            void updateNotebook(client, notebook.id, { name })
              .then(refresh)
              .catch((error: unknown) => toast(`Couldn't rename it: ${describeError(error)}`, 'error'));
          },
        },
      ],
      'plain-text',
      notebook.name,
    );

  const remove = (notebook: DtNotebook) =>
    Alert.alert(`Delete “${notebook.name}”?`, 'Everything saved in it goes too. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteNotebook(client, notebook.id)
            .then(refresh)
            .catch((error: unknown) => toast(`Couldn't delete it: ${describeError(error)}`, 'error')),
      },
    ]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Favorites" accessory={<IconButton icon="plus" label="New notebook" onPress={create} />} />
      <FlashList
        data={notebooks.data ?? []}
        keyExtractor={(item) => item.id}
        refreshing={false}
        onRefresh={refresh}
        ListHeaderComponent={
          <Text style={[styles.intro, { color: palette.textMuted }]}>
            Notebooks of answers and chats you saved. Refer to one in any chat from the + menu, or tap Chat About It.
          </Text>
        }
        ListEmptyComponent={
          notebooks.isLoading ? (
            <ActivityIndicator style={styles.loading} color={palette.textMuted} />
          ) : (
            <Text style={[styles.empty, { color: palette.textMuted }]}>
              {notebooks.isError ? `Couldn't load your notebooks: ${describeError(notebooks.error)}` : 'No notebooks yet. Tap + to make one.'}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the notebook"
            disabled={item.unreadable}
            onPress={() => router.push({ pathname: '/learn/notebook/[id]', params: { id: item.id } })}
            style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <Icon name="book-open" size={20} color={palette.textMuted} />
            <View style={styles.rowText}>
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                {item.unreadable ? 'Notebook DeepTutor cannot read' : item.name}
              </Text>
              {item.description ? (
                <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
              <Text style={[styles.meta, { color: palette.textFaint }]}>
                {[
                  typeof item.record_count === 'number' ? (item.record_count === 1 ? '1 item' : `${item.record_count} items`) : null,
                  sessionDate(item.updated_at ?? item.created_at),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            {item.unreadable ? null : (
              <MenuButton
                label={`Options for ${item.name}`}
                size={18}
                color={palette.textMuted}
                items={[
                  { key: 'chat', label: 'Chat About It', icon: 'chat-bubble-left', onPress: () => { startChatWith({ notebook: { id: item.id, name: item.name } }); router.replace('/learn'); } },
                  { key: 'rename', label: 'Rename', icon: 'pencil', onPress: () => rename(item) },
                  { key: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: () => remove(item) },
                ]}
              />
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  intro: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingVertical: 8 },
  loading: { marginVertical: 24 },
  empty: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 32, paddingHorizontal: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 8, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.medium, fontSize: 15 },
  description: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
});
