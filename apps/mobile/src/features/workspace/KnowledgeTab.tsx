import { deleteWorkspaceKnowledge, type WorkspaceKnowledge, type WorkspaceView } from '@maviechat/owui-protocol';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';
import type { MenuItem } from '@/components/Menu';
import { useDebounced } from '@/lib/useDebounced';
import { useAuthed, useCapabilities } from '@/lib/server';
import { AccessSheet, type AccessTarget } from './AccessSheet';
import { plural } from './EditorParts';
import { KnowledgeSheet, type KnowledgeSheetTarget } from './KnowledgeSheet';
import { ListControls } from './ListControls';
import { useWorkspaceKnowledgeList, useWorkspaceRefresh } from './queries';
import { ListState, listStyles, rowFacts, useWorkspaceRun, WorkspaceList, WorkspaceRow } from './WorkspaceList';

export const openKnowledge = (id: string) => router.push({ pathname: '/knowledge/[id]', params: { id } });

/** What a collection's row says: how many files, whether it's connected elsewhere. */
export const knowledgeFacts = (knowledge: WorkspaceKnowledge): string[] => [knowledge.fileCount !== null ? plural(knowledge.fileCount, 'file') : '', knowledge.external ? `Connected${knowledge.provider ? ` to ${knowledge.provider}` : ''}` : ''];

/** Knowledge collections: search, whose, order; each with its files count and what you may do. */
export function KnowledgeTab({ tabs }: { tabs: (count?: number) => ReactNode }) {
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const refresh = useWorkspaceRefresh();
  const run = useWorkspaceRun();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const [view, setView] = useState<WorkspaceView>('');
  const [byName, setByName] = useState(false);
  const [sheet, setSheet] = useState<KnowledgeSheetTarget | null>(null);
  const [sharing, setSharing] = useState<AccessTarget | null>(null);
  const knowledge = useWorkspaceKnowledgeList({ query: debounced, view, orderBy: byName ? 'name' : 'updated_at', direction: byName ? 'asc' : 'desc' });
  const items = knowledge.data?.pages.flatMap((page) => page.items) ?? [];
  const canCreate = capabilities?.isAdmin || capabilities?.can('workspace.knowledge');

  const remove = (item: WorkspaceKnowledge) =>
    Alert.alert(`Delete ${item.name}?`, 'Models that use it lose it, and its search data goes. Files you added stay in your files.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => deleteWorkspaceKnowledge(client, item.id), `${item.name} deleted`) },
    ]);
  const menuFor = (item: WorkspaceKnowledge): MenuItem[] => [
    { key: 'open', label: 'Open', icon: 'folder-open', onPress: () => openKnowledge(item.id) },
    ...(item.writeAccess
      ? [
          { key: 'share', label: 'Share…', icon: 'users' as const, onPress: () => setSharing({ area: 'knowledge', id: item.id, name: item.name, grants: item.accessGrants }) },
          { key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => remove(item) },
        ]
      : []),
  ];

  const header = (
    <View style={listStyles.top}>
      {tabs(knowledge.data?.pages[0]?.total)}
      <ListControls query={query} setQuery={setQuery} placeholder="Search knowledge" view={view} setView={setView} byName={byName} setByName={setByName} onNew={canCreate ? () => setSheet({ kind: 'new' }) : undefined} />
      <ListState loading={knowledge.isLoading} error={knowledge.isError ? knowledge.error : null} empty={Boolean(knowledge.data) && !items.length} filtered={Boolean(debounced || view)} noun="knowledge collections" />
    </View>
  );

  return (
    <View style={listStyles.flex}>
      <WorkspaceList
        items={items}
        keyOf={(item) => item.id}
        header={header}
        paging={knowledge}
        onRefresh={refresh}
        renderItem={(item) => <WorkspaceRow title={item.name} detail={item.description} facts={rowFacts({ ...item, isActive: true }, view, knowledgeFacts(item).filter(Boolean))} menu={menuFor(item)} onPress={() => openKnowledge(item.id)} hint="Opens its files" />}
      />
      <KnowledgeSheet target={sheet} onClose={() => setSheet(null)} onSaved={(made) => openKnowledge(made.id)} />
      <AccessSheet target={sharing} onClose={() => setSharing(null)} onSaved={refresh} />
    </View>
  );
}
