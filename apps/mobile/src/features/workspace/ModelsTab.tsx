import { deleteWorkspaceModel, exportWorkspaceModels, getWorkspaceModel, setWorkspaceModelHidden, toggleWorkspaceModel, type WorkspaceModel, type WorkspaceView } from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { ModelAvatar } from '@/features/chat/ModelAvatar';
import { fileNameOf, shareFile, stampedName } from '@/features/settings/exportFile';
import { describeError } from '@/lib/errors';
import { useDebounced } from '@/lib/useDebounced';
import { useAuthed, useCapabilities } from '@/lib/server';
import { AccessSheet, type AccessTarget } from './AccessSheet';
import { ListControls } from './ListControls';
import { ModelEditor, type ModelEditorTarget } from './ModelEditor';
import { useWorkspaceModels, useWorkspaceModelTags, useWorkspaceRefresh } from './queries';
import { ListState, listStyles, rowFacts, useWorkspaceRun, WorkspaceList, WorkspaceRow } from './WorkspaceList';

const modelJson = (model: WorkspaceModel) => ({ id: model.id, base_model_id: model.baseModelId, name: model.name, meta: model.meta, params: model.params, is_active: model.isActive });

/** Workspace models: search, whose, tag, order; each with what it builds on, whether it's off or hidden, and what you may do. */
export function ModelsTab({ tabs }: { tabs: (count?: number) => ReactNode }) {
  const toast = useToast();
  const { client, session } = useAuthed();
  const capabilities = useCapabilities();
  const refresh = useWorkspaceRefresh();
  const run = useWorkspaceRun();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const [view, setView] = useState<WorkspaceView>('');
  const [tag, setTag] = useState('');
  const [byName, setByName] = useState(false);
  const [editor, setEditor] = useState<ModelEditorTarget | null>(null);
  const [sharing, setSharing] = useState<AccessTarget | null>(null);
  const models = useWorkspaceModels({ query: debounced, view, tag, orderBy: byName ? 'name' : 'updated_at', direction: byName ? 'asc' : 'desc' });
  const tags = useWorkspaceModelTags();
  const items = models.data?.pages.flatMap((page) => page.items) ?? [];
  const canCreate = capabilities?.isAdmin || capabilities?.can('workspace.models');
  const canExport = capabilities?.isAdmin || capabilities?.can('workspace.models_export');

  const exportModel = async (model: WorkspaceModel) => {
    try {
      const full = await getWorkspaceModel(client, model.id);
      await shareFile(`${fileNameOf(full.name, 'model')}.json`, JSON.stringify([modelJson(full)], null, 2));
    } catch (error) {
      toast(`Couldn’t export it: ${describeError(error)}`, 'error');
    }
  };
  const exportAll = async () => {
    try {
      const all = await exportWorkspaceModels(client);
      if (!all.length) return toast('There are no models to export.', 'error');
      await shareFile(stampedName('models'), JSON.stringify(all, null, 2));
    } catch (error) {
      toast(`Couldn’t export: ${describeError(error)}`, 'error');
    }
  };
  const remove = (model: WorkspaceModel) =>
    Alert.alert(`Delete ${model.name}?`, 'Everyone it’s shared with loses it, and it leaves anyone’s defaults. Chats keep what it said.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => deleteWorkspaceModel(client, model.id), `${model.name} deleted`) },
    ]);
  const menuFor = (model: WorkspaceModel): MenuItem[] => [
    ...(model.isActive ? [{ key: 'try', label: 'Try in Chat', icon: 'chat-bubble-left' as const, onPress: () => router.replace({ pathname: '/', params: { model: model.id } }) }] : []),
    { key: 'link', label: 'Copy Link', icon: 'link', onPress: () => void Clipboard.setStringAsync(`${session.baseUrl}/?model=${encodeURIComponent(model.id)}`).then(() => toast('Link copied')) },
    ...(model.writeAccess
      ? [
          { key: 'edit', label: 'Edit', icon: 'pencil-square' as const, onPress: () => setEditor({ kind: 'edit', id: model.id }) },
          { key: 'share', label: 'Share…', icon: 'users' as const, onPress: () => setSharing({ area: 'models', id: model.id, name: model.name, grants: model.accessGrants }) },
          { key: 'hide', label: model.hidden ? 'Show in Pickers' : 'Hide from Pickers', icon: model.hidden ? ('eye' as const) : ('eye-slash' as const), onPress: () => run(() => setWorkspaceModelHidden(client, model.id, !model.hidden), model.hidden ? 'Shown in everyone’s picker' : 'Hidden from everyone’s picker') },
          ...(canCreate ? [{ key: 'clone', label: 'Clone', icon: 'rectangle-stack' as const, onPress: () => setEditor({ kind: 'clone', id: model.id }) }] : []),
          ...(canExport ? [{ key: 'export', label: 'Export', icon: 'arrow-down-tray' as const, onPress: () => void exportModel(model) }] : []),
          { key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => remove(model) },
        ]
      : [{ key: 'view', label: 'View', icon: 'eye' as const, onPress: () => setEditor({ kind: 'edit', id: model.id }) }]),
  ];
  const more: MenuItem[] = canExport ? [{ key: 'export', label: 'Export All', icon: 'arrow-down-tray', onPress: () => void exportAll() }] : [];

  const header = (
    <View style={listStyles.top}>
      {tabs(models.data?.pages[0]?.total)}
      <ListControls query={query} setQuery={setQuery} placeholder="Search models" view={view} setView={setView} byName={byName} setByName={setByName} tags={tags.data} tag={tag} setTag={setTag} onNew={canCreate ? () => setEditor({ kind: 'new' }) : undefined} more={more} />
      <ListState loading={models.isLoading} error={models.isError ? models.error : null} empty={Boolean(models.data) && !items.length} filtered={Boolean(debounced || tag || view)} noun="workspace models" />
    </View>
  );

  return (
    <View style={listStyles.flex}>
      <WorkspaceList
        items={items}
        keyOf={(model) => model.id}
        header={header}
        paging={models}
        onRefresh={refresh}
        renderItem={(model) => (
          <WorkspaceRow
            leading={<ModelAvatar modelId={model.id} size={38} rounded={10} />}
            title={model.name}
            detail={model.description || (model.baseModelId ? `Built on ${model.baseModelId}` : model.id)}
            facts={rowFacts(model, view, model.hidden ? ['Hidden'] : []) || model.id}
            dim={model.hidden}
            on={model.isActive}
            onToggle={model.writeAccess ? () => run(() => toggleWorkspaceModel(client, model.id), model.isActive ? `${model.name} is off for everyone` : `${model.name} is on`) : undefined}
            menu={menuFor(model)}
            onPress={() => setEditor({ kind: 'edit', id: model.id })}
            hint={model.writeAccess ? 'Opens its editor' : 'Shows it'}
          />
        )}
      />
      <ModelEditor target={editor} onClose={() => setEditor(null)} />
      <AccessSheet target={sharing} onClose={() => setSharing(null)} onSaved={refresh} />
    </View>
  );
}
