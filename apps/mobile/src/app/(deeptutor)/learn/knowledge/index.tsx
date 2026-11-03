import { deleteKnowledgeBase, setDefaultKnowledgeBase, type DtKnowledgeBaseInfo } from '@maviechat/deeptutor-protocol';
import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { CreateKbSheet } from '@/features/deeptutor/knowledge/CreateKbSheet';
import { chatWithKnowledgeBase } from '@/features/deeptutor/knowledge/open';
import { documentCount, engineName, kbStatus } from '@/features/deeptutor/knowledge/status';
import { useDtKnowledgeCenter, useDtRagProviders } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

/**
 * The Knowledge Center: knowledge bases built from your documents, which chats search when you
 * pick them. Each shows how its indexing stands; + makes a new one.
 */
export default function KnowledgeCenter() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const center = useDtKnowledgeCenter();
  const providers = useDtRagProviders(true);
  const [creating, setCreating] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'knowledge-bases'] });
  const fail = (what: string) => (error: unknown) => toast(`Couldn't ${what}: ${describeError(error)}`, 'error');

  const makeDefault = (kb: DtKnowledgeBaseInfo) =>
    void setDefaultKnowledgeBase(client, kb.name)
      .then(() => {
        refresh();
        toast(`${kb.name} is now the default`, 'success');
      })
      .catch(fail('make it the default'));

  const remove = (kb: DtKnowledgeBaseInfo) =>
    Alert.alert(`Delete “${kb.name}”?`, 'Its documents and index are deleted from DeepTutor. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteKnowledgeBase(client, kb.name).then(refresh).catch(fail('delete it')) },
    ]);

  const menuFor = (kb: DtKnowledgeBaseInfo): MenuItem[] => [
    { key: 'chat', label: 'Use in a New Chat', icon: 'chat-bubble-left', onPress: () => chatWithKnowledgeBase(kb.name) },
    ...(kb.isDefault ? [] : [{ key: 'default', label: 'Make Default', icon: 'check' as const, onPress: () => makeDefault(kb) }]),
    ...(kb.readOnly ? [] : [{ key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => remove(kb) }]),
  ];

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Knowledge Center" accessory={<IconButton icon="plus" label="New knowledge base" onPress={() => setCreating(true)} />} />
      <FlashList
        data={center.data ?? []}
        keyExtractor={(item) => item.name}
        refreshing={false}
        onRefresh={refresh}
        ListHeaderComponent={
          <Text style={[styles.intro, { color: palette.textMuted }]}>
            Your documents, indexed so chats can search them. Pick one in any chat from the + menu, or tap Use in a New Chat.
          </Text>
        }
        ListEmptyComponent={
          center.isLoading ? (
            <ActivityIndicator style={styles.loading} color={palette.textMuted} />
          ) : (
            <Text style={[styles.empty, { color: palette.textMuted }]}>
              {center.isError ? `Couldn't load your knowledge bases: ${describeError(center.error)}` : 'No knowledge bases yet. Tap + to make one from your documents.'}
            </Text>
          )
        }
        renderItem={({ item }) => {
          const status = kbStatus(item);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Opens the knowledge base"
              onPress={() => router.push({ pathname: '/learn/knowledge/[name]', params: { name: item.name } })}
              style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <Icon name="circle-stack" size={20} color={palette.textMuted} />
              <View style={styles.rowText}>
                <View style={styles.titleRow}>
                  <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.isDefault ? <Text style={[styles.badge, { color: palette.textMuted, borderColor: palette.border }]}>Default</Text> : null}
                </View>
                {item.description ? (
                  <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
                <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
                  <Text style={{ color: status.tone === 'problem' ? palette.danger : status.tone === 'busy' ? palette.text : palette.textFaint }}>{status.label}</Text>
                  {[status.tone === 'busy' ? '' : documentCount(item.documents), engineName(item.provider, providers.data)]
                    .filter(Boolean)
                    .map((part) => ` · ${part}`)
                    .join('')}
                </Text>
              </View>
              {status.tone === 'busy' ? <ActivityIndicator size="small" color={palette.textMuted} /> : null}
              <MenuButton label={`Options for ${item.name}`} size={18} color={palette.textMuted} items={menuFor(item)} />
            </Pressable>
          );
        }}
      />
      <CreateKbSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={(name) => {
          setCreating(false);
          router.push({ pathname: '/learn/knowledge/[name]', params: { name } });
        }}
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 15 },
  badge: { fontFamily: fonts.medium, fontSize: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  description: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
});
