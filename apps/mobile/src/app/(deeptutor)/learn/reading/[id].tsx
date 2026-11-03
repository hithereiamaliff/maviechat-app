import {
  addToCollection,
  deleteCollection,
  deleteMaterial,
  importLinks,
  isPreparing,
  linksIn,
  removeFromCollection,
  retryMaterial,
  setActiveMaterial,
  updateCollection,
  uploadMaterial,
  clock,
  type DtMaterial,
} from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { sessionDate, useDtCollection, useDtCollectionChats, useDtLibrary, useDtSupportedFormats } from '@/features/deeptutor/queries';
import { CollectionSheet } from '@/features/deeptutor/reading/CollectionSheet';
import { failureText, materialIcon } from '@/features/deeptutor/reading/labels';
import { describeError } from '@/lib/errors';
import { PHONE_UPLOAD_MAX_BYTES, uploadPart } from '@/lib/uploadPart';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

const KIND_LABELS: Record<string, string> = { web: 'Web page', youtube: 'YouTube', bilibili: 'Bilibili', video: 'Video', audio: 'Audio' };

/** What a file is, in a few words: its kind or format, and a video's length. */
function describe(material: DtMaterial): string {
  const extension = /\.([a-z0-9]{1,5})$/i.exec(material.filename)?.[1]?.toUpperCase();
  const kind = KIND_LABELS[material.kind] ?? (material.renderMode === 'epub' ? 'E-book' : extension ?? 'Document');
  return [kind, material.duration ? clock(material.duration) : ''].filter(Boolean).join(' · ');
}

/**
 * A reading collection: its files (being prepared, ready or failed), adding more (files, links,
 * or what's already in your library), and the chats with the tutor about them.
 */
