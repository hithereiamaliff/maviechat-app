import {
  createKnowledgeFolder,
  deleteKnowledgeFolder,
  deleteWorkspaceKnowledge,
  fileSizeLabel,
  moveKnowledgeFile,
  removeKnowledgeFile,
  renameFile,
  resetWorkspaceKnowledge,
  updateKnowledgeFolder,
  type KnowledgeFile,
  type KnowledgeFolder,
} from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MenuButton, MenuTrigger, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { showPrompt } from '@/components/dialogs';
import { AccessSheet, type AccessTarget } from '@/features/workspace/AccessSheet';
import { AddPagesSheet, AddTextSheet, FolderPath, FolderPicker, KnowledgeFileSheet } from '@/features/workspace/KnowledgeParts';
import { KnowledgeSheet, type KnowledgeSheetTarget } from '@/features/workspace/KnowledgeSheet';
import { useKnowledgeUploads, type KnowledgeUpload } from '@/features/workspace/knowledgeUploads';
import { Chip } from '@/features/workspace/ListControls';
import { useKnowledgeFiles, usePendingKnowledgeFiles, useWorkspaceKnowledge, useWorkspaceRefresh } from '@/features/workspace/queries';
import { describeError } from '@/lib/errors';
import { openServerFile } from '@/lib/openServerFile';
import { useAuthed } from '@/lib/server';
import { useDebounced } from '@/lib/useDebounced';
import { fonts, radius, usePalette } from '@/theme';

type Row = { kind: 'upload'; upload: KnowledgeUpload } | { kind: 'pending'; id: string; name: string } | { kind: 'folder'; folder: KnowledgeFolder } | { kind: 'file'; file: KnowledgeFile };
type Move = { title: string; from: string | null; exclude?: string; run: (to: string | null) => Promise<unknown> };

