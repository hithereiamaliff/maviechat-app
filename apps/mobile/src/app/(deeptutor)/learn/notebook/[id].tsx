import { deleteNotebook, deleteRecord, exportNotebook, updateNotebook, updateRecord, type DtRecord } from '@maviechat/deeptutor-protocol';
import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from '@/components/IconButton';
import { MenuButton } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { capabilityName } from '@/features/deeptutor/chat/capabilities';
import { startChatWith } from '@/features/deeptutor/chat/extras';
import { sessionDate, useDtNotebook } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { Markdown } from '@/markdown/Markdown';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

/** Our names for what a record came from. */
const RECORD_TYPES: Record<string, string> = {
  solve: 'Solve',
  question: 'Quiz',
  research: 'Research',
  chat: 'Chat',
  co_writer: 'Co-Writer',
  tutorbot: 'Tutor',
  reading: 'Reading',
  video_learning: 'Video',
};

/** One notebook in Favorites: what's saved in it, each item readable in full, and ways to use it. */
export default function NotebookScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const notebook = useDtNotebook(id);
  const [open, setOpen] = useState<DtRecord | null>(null);
  const records = notebook.data?.records ?? [];
  const name = notebook.data?.name ?? 'Notebook';
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'notebooks'] });
  const fail = (what: string) => (error: unknown) => toast(`Couldn't ${what}: ${describeError(error)}`, 'error');

  const renameNotebook = () =>
    Alert.prompt(
      'Rename Notebook',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: (value?: string) => {
            const next = value?.trim();
            if (next && next !== name) void updateNotebook(client, id, { name: next }).then(refresh).catch(fail('rename it'));
          },
        },
      ],
      'plain-text',
      name,
    );
  const share = () =>
    void exportNotebook(client, id)
      .then((markdown) => Share.share({ title: name, message: markdown }))
      .catch(fail('export it'));
  const removeNotebook = () =>
    Alert.alert(`Delete “${name}”?`, 'Everything saved in it goes too. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteNotebook(client, id)
            .then(() => {
              refresh();
              router.back();
            })
            .catch(fail('delete it')),
      },
    ]);

  const renameRecord = (record: DtRecord) =>
    Alert.prompt(
      'Rename',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: (value?: string) => {
            const title = value?.trim();
            if (!title || title === record.title) return;
            void updateRecord(client, id, record.id, { title })
              .then(() => {
                setOpen((current) => (current?.id === record.id ? { ...current, title } : current));
                refresh();
              })
              .catch(fail('rename it'));
          },
        },
      ],
      'plain-text',
      record.title,
    );
  const removeRecord = (record: DtRecord) =>
    Alert.alert('Remove this item?', 'It leaves this notebook.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void deleteRecord(client, id, record.id)
            .then(() => {
              setOpen(null);
              refresh();
            })
            .catch(fail('remove it')),
      },
    ]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/learn/favorites'))} />
        <Text style={[styles.headerTitle, { color: palette.text }]} numberOfLines={1} accessibilityRole="header">
          {name}
        </Text>
        <MenuButton
          label="Notebook options"
          items={[
            {
              key: 'chat',
              label: 'Chat About It',
              icon: 'chat-bubble-left',
              onPress: () => {
                startChatWith({ notebook: { id, name } });
                router.dismissAll();
                router.replace('/learn');
              },
            },
            { key: 'share', label: 'Share as Markdown', icon: 'arrow-top-right-on-square', onPress: share },
            { key: 'rename', label: 'Rename', icon: 'pencil', onPress: renameNotebook },
            { key: 'delete', label: 'Delete Notebook', icon: 'trash', destructive: true, onPress: removeNotebook },
          ]}
        />
      </View>
      <FlashList
        data={records}
        keyExtractor={(item) => item.id}
        refreshing={false}
        onRefresh={refresh}
        ListHeaderComponent={
          notebook.data?.description ? <Text style={[styles.intro, { color: palette.textMuted }]}>{notebook.data.description}</Text> : null
        }
        ListEmptyComponent={
          notebook.isLoading ? (
            <ActivityIndicator style={styles.loading} color={palette.textMuted} />
          ) : (
            <Text style={[styles.empty, { color: palette.textMuted }]}>
              {notebook.isError ? `Couldn't load it: ${describeError(notebook.error)}` : 'Nothing saved here yet. Save answers to it from DeepTutor, or send Open WebUI chats here.'}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Shows it in full"
            onPress={() => setOpen(item)}
            style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
              {item.title || 'Untitled'}
            </Text>
            {item.summary ? (
              <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={2}>
                {item.summary}
              </Text>
            ) : null}
            <Text style={[styles.meta, { color: palette.textFaint }]}>
              {[RECORD_TYPES[item.type] ?? capabilityName(item.type), sessionDate(item.created_at)].filter(Boolean).join(' · ')}
            </Text>
          </Pressable>
        )}
      />
      <Modal visible={open !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(null)}>
        {open ? (
          <View style={[styles.screen, { backgroundColor: palette.background }]}>
            <View style={styles.sheetHeader}>
              <Pressable accessibilityRole="button" onPress={() => setOpen(null)} hitSlop={8}>
                <Text style={[styles.done, { color: palette.link }]}>Done</Text>
              </Pressable>
              <MenuButton
                label="Item options"
                items={[
                  {
                    key: 'copy',
                    label: 'Copy',
                    icon: 'clipboard-document',
                    onPress: () => void Clipboard.setStringAsync(open.output || open.summary).then(() => toast('Copied to clipboard')),
                  },
                  { key: 'rename', label: 'Rename', icon: 'pencil', onPress: () => renameRecord(open) },
                  { key: 'remove', label: 'Remove', icon: 'trash', destructive: true, onPress: () => removeRecord(open) },
                ]}
              />
            </View>
            <ScrollView contentContainerStyle={styles.sheetContent}>
              <Text style={[styles.sheetTitle, { color: palette.text }]} accessibilityRole="header">
                {open.title || 'Untitled'}
              </Text>
              <Text style={[styles.meta, { color: palette.textFaint }]}>
                {[RECORD_TYPES[open.type] ?? capabilityName(open.type), sessionDate(open.created_at)].filter(Boolean).join(' · ')}
              </Text>
              {open.user_query ? (
                <>
                  <Text style={[styles.section, { color: palette.textMuted }]}>Question</Text>
                  <Markdown text={open.user_query} baseUrl={session.baseUrl} />
                </>
              ) : null}
              {open.output ? (
                <>
                  <Text style={[styles.section, { color: palette.textMuted }]}>Answer</Text>
                  <Markdown text={open.output} baseUrl={session.baseUrl} />
                </>
              ) : open.summary ? (
                <Markdown text={open.summary} baseUrl={session.baseUrl} />
              ) : null}
            </ScrollView>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
  headerTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 16, marginHorizontal: 4 },
  intro: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingVertical: 8 },
  loading: { marginVertical: 24 },
  empty: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 32, paddingHorizontal: 32 },
  row: { paddingHorizontal: 16, paddingVertical: 12, gap: 3, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  description: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 8, paddingTop: 12, paddingBottom: 4 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  sheetContent: { paddingHorizontal: 20, paddingBottom: 48, gap: 8 },
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  section: { fontFamily: fonts.medium, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 12 },
});