export default function ReadingCollection() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const detail = useDtCollection(id);
  const chats = useDtCollectionChats(id);
  const formats = useDtSupportedFormats();
  const [uploading, setUploading] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const library = useDtLibrary(picking);
  const collection = detail.data?.collection;
  const materials = collection?.materials ?? [];
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading'] });
  const fail = (what: string) => (error: unknown) => toast(`Couldn't ${what}: ${describeError(error)}`, 'error');

  const open = (material: DtMaterial) => {
    if (material.status !== 'ready') return fileMenu(material);
    void setActiveMaterial(client, id, material.id).catch(() => undefined);
    router.push({ pathname: '/learn/reading/read', params: { collection: id, material: material.id } });
  };

  // Documents are read before DeepTutor answers; videos and audio are transcribed after.
  const upload = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    for (const asset of result.assets) {
      const extension = asset.name.split('.').pop()?.toLowerCase() ?? '';
      if (formats.data && !formats.data.extensions.includes(extension)) {
        toast(`${asset.name}: DeepTutor can't read .${extension} files.`, 'error');
        continue;
      }
      const limit = Math.min(formats.data?.maxBytes || PHONE_UPLOAD_MAX_BYTES, PHONE_UPLOAD_MAX_BYTES);
      if (asset.size && asset.size > limit) {
        toast(`${asset.name} is over ${Math.round(limit / 1048576)} MB, too big to send from the phone. Add it from DeepTutor’s web app.`, 'error');
        continue;
      }
      setUploading((list) => [...list, asset.name]);
      try {
        const material = await uploadMaterial(client, uploadPart({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/octet-stream' }), asset.name);
        await addToCollection(client, id, material.id, true);
      } catch (error) {
        fail(`add ${asset.name}`)(error);
      } finally {
        setUploading((list) => list.filter((name) => name !== asset.name));
        refresh();
      }
    }
  };

  const addLinks = () =>
    Alert.prompt(
      'Add Links',
      'Web pages and YouTube or Bilibili videos. Paste one or more.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: (value?: string) => {
            const urls = linksIn(value ?? '');
            if (!urls.length) return toast('No web addresses found (they start with https://).', 'error');
            importLinks(client, urls, { collectionId: id }).then(refresh, fail('add the links'));
          },
        },
      ],
      'plain-text',
    );

  const add = () =>
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Add to the collection', options: ['Upload Files', 'Add Links', 'From Your Library', 'Cancel'], cancelButtonIndex: 3 }, (index) => {
      if (index === 0) void upload();
      if (index === 1) addLinks();
      if (index === 2) setPicking(true);
    });

  const fileMenu = (material: DtMaterial) => {
    const stuck = material.status === 'failed' || isPreparing(material);
    const options = [...(stuck && material.kind !== 'file' ? ['Try Again'] : []), 'Remove From Collection', 'Delete From Library', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: material.title, message: material.status === 'failed' ? failureText(material) : undefined, options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: options.length - 2 },
      (index) => {
        const choice = options[index];
        if (choice === 'Try Again') retryMaterial(client, material.id).then(refresh, fail('try again'));
        if (choice === 'Remove From Collection') removeFromCollection(client, id, material.id).then(refresh, fail('remove it'));
        if (choice === 'Delete From Library')
          Alert.alert('Delete from your library?', `"${material.title}" leaves every collection, with its highlights and notes.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => void deleteMaterial(client, material.id).then(refresh, fail('delete it')) },
          ]);
      },
    );
  };

  const remove = () =>
    Alert.alert('Delete this collection?', 'Its chats are deleted too. The files stay in your library.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteCollection(client, id).then(() => {
            refresh();
            router.back();
          }, fail('delete the collection')),
      },
    ]);

  const menu: MenuItem[] = [
    { key: 'edit', label: 'Rename and Colour', icon: 'pencil', onPress: () => setEditing(true) },
    {
      key: 'web',
      label: 'Open in DeepTutor Web App',
      icon: 'arrow-top-right-on-square',
      onPress: () => router.push({ pathname: '/learn/web', params: { path: `/learning/reading/folders/${encodeURIComponent(id)}`, title: collection?.title ?? 'Reading' } }),
    },
    { key: 'delete', label: 'Delete Collection', icon: 'trash', destructive: true, onPress: remove },
  ];

  const inCollection = new Set(materials.map((material) => material.id));
  const choices = (library.data ?? []).filter((material) => !inCollection.has(material.id));

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title={collection?.title ?? 'Collection'} menu={menu} />
      {detail.isLoading ? (
        <ActivityIndicator style={styles.loading} color={palette.textMuted} />
      ) : detail.isError || !collection ? (
        <Pressable accessibilityRole="button" onPress={refresh} style={styles.content}>
          <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't open the collection: ${describeError(detail.error)}. Tap to try again.`}</Text>
        </Pressable>
      ) : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
          <View style={styles.actions}>
            <View style={styles.grow}>
              <Button label="Add" variant="secondary" onPress={add} />
            </View>
            {materials.some((material) => material.status === 'ready') ? (
              <View style={styles.grow}>
                <Button label="Ask the Tutor" onPress={() => router.push({ pathname: '/learn/reading/chat', params: { collection: id } })} />
              </View>
            ) : null}
          </View>

          <Text style={[styles.heading, { color: palette.textMuted }]}>Files</Text>
          {materials.length === 0 && uploading.length === 0 ? (
            <Text style={[styles.note, { color: palette.textMuted }]}>Nothing here yet. Add PDFs, e-books, documents, web pages or videos.</Text>
          ) : null}
          {materials.map((material) => (
            <Pressable
              key={material.id}
              accessibilityRole="button"
              onPress={() => open(material)}
              style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <Icon name={materialIcon(material)} size={20} color={palette.textMuted} />
              <View style={styles.grow}>
                <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={2}>
                  {material.title}
                </Text>
                <Text style={[styles.rowDetail, { color: material.status === 'failed' ? palette.danger : palette.textMuted }]} numberOfLines={2}>
                  {material.status === 'failed' ? failureText(material) : isPreparing(material) ? `Preparing… ${material.progress}%` : describe(material)}
                </Text>
                {isPreparing(material) ? (
                  <View style={[styles.track, { backgroundColor: palette.surfaceStrong }]}>
                    <View style={[styles.fill, { width: `${Math.max(4, material.progress)}%`, backgroundColor: palette.textMuted }]} />
                  </View>
                ) : null}
              </View>
              {material.id === collection.activeMaterialId ? <Text style={[styles.badge, { color: palette.textFaint }]}>Open</Text> : null}
              <MenuButton
                label={`Options for ${material.title}`}
                size={18}
                color={palette.textMuted}
                items={[
                  ...(material.status !== 'ready' && material.kind !== 'file' ? [{ key: 'retry', label: 'Try Again', icon: 'arrow-path' as const, onPress: () => void retryMaterial(client, material.id).then(refresh, fail('try again')) }] : []),
                  { key: 'remove', label: 'Remove From Collection', icon: 'minus', onPress: () => void removeFromCollection(client, id, material.id).then(refresh, fail('remove it')) },
                  { key: 'more', label: 'More…', icon: 'ellipsis-horizontal', onPress: () => fileMenu(material) },
                ]}
              />
            </Pressable>
          ))}
          {uploading.map((name) => (
            <View key={`up-${name}`} style={[styles.row, { borderBottomColor: palette.border }]}>
              <ActivityIndicator size="small" color={palette.textMuted} />
              <View style={styles.grow}>
                <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={[styles.rowDetail, { color: palette.textMuted }]}>Uploading and reading it… Large files take a while.</Text>
              </View>
            </View>
          ))}

          <Text style={[styles.heading, { color: palette.textMuted }]}>Chats</Text>
          {(chats.data ?? []).length === 0 ? <Text style={[styles.note, { color: palette.textMuted }]}>No chats yet. Ask the tutor about what you read.</Text> : null}
          {(chats.data ?? []).map((chat) => (
            <Pressable
              key={chat.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/learn/[id]', params: { id: chat.id } })}
              style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <Icon name="chat-bubble-left" size={18} color={palette.textMuted} />
              <View style={styles.grow}>
                <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>
                  {chat.title || 'New chat'}
                </Text>
                <Text style={[styles.rowDetail, { color: palette.textFaint }]}>{sessionDate(chat.updatedAt)}</Text>
              </View>
              <Icon name="chevron-right" size={16} color={palette.textFaint} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      <CollectionSheet
        visible={editing}
        title="Rename and Colour"
        initial={{ name: collection?.title ?? '', color: collection?.color ?? '' }}
        onClose={() => setEditing(false)}
        onSave={async (value) => {
          try {
            await updateCollection(client, id, { title: value.name || 'Untitled collection', color: value.color });
            setEditing(false);
            refresh();
          } catch (error) {
            fail('save it')(error);
          }
        }}
      />

      <Modal visible={picking} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicking(false)}>
        <View style={[styles.screen, { backgroundColor: palette.background }]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: palette.text }]} accessibilityRole="header">
              From Your Library
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setPicking(false)} hitSlop={10}>
              <Text style={[styles.done, { color: palette.link }]}>Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            {library.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
            {!library.isLoading && choices.length === 0 ? <Text style={[styles.note, { color: palette.textMuted }]}>Everything in your library is already here.</Text> : null}
            {choices.map((material) => (
              <Pressable
                key={material.id}
                accessibilityRole="button"
                accessibilityHint="Adds it to the collection"
                onPress={() =>
                  void addToCollection(client, id, material.id, true).then(() => {
                    refresh();
                    toast(`Added "${material.title}"`);
                  }, fail('add it'))
                }
                style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                <Icon name={materialIcon(material)} size={20} color={palette.textMuted} />
                <View style={styles.grow}>
                  <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={2}>
                    {material.title}
                  </Text>
                  <Text style={[styles.rowDetail, { color: palette.textMuted }]} numberOfLines={1}>
                    {[describe(material), material.collections.length ? `In ${material.collections.map((item) => item.title).join(', ')}` : ''].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Icon name="plus" size={18} color={palette.textMuted} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { marginTop: 32 },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  actions: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1, gap: 2 },
  heading: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 10 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitle: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  rowDetail: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  badge: { fontFamily: fonts.medium, fontSize: 12 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
  fill: { height: 4, borderRadius: 2 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 },
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.medium, fontSize: 16 },
});