const when = (ms: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');
const rowKey = (row: Row) => (row.kind === 'upload' ? row.upload.key : row.kind === 'pending' ? `pending-${row.id}` : row.kind === 'folder' ? `folder-${row.folder.id}` : `file-${row.file.id}`);

/**
 * One knowledge collection, as Open WebUI's collection page has it: its folders and files (search,
 * in their text too; order), what's still being read, and for writers: upload files, add web
 * pages or text, folders (make, rename, move, delete), files (rename, move, remove), the text a
 * file was read as, name and description, sharing, emptying and deleting it.
 */
export default function KnowledgeScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useAuthed();
  const refreshAll = useWorkspaceRefresh();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const kb = useWorkspaceKnowledge(id);
  const knowledge = kb.data;
  const writable = Boolean(knowledge?.writeAccess && !knowledge.external);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const [inText, setInText] = useState(false);
  const [byName, setByName] = useState(false);
  const [sheet, setSheet] = useState<KnowledgeSheetTarget | null>(null);
  const [sharing, setSharing] = useState<AccessTarget | null>(null);
  const [viewing, setViewing] = useState<KnowledgeFile | null>(null);
  const [moving, setMoving] = useState<Move | null>(null);
  const [adding, setAdding] = useState<'pages' | 'text' | null>(null);
  const files = useKnowledgeFiles(id, { folderId, query: debounced, inText, orderBy: byName ? 'name' : 'updated_at', direction: byName ? 'asc' : 'desc' });
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: ['workspace', 'knowledge-files', id] });
    void queryClient.invalidateQueries({ queryKey: ['workspace', 'knowledge-pending', id] });
  };
  const uploads = useKnowledgeUploads(id, reload);
  const pending = usePendingKnowledgeFiles(id, uploads.reading);

  // Files the server finishes reading (from here or elsewhere) leave its pending list: show them.
  const pendingKey = pending.data ? pending.data.map((item) => item.id).join() : null;
  const lastPending = useRef<string | null>(null);
  useEffect(() => {
    if (pendingKey === null) return;
    if (lastPending.current !== null && lastPending.current !== pendingKey) {
      void queryClient.invalidateQueries({ queryKey: ['workspace', 'knowledge-files', id] });
    }
    lastPending.current = pendingKey;
  }, [pendingKey, queryClient, id]);

  const first = files.data?.pages[0];
  const path = first?.path ?? [];
  const fileList = files.data?.pages.flatMap((page) => page.files) ?? [];
  const ours = new Set(uploads.uploads.map((item) => item.fileId).filter(Boolean));
  const rows: Row[] = [
    ...uploads.uploads.filter((item) => item.folderId === folderId).map((upload): Row => ({ kind: 'upload', upload })),
    ...(pending.data ?? []).filter((item) => item.folderId === folderId && !ours.has(item.id) && !fileList.some((file) => file.id === item.id)).map((item): Row => ({ kind: 'pending', id: item.id, name: item.name })),
    ...(first?.folders ?? []).map((folder): Row => ({ kind: 'folder', folder })),
    ...fileList.map((file): Row => ({ kind: 'file', file })),
  ];
  const fail = (what: string) => (error: unknown) => toast(`Couldn’t ${what}: ${describeError(error)}`, 'error');
  const openFolder = (next: string | null) => {
    setFolderId(next);
    setQuery('');
  };

  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    void uploads.send(result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/octet-stream', size: asset.size ?? null, folderId })));
  };
  const newFolder = () =>
    showPrompt(
      'New Folder',
      path.length ? `In ${path[path.length - 1]?.name ?? 'this folder'}` : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Make', onPress: (name?: string) => (name?.trim() ? void createKnowledgeFolder(client, id, name, folderId).then(reload, fail('make the folder')) : undefined) },
      ],
      'plain-text',
    );
  const emptyIt = () =>
    knowledge &&
    Alert.alert(`Empty ${knowledge.name}?`, 'Every file and folder in it goes, with its search data. Files you added are deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Empty It',
        style: 'destructive',
        onPress: () =>
          void resetWorkspaceKnowledge(client, id).then(() => {
            openFolder(null);
            reload();
            refreshAll();
            toast('Emptied');
          }, fail('empty it')),
      },
    ]);
  const deleteIt = () =>
    knowledge &&
    Alert.alert(`Delete ${knowledge.name}?`, 'Models that use it lose it, and its search data goes. Files you added stay in your files.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteWorkspaceKnowledge(client, id).then(() => {
            refreshAll();
            toast(`${knowledge.name} deleted`);
            if (router.canGoBack()) router.back();
            else router.replace('/workspace');
          }, fail('delete it')),
      },
    ]);

  const menu: MenuItem[] = knowledge
    ? [
        ...(knowledge.writeAccess
          ? [
              { key: 'edit', label: 'Name and Description', icon: 'pencil-square' as const, onPress: () => setSheet({ kind: 'edit', knowledge }) },
              { key: 'share', label: 'Share…', icon: 'users' as const, onPress: () => setSharing({ area: 'knowledge', id, name: knowledge.name, grants: knowledge.accessGrants }) },
            ]
          : []),
        { key: 'copy', label: 'Copy Id', icon: 'clipboard-document', onPress: () => void Clipboard.setStringAsync(id).then(() => toast('Id copied')) },
        { key: 'web', label: 'Open on the Web', icon: 'globe-alt', onPress: () => void WebBrowser.openBrowserAsync(`${session.baseUrl}/workspace/knowledge/${encodeURIComponent(id)}`) },
        ...(writable ? [{ key: 'reset', label: 'Empty It…', icon: 'arrow-path' as const, destructive: true, onPress: emptyIt }] : []),
        ...(knowledge.writeAccess ? [{ key: 'delete', label: 'Delete…', icon: 'trash' as const, destructive: true, onPress: deleteIt }] : []),
      ]
    : [];
  const addMenu: MenuItem[] = [
    { key: 'files', label: 'Upload Files', icon: 'arrow-up-tray', onPress: () => void pickFiles() },
    { key: 'pages', label: 'Add Web Pages', icon: 'globe-alt', onPress: () => setAdding('pages') },
    { key: 'text', label: 'Add Text', icon: 'document-text', onPress: () => setAdding('text') },
    { key: 'folder', label: 'New Folder', icon: 'folder', onPress: newFolder },
  ];
  const folderMenu = (folder: KnowledgeFolder): MenuItem[] => [
    { key: 'open', label: 'Open', icon: 'folder-open', onPress: () => openFolder(folder.id) },
    ...(writable
      ? [
          {
            key: 'rename',
            label: 'Rename',
            icon: 'pencil' as const,
            onPress: () =>
              showPrompt(
                'Rename Folder',
                undefined,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Save', onPress: (name?: string) => (name?.trim() && name.trim() !== folder.name ? void updateKnowledgeFolder(client, id, folder.id, { name }).then(reload, fail('rename it')) : undefined) },
                ],
                'plain-text',
                folder.name,
              ),
          },
          { key: 'move', label: 'Move To…', icon: 'arrows-right-left' as const, onPress: () => setMoving({ title: `Move ${folder.name}`, from: folderId, exclude: folder.id, run: (to) => updateKnowledgeFolder(client, id, folder.id, { parentId: to }) }) },
          {
            key: 'delete',
            label: 'Delete…',
            icon: 'trash' as const,
            destructive: true,
            onPress: () =>
              Alert.alert(`Delete ${folder.name}?`, 'What’s in it can move up a level, or go with it (files you added are deleted).', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete, Keep What’s In It', onPress: () => void deleteKnowledgeFolder(client, id, folder.id, { moveFiles: true }).then(reload, fail('delete it')) },
                { text: 'Delete With Everything In It', style: 'destructive', onPress: () => void deleteKnowledgeFolder(client, id, folder.id, { moveFiles: false }).then(reload, fail('delete it')) },
              ]),
          },
        ]
      : []),
  ];
  const fileMenu = (file: KnowledgeFile): MenuItem[] => [
    { key: 'text', label: 'Text as Read', icon: 'document-text', onPress: () => setViewing(file) },
    { key: 'open', label: 'Open the Original', icon: 'arrow-top-right-on-square', onPress: () => void openServerFile(session, file.id, file.name).catch(fail('open it')) },
    ...(writable
      ? [
          {
            key: 'rename',
            label: 'Rename',
            icon: 'pencil' as const,
            onPress: () =>
              showPrompt(
                'Rename File',
                undefined,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Save', onPress: (name?: string) => (name?.trim() && name.trim() !== file.name ? void renameFile(client, file.id, name).then(reload, fail('rename it')) : undefined) },
                ],
                'plain-text',
                file.name,
              ),
          },
          { key: 'move', label: 'Move To…', icon: 'arrows-right-left' as const, onPress: () => setMoving({ title: `Move ${file.name}`, from: folderId, run: (to) => moveKnowledgeFile(client, id, file.id, to) }) },
          {
            key: 'remove',
            label: 'Remove…',
            icon: 'trash' as const,
            destructive: true,
            onPress: () =>
              Alert.alert(`Remove ${file.name}?`, 'It leaves this collection, with its search data. If you added it, the file itself is deleted too.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => void removeKnowledgeFile(client, id, file.id).then(reload, fail('remove it')) },
              ]),
          },
        ]
      : []),
  ];

  const header = (
    <View style={styles.top}>
      {knowledge?.description ? <Text style={[styles.description, { color: palette.textMuted }]}>{knowledge.description}</Text> : null}
      {knowledge?.external ? <Text style={[styles.note, { color: palette.textMuted }]}>{`Connected${knowledge.provider ? ` to ${knowledge.provider}` : ''} by an admin: its documents live there, and are searched there.`}</Text> : null}
      {knowledge && !knowledge.writeAccess ? <Text style={[styles.note, { color: palette.textMuted }]}>Shared with you to use: only its owner (or someone they let) can change it.</Text> : null}
      {path.length ? <FolderPath path={path} onOpen={openFolder} /> : null}
      <View style={styles.row}>
        <TextInput value={query} onChangeText={setQuery} placeholder={path.length ? 'Search this folder' : 'Search files'} placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search files" style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        {writable ? (
          <MenuTrigger items={addMenu} label="Add">
            <View style={[styles.add, { backgroundColor: palette.primary }]}>
              <Icon name="plus" size={16} color={palette.onPrimary} />
              <Text style={[styles.addText, { color: palette.onPrimary }]}>Add</Text>
            </View>
          </MenuTrigger>
        ) : null}
      </View>
      <View style={styles.chips}>
        <Chip label="In their text too" on={inText} onPress={() => setInText(!inText)} />
        <Chip label={byName ? 'By name' : 'Latest'} on={false} onPress={() => setByName(!byName)} />
        {first ? <Text style={[styles.meta, { color: palette.textFaint }]}>{`${first.total} ${first.total === 1 ? 'file' : 'files'}${path.length ? ' in here' : ''}`}</Text> : null}
      </View>
      {files.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {files.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load the files: ${describeError(files.error)}`}</Text> : null}
      {files.data && !rows.length ? <Text style={[styles.note, styles.center, { color: palette.textMuted }]}>{debounced ? 'Nothing matches.' : writable ? 'Nothing here yet: add files, web pages or text.' : 'Nothing here yet.'}</Text> : null}
    </View>
  );

  const renderRow = (row: Row) => {
    if (row.kind === 'upload' || row.kind === 'pending') {
      const failed = row.kind === 'upload' && row.upload.state === 'failed';
      const name = row.kind === 'upload' ? row.upload.name : row.name;
      const note = row.kind === 'upload' ? (failed ? `Couldn’t add it: ${row.upload.error}` : row.upload.state === 'sending' ? 'Sending…' : 'The server is reading it…') : 'The server is reading it…';
      return (
        <View style={[styles.item, { borderColor: failed ? palette.danger : palette.border }]}>
          {failed ? <Icon name="exclamation-triangle" size={18} color={palette.danger} /> : <ActivityIndicator color={palette.textMuted} />}
          <View style={styles.text}>
            <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
              {name}
            </Text>
            <Text style={[styles.meta, { color: failed ? palette.danger : palette.textMuted }]} numberOfLines={3}>
              {note}
            </Text>
          </View>
          {failed && row.kind === 'upload' ? <IconButton icon="x-mark" label={`Dismiss ${name}`} size={16} onPress={() => uploads.dismiss(row.upload.key)} /> : null}
        </View>
      );
    }
    if (row.kind === 'folder') {
      return (
        <Pressable accessibilityRole="button" accessibilityHint="Opens the folder" onPress={() => openFolder(row.folder.id)} style={({ pressed }) => [styles.item, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
          <Icon name="folder" size={20} color={palette.textMuted} />
          <Text style={[styles.name, styles.text, { color: palette.text }]} numberOfLines={1}>
            {row.folder.name}
          </Text>
          <MenuButton label={`Options for ${row.folder.name}`} size={18} color={palette.textMuted} items={folderMenu(row.folder)} />
        </Pressable>
      );
    }
    const file = row.file;
    return (
      <Pressable accessibilityRole="button" accessibilityHint="Shows the text it was read as" onPress={() => setViewing(file)} style={({ pressed }) => [styles.item, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
        <Icon name="document-text" size={20} color={palette.textMuted} />
        <View style={styles.text}>
          <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
            {file.name}
          </Text>
          <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
            {[file.size !== null ? fileSizeLabel(file.size) : '', when(file.updatedAt), file.ownerName].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <MenuButton label={`Options for ${file.name}`} size={18} color={palette.textMuted} items={fileMenu(file)} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/workspace'))} />
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={1} accessibilityRole="header">
          {knowledge?.name ?? 'Knowledge'}
        </Text>
        {menu.length ? <MenuButton label="Collection options" items={menu} /> : null}
      </View>
      {kb.isError ? (
        <Text style={[styles.note, styles.pad, { color: palette.danger }]}>{`Couldn’t open it: ${describeError(kb.error)}`}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={rowKey}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (files.hasNextPage && !files.isFetchingNextPage) void files.fetchNextPage();
          }}
          refreshing={false}
          onRefresh={() => {
            reload();
            void kb.refetch();
          }}
          ListFooterComponent={files.isFetchingNextPage ? <ActivityIndicator color={palette.textMuted} /> : undefined}
          renderItem={({ item }) => renderRow(item)}
        />
      )}
      <KnowledgeSheet target={sheet} onClose={() => setSheet(null)} onSaved={() => void kb.refetch()} />
      <AccessSheet target={sharing} onClose={() => setSharing(null)} onSaved={() => void kb.refetch()} />
      <KnowledgeFileSheet file={viewing} writable={writable} onClose={() => setViewing(null)} />
      <FolderPicker
        kbId={id}
        target={moving}
        onClose={() => setMoving(null)}
        onPick={(to) => {
          const job = moving;
          setMoving(null);
          if (job) void job.run(to).then(reload, fail('move it'));
        }}
      />
      <AddPagesSheet kbId={id} folderId={folderId} visible={adding === 'pages'} onClose={() => setAdding(null)} send={uploads.send} onAdded={reload} />
      <AddTextSheet folderId={folderId} visible={adding === 'text'} onClose={() => setAdding(null)} send={uploads.send} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
  title: { flex: 1, fontFamily: fonts.medium, fontSize: 16, marginHorizontal: 4 },
  pad: { padding: 16 },
  list: { padding: 16, gap: 8, paddingBottom: 48 },
  top: { gap: 10, paddingBottom: 6 },
  description: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  search: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 38, paddingHorizontal: 14, borderRadius: radius.md },
  addText: { fontFamily: fonts.semibold, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
});
