import { deleteKbFile, deleteKnowledgeBase, reindexKnowledgeBase, setDefaultKnowledgeBase, uploadKbFiles, type DtKbFile } from '@maviechat/deeptutor-protocol';
import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { filePart, pickDocuments } from '@/features/deeptutor/knowledge/CreateKbSheet';
import { chatWithKnowledgeBase } from '@/features/deeptutor/knowledge/open';
import { documentCount, engineName, fileSize, kbStatus } from '@/features/deeptutor/knowledge/status';
import { sessionDate, useDtKnowledgeBase, useDtRagProviders } from '@/features/deeptutor/queries';
import { openDtPage } from '@/features/deeptutor/settings/DtGeneralSettings';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/**
 * One knowledge base: how its indexing stands, its documents (add more, remove one), and ways to
 * use it. One connected to an outside source is read-only.
 */
export default function KnowledgeBaseScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const params = useLocalSearchParams<{ name: string }>();
  const name = Array.isArray(params.name) ? (params.name[0] ?? '') : (params.name ?? '');
  const { info, files, progress, busy } = useDtKnowledgeBase(name);
  const providers = useDtRagProviders(true);
  const [working, setWorking] = useState<'upload' | 'reindex' | null>(null);
  const kb = info.data;
  const status = kb ? kbStatus(kb, progress.data) : null;
  const writable = kb ? !kb.readOnly : false;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'knowledge-bases'] });
  const fail = (what: string) => (error: unknown) => toast(`Couldn't ${what}: ${describeError(error)}`, 'error');

  const addDocuments = async () => {
    if (!kb) return;
    const picked = await pickDocuments(kb.provider, toast);
    if (!picked.length) return;
    setWorking('upload');
    try {
      await uploadKbFiles(client, name, picked.map(filePart));
      refresh();
      toast(picked.length === 1 ? 'Added; indexing it now' : `Added ${picked.length}; indexing them now`, 'success');
    } catch (error) {
      fail('add them')(error);
    } finally {
      setWorking(null);
    }
  };

  const reindex = () => {
    setWorking('reindex');
    void reindexKnowledgeBase(client, name)
      .then(refresh)
      .catch(fail('re-index it'))
      .finally(() => setWorking(null));
  };

  const removeFile = (file: DtKbFile) =>
    Alert.alert(`Remove “${file.name}”?`, 'It leaves this knowledge base.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void deleteKbFile(client, name, file.name)
            .then(({ wasIndexed }) => {
              refresh();
              // PageIndex drops it from the index too; other engines need a re-index.
              if (wasIndexed && !kb?.provider.startsWith('pageindex')) toast('Removed. Chats can still find its text until you re-index.', 'info', { label: 'Re-index', onPress: reindex });
            })
            .catch(fail('remove it')),
      },
    ]);

  const makeDefault = () =>
    void setDefaultKnowledgeBase(client, name)
      .then(() => {
        refresh();
        toast(`${name} is now the default`, 'success');
      })
      .catch(fail('make it the default'));

  const remove = () =>
    Alert.alert(`Delete “${name}”?`, 'Its documents and index are deleted from DeepTutor. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteKnowledgeBase(client, name)
            .then(() => {
              refresh();
              if (router.canGoBack()) router.back();
              else router.replace('/learn/knowledge');
            })
            .catch(fail('delete it')),
      },
    ]);

  const menu: MenuItem[] = [
    { key: 'chat', label: 'Use in a New Chat', icon: 'chat-bubble-left', onPress: () => chatWithKnowledgeBase(name) },
    ...(writable ? [{ key: 'add', label: 'Add Documents', icon: 'plus' as const, onPress: () => void addDocuments() }] : []),
    // DeepTutor refuses a re-index while a run is going.
    ...(writable && !busy ? [{ key: 'reindex', label: status?.tone === 'problem' ? 'Try Indexing Again' : 'Re-index', icon: 'arrow-path' as const, onPress: reindex }] : []),
    ...(kb && !kb.isDefault ? [{ key: 'default', label: 'Make Default', icon: 'check' as const, onPress: makeDefault }] : []),
    { key: 'web', label: 'More on the Web', icon: 'arrow-top-right-on-square', onPress: () => openDtPage(`/knowledge-bases/${encodeURIComponent(name)}`, name) },
    ...(writable ? [{ key: 'delete', label: 'Delete Knowledge Base', icon: 'trash' as const, destructive: true, onPress: remove }] : []),
  ];

  const percent = busy && progress.data ? Math.min(100, Math.max(0, progress.data.percent)) : 0;
  const statusColor = status?.tone === 'problem' ? palette.danger : palette.text;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/learn/knowledge'))} />
        <Text style={[styles.headerTitle, { color: palette.text }]} numberOfLines={1} accessibilityRole="header">
          {name}
        </Text>
        <MenuButton label="Knowledge base options" items={menu} />
      </View>
      <FlashList
        data={kb ? (files.data ?? []) : []}
        keyExtractor={(item) => item.name}
        refreshing={false}
        onRefresh={refresh}
        ListHeaderComponent={
          kb && status ? (
            <View style={styles.summary}>
              <View style={styles.statusRow}>
                {status.tone === 'busy' ? (
                  <ActivityIndicator size="small" color={palette.textMuted} />
                ) : (
                  <Icon name={status.tone === 'problem' ? 'exclamation-triangle' : 'check'} size={16} color={status.tone === 'problem' ? palette.danger : palette.textMuted} />
                )}
                <Text style={[styles.status, { color: statusColor }]}>{status.label}</Text>
                {working === 'reindex' ? <ActivityIndicator size="small" color={palette.textMuted} /> : null}
              </View>
              {percent > 0 ? (
                <View style={[styles.track, { backgroundColor: palette.surfaceStrong }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}>
                  <View style={[styles.bar, { width: `${percent}%`, backgroundColor: palette.text }]} />
                </View>
              ) : null}
              {busy && progress.data?.message ? <Text style={[styles.note, { color: palette.textMuted }]}>{progress.data.message}</Text> : null}
              {status.detail ? <Text style={[styles.note, { color: palette.textMuted }]}>{status.detail}</Text> : null}
              <Text style={[styles.meta, { color: palette.textFaint }]}>
                {[
                  documentCount(kb.documents),
                  engineName(kb.provider, providers.data),
                  kb.lastIndexedAt ? `Indexed ${sessionDate(kb.lastIndexedAt)}` : '',
                  kb.isDefault ? 'Default' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {kb.description ? <Text style={[styles.description, { color: palette.textMuted }]}>{kb.description}</Text> : null}
              {kb.readOnly ? (
                <Text style={[styles.note, { color: palette.textMuted }]}>Connected to an outside source, so it can&apos;t be changed here.</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={working !== null}
                  onPress={() => void addDocuments()}
                  style={({ pressed }) => [styles.add, { borderColor: palette.border, opacity: working !== null ? 0.5 : 1 }, pressed && { backgroundColor: palette.surface }]}>
                  {working === 'upload' ? <ActivityIndicator size="small" color={palette.text} /> : <Icon name="plus" size={16} color={palette.text} />}
                  <Text style={[styles.addText, { color: palette.text }]}>{kb.provider === 'pageindex-oss' ? 'Add PDFs' : 'Add Documents'}</Text>
                </Pressable>
              )}
              <Text style={[styles.section, { color: palette.textMuted }]}>Documents</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          info.isLoading || files.isLoading ? (
            <ActivityIndicator style={styles.loading} color={palette.textMuted} />
          ) : (
            <Text style={[styles.empty, { color: palette.textMuted }]}>
              {info.isError
                ? `Couldn't load it: ${describeError(info.error)}`
                : files.isError
                  ? `Couldn't list its documents: ${describeError(files.error)}`
                  : 'No documents yet. Add some, and chats that pick this knowledge base can search them.'}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { borderBottomColor: palette.border }]}>
            <Icon name={item.folder ? 'folder' : 'document-text'} size={20} color={palette.textMuted} />
            <View style={styles.rowText}>
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={[styles.meta, { color: palette.textFaint }]}>
                {[item.folder ? 'Folder' : fileSize(item.size), item.modified ? sessionDate(item.modified) : ''].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {writable && !item.folder ? <IconButton icon="trash" label={`Remove ${item.name}`} size={18} color={palette.textMuted} onPress={() => removeFile(item)} /> : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
  headerTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 16, marginHorizontal: 4 },
  summary: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 15 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  bar: { height: 4, borderRadius: 2 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  description: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, borderStyle: 'dashed', marginTop: 4 },
  addText: { fontFamily: fonts.medium, fontSize: 14 },
  section: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 12 },
  loading: { marginVertical: 24 },
  empty: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 24, paddingHorizontal: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19 },
});
