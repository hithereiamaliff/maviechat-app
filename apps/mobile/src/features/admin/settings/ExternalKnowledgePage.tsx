import { deleteWorkspaceKnowledge, EXTERNAL_PROVIDERS, listExternalSources, maskedAddress, setExternalConnectionEnabled, type ExternalSource } from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { Note } from '@/features/settings/rows';
import { AccessSheet, type AccessTarget } from '@/features/workspace/AccessSheet';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import { ExternalSourceSheet, type ExternalSourceTarget } from './ExternalSourceSheet';

const providerLabel = (value: string) => EXTERNAL_PROVIDERS.find((provider) => provider.value === value)?.label ?? value;

/**
 * Admin → External Knowledge (on the web, a part of Integrations, marked experimental): collections
 * kept in another vector database, Qdrant, Milvus or pgvector, searched where they live. Each
 * shows as a connected collection in Workspace → Knowledge. Add one (it must pass a test question
 * first), change it, switch it off (it isn't searched while off), share it, or delete it.
 */
export function ExternalKnowledgePage() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client } = useAuthed();
  const sources = useQuery({ queryKey: ['admin', 'external-knowledge'], queryFn: () => listExternalSources(client) });
  const [editing, setEditing] = useState<ExternalSourceTarget | null>(null);
  const [sharing, setSharing] = useState<AccessTarget | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const connections = sources.data?.connections ?? [];
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'external-knowledge'] });
    void queryClient.invalidateQueries({ queryKey: ['workspace'] });
  };
  const connectionOf = (source: ExternalSource) => connections.find((connection) => connection.id === source.connectionId) ?? null;

  const edit = (source: ExternalSource) => {
    const connection = connectionOf(source);
    if (!connection) return toast('Its connection is gone from the server: delete this source and add it again.', 'error');
    setEditing({ kind: 'edit', source, connection });
  };
  const switchIt = async (source: ExternalSource, on: boolean) => {
    const connection = connectionOf(source);
    if (!connection) return;
    setSwitching(connection.id);
    try {
      await setExternalConnectionEnabled(client, connection, on);
      refresh();
      toast(on ? `${source.knowledge.name} is on` : `${source.knowledge.name} is off: it isn’t searched until it’s back on`);
    } catch (error) {
      toast(`Couldn’t switch it: ${describeError(error)}`, 'error');
    } finally {
      setSwitching(null);
    }
  };
  const remove = (source: ExternalSource) =>
    Alert.alert(`Delete ${source.knowledge.name}?`, 'Models that use it lose it. Nothing in the database itself changes; the server forgets the connection when no other source uses it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteWorkspaceKnowledge(client, source.knowledge.id).then(
            () => {
              refresh();
              toast(`${source.knowledge.name} deleted`);
            },
            (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);
  const menuFor = (source: ExternalSource): MenuItem[] => [
    { key: 'edit', label: 'Edit…', icon: 'pencil-square', onPress: () => edit(source) },
    { key: 'share', label: 'Share…', icon: 'users', onPress: () => setSharing({ area: 'knowledge', id: source.knowledge.id, name: source.knowledge.name, grants: source.knowledge.accessGrants }) },
    { key: 'delete', label: 'Delete…', icon: 'trash', destructive: true, onPress: () => remove(source) },
  ];

  return (
    <View style={styles.page}>
      <Note>Collections kept in another vector database (Qdrant, Milvus or pgvector) and searched there. Each shows as a connected collection in Workspace → Knowledge. The web marks this experimental.</Note>
      <View style={styles.start}>
        <Button label="Add Source" variant="secondary" onPress={() => setEditing({ kind: 'new' })} />
      </View>
      {sources.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {sources.isError ? <Note>{`Couldn’t load them: ${describeError(sources.error)}`}</Note> : null}
      {sources.data && !sources.data.sources.length ? <Note>None yet.</Note> : null}
      {sources.data?.sources.map((source) => {
        const connection = connectionOf(source);
        const on = connection?.enabled !== false;
        return (
          <Pressable
            key={source.knowledge.id}
            accessibilityRole="button"
            accessibilityHint="Opens its settings"
            onPress={() => edit(source)}
            style={({ pressed }) => [styles.item, { borderColor: palette.border, opacity: on ? 1 : 0.6, backgroundColor: pressed ? palette.surface : 'transparent' }]}>
            <View style={styles.text}>
              <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                {source.knowledge.name}
              </Text>
              <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={2}>
                {connection
                  ? [providerLabel(connection.provider), source.collection, maskedAddress(connection.endpoint), connection.keySaved ? 'key saved' : '', source.knowledge.accessGrants.length ? 'shared' : 'private'].filter(Boolean).join(' · ')
                  : 'Its connection is gone from the server'}
              </Text>
            </View>
            {connection ? <Switch accessibilityLabel={`${source.knowledge.name} on`} value={on} disabled={switching === connection.id} onValueChange={(next) => void switchIt(source, next)} /> : null}
            <MenuButton label={`Options for ${source.knowledge.name}`} size={18} color={palette.textMuted} items={menuFor(source)} />
          </Pressable>
        );
      })}
      <ExternalSourceSheet target={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <AccessSheet target={sharing} onClose={() => setSharing(null)} onSaved={refresh} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 10 },
  start: { alignSelf: 'flex-start' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  meta: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
});
