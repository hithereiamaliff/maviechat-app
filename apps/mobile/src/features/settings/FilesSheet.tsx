import { deleteFile, fileContentUrl, fileSizeLabel, FILES_PAGE_SIZE, searchFiles, type StoredFile } from '@maviechat/owui-protocol';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities } from '@/lib/server';
import { useDebounced } from '@/lib/useDebounced';
import { fonts, radius, usePalette } from '@/theme';

const SORTS = ['Newest', 'Name'] as const;

const day = (seconds: number) => (seconds ? new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
/** A name any file system takes, keeping the extension (Quick Look reads the type from it). */
const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(-120) || 'file';

/** Your files on the server in a sheet, as the web's Manage Files: search, sort, open one, or delete it. */
export function FilesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Files onClose={onClose} /> : null}
    </Modal>
  );
}

function Files({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useAuthed();
  const capabilities = useCapabilities();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<(typeof SORTS)[number]>('Newest');
  const [opening, setOpening] = useState<string | null>(null);
  const query = useDebounced(search.trim(), 300);
  const list = useInfiniteQuery({
    queryKey: ['files', query],
    queryFn: ({ pageParam }) => searchFiles(client, query, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length >= FILES_PAGE_SIZE ? all.length * FILES_PAGE_SIZE : undefined),
  });
  const files = useMemo(() => {
    const loaded = list.data?.pages.flat() ?? [];
    return [...loaded].sort((a, b) => (sort === 'Name' ? a.filename.localeCompare(b.filename) : b.created_at - a.created_at));
  }, [list.data, sort]);

  // Downloaded with your token into the app's cache, then shown by iOS (Quick Look), or offered to other apps.
  const open = async (item: StoredFile) => {
    setOpening(item.id);
    try {
      const file = new File(Paths.cache, `${item.id.slice(0, 8)}-${safeName(item.filename)}`);
      await File.downloadFileAsync(fileContentUrl(session.baseUrl, item.id), file, { headers: { Authorization: `Bearer ${session.token}` }, idempotent: true });
      if (await File.canPreview(file).catch(() => false)) await File.preview(file);
      else await Share.share({ url: file.uri, title: item.filename });
    } catch (error) {
      toast(`Couldn’t open the file: ${describeError(error)}`, 'error');
    } finally {
      setOpening(null);
    }
  };
  const remove = (item: StoredFile) =>
    Alert.alert(`Delete “${item.filename}”?`, 'It’s deleted from the server: chats and knowledge that used it lose it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteFile(client, item.id).then(
            () => {
              void queryClient.invalidateQueries({ queryKey: ['files'] });
              void queryClient.invalidateQueries({ queryKey: ['files-count'] });
              toast('File deleted');
            },
            (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text style={[styles.heading, { color: palette.text }]} accessibilityRole="header">
          Files
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.done, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      <View style={styles.bar}>
        <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name"
            placeholderTextColor={palette.textFaint}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            accessibilityLabel="Search files"
            style={[styles.searchInput, { color: palette.text }]}
          />
        </View>
        <View style={[styles.segments, { backgroundColor: palette.surfaceStrong }]} accessibilityRole="radiogroup">
          {SORTS.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected: option === sort }}
              accessibilityLabel={`Sort by ${option}`}
              onPress={() => setSort(option)}
              style={[styles.segment, option === sort && { backgroundColor: palette.background }]}>
              <Text style={[styles.segmentText, { color: option === sort ? palette.text : palette.textMuted }]}>{option}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {capabilities?.isAdmin ? <Text style={[styles.note, { color: palette.textFaint }]}>As an admin you see everyone’s files.</Text> : null}
      <FlashList
        data={files}
        keyExtractor={(file) => file.id}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListEmptyComponent={
          list.isLoading ? (
            <ActivityIndicator style={styles.loading} color={palette.textMuted} />
          ) : (
            <Text style={[styles.empty, { color: palette.textMuted }]}>{list.isError ? `Couldn’t load your files: ${describeError(list.error)}` : query ? 'No files match.' : 'You have no files.'}</Text>
          )
        }
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the file"
            disabled={opening !== null}
            onPress={() => void open(item)}
            style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <Icon name="document-text" size={18} color={palette.textMuted} />
            <View style={styles.rowText}>
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                {item.filename}
              </Text>
              <Text style={[styles.date, { color: palette.textFaint }]}>{[fileSizeLabel(item.size), day(item.created_at)].filter(Boolean).join(' · ')}</Text>
            </View>
            {opening === item.id ? <ActivityIndicator size="small" color={palette.textMuted} /> : null}
            <IconButton icon="trash" label={`Delete ${item.filename}`} size={18} color={palette.textMuted} onPress={() => remove(item)} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  heading: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  segments: { flexDirection: 'row', padding: 2, borderRadius: radius.md },
  segment: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md - 2 },
  segmentText: { fontFamily: fonts.medium, fontSize: 13 },
  note: { fontFamily: fonts.regular, fontSize: 12, marginHorizontal: 20, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.medium, fontSize: 15 },
  date: { fontFamily: fonts.regular, fontSize: 12 },
  loading: { marginVertical: 20 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
});
