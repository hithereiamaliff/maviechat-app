import {
  deleteWorkspaceModel,
  exportWorkspaceModels,
  getWorkspaceModel,
  importWorkspaceModel,
  isAtLeast,
  listAllWorkspaceModels,
  modelsFromImport,
  setWorkspaceModelActive,
  setWorkspaceModelHidden,
  toggleWorkspaceModel,
  type ModelImport,
  type OwuiClient,
  type WorkspaceModel,
  type WorkspaceView,
} from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { ModelAvatar } from '@/features/chat/ModelAvatar';
import { usePinnedModels } from '@/features/chat/usePinnedModels';
import { fileNameOf, shareFile, stampedName } from '@/features/settings/exportFile';
import { eachFew, failures } from '@/lib/eachFew';
import { describeError } from '@/lib/errors';
import { useDebounced } from '@/lib/useDebounced';
import { useAuthed, useCapabilities, useModels } from '@/lib/server';
import { AccessSheet, type AccessTarget } from './AccessSheet';
import { CodeVersionsSheet, type CodeVersionsTarget } from './CodeVersionsSheet';
import { pickTextFile, plural } from './EditorParts';
import { ListControls } from './ListControls';
import { ModelEditor, type ModelEditorTarget } from './ModelEditor';
import { useWorkspaceModels, useWorkspaceModelTags, useWorkspaceRefresh } from './queries';
import { ListState, listStyles, rowFacts, useWorkspaceRun, WorkspaceList, WorkspaceRow } from './WorkspaceList';

const modelJson = (model: WorkspaceModel) => ({ id: model.id, base_model_id: model.baseModelId, name: model.name, meta: model.meta, params: model.params, is_active: model.isActive });

/** The list's "… All" actions, as the web's Actions menu has them, for the models you may change. */
type Bulk = 'on' | 'off' | 'show' | 'hide';
const BULK: Record<Bulk, { label: string; icon: 'check-circle' | 'minus-circle' | 'eye' | 'eye-slash'; needs: (model: WorkspaceModel) => boolean; ask: (count: string) => string; note: string; button: string; done: (count: string) => string; none: string; run: (client: OwuiClient, model: WorkspaceModel) => Promise<unknown> }> = {
  on: {
    label: 'Turn All On',
    icon: 'check-circle',
    needs: (model) => !model.isActive,
    ask: (count) => `Turn on ${count}?`,
    note: 'They’re back in the model picker of everyone they’re shared with.',
    button: 'Turn On',
    done: (count) => `${count} turned on`,
    none: 'They’re all on already.',
    run: (client, model) => setWorkspaceModelActive(client, model.id, true),
  },
  off: {
    label: 'Turn All Off',
    icon: 'minus-circle',
    needs: (model) => model.isActive,
    ask: (count) => `Turn off ${count}?`,
    note: 'They leave everyone’s model picker and can’t be used until they’re turned on again.',
    button: 'Turn Off',
    done: (count) => `${count} turned off for everyone`,
    none: 'They’re all off already.',
    run: (client, model) => setWorkspaceModelActive(client, model.id, false),
  },
  show: {
    label: 'Show All in Pickers',
    icon: 'eye',
    needs: (model) => model.hidden,
    ask: (count) => `Show ${count} in pickers?`,
    note: 'They show in the model picker again, for everyone who may use them.',
    button: 'Show',
    done: (count) => `${count} shown in everyone’s picker`,
    none: 'None of them is hidden.',
    run: (client, model) => setWorkspaceModelHidden(client, model.id, false),
  },
  hide: {
    label: 'Hide All from Pickers',
    icon: 'eye-slash',
    needs: (model) => !model.hidden,
    ask: (count) => `Hide ${count} from pickers?`,
    note: 'They keep working (in chats that use them, and by link) but leave everyone’s model picker.',
    button: 'Hide',
    done: (count) => `${count} hidden from everyone’s picker`,
    none: 'They’re all hidden already.',
    run: (client, model) => setWorkspaceModelHidden(client, model.id, true),
  },
};

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
  const [versions, setVersions] = useState<CodeVersionsTarget | null>(null);
  // 0.12 keeps each saved change of a model as a version (its writers may look).
  const versioned = isAtLeast(capabilities?.version, '0.12.0');
  const [importing, setImporting] = useState(false);
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const pinned = usePinnedModels();
  const usable = useModels();
  const models = useWorkspaceModels({ query: debounced, view, tag, orderBy: byName ? 'name' : 'updated_at', direction: byName ? 'asc' : 'desc' });
  const tags = useWorkspaceModelTags();
  const items = models.data?.pages.flatMap((page) => page.items) ?? [];
  const canCreate = capabilities?.isAdmin || capabilities?.can('workspace.models');
  const canExport = capabilities?.isAdmin || capabilities?.can('workspace.models_export');
  const canImport = capabilities?.isAdmin || capabilities?.can('workspace.models_import');

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
  const runImport = async (found: ModelImport[]) => {
    setImporting(true);
    const failed = await eachFew(found, (item) => importWorkspaceModel(client, item), (item) => item.name);
    setImporting(false);
    refresh();
    if (!failed.length) toast(`Imported ${plural(found.length, 'model')}`);
    else toast(`Imported ${found.length - failed.length} of ${found.length}. ${failures(failed)}`, 'error');
  };
  const importModels = async () => {
    let found: ReturnType<typeof modelsFromImport>;
    try {
      const file = await pickTextFile('application/json');
      if (!file) return;
      // An older export's `{id, info}` changes a model you can use already, as on the web.
      found = modelsFromImport(JSON.parse(file.text), new Set((usable.data ?? []).map((model) => model.id)));
    } catch (error) {
      return toast(`Couldn’t read the file: ${describeError(error)}`, 'error');
    }
    if (!found.models.length) return toast('There are no models in the file.', 'error');
    const changed = found.models.filter((item) => item.update).length;
    const made = found.models.length - changed;
    const note = [
      made ? `${made === found.models.length ? 'Each' : plural(made, 'model')} becomes a new model of yours, private until you share it.` : '',
      changed ? `${plural(changed, 'model')} you have already (an older export) ${changed === 1 ? 'takes' : 'take'} the file’s version, sharing kept.` : '',
      found.skipped ? `${plural(found.skipped, 'entry', 'entries')} without an id or a name ${found.skipped === 1 ? 'is' : 'are'} left out.` : '',
      'Any whose id is taken on this server won’t come in.',
    ];
    Alert.alert(`Import ${plural(found.models.length, 'model')}?`, note.filter(Boolean).join(' '), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Import', onPress: () => void runImport(found.models) },
    ]);
  };
  const runBulk = async (kind: Bulk, targets: WorkspaceModel[]) => {
    const action = BULK[kind];
    setBulk(kind);
    const failed = await eachFew(targets, (model) => action.run(client, model), (model) => model.name);
    setBulk(null);
    refresh();
    if (!failed.length) toast(action.done(plural(targets.length, 'model')));
    else toast(`${action.done(`${targets.length - failed.length} of ${targets.length}`)}. ${failures(failed)}`, 'error');
  };
  const askBulk = async (kind: Bulk) => {
    const action = BULK[kind];
    let found: WorkspaceModel[];
    try {
      // Everything the list's search, whose and tag find, on every page, as the web gathers it.
      found = await listAllWorkspaceModels(client, { query: debounced, view, tag });
    } catch (error) {
      return toast(`Couldn’t list the models: ${describeError(error)}`, 'error');
    }
    const yours = found.filter((model) => model.writeAccess);
    const targets = yours.filter(action.needs);
    if (!yours.length) return toast('None of these models can be changed by you.', 'error');
    if (!targets.length) return toast(action.none);
    const filtered = Boolean(debounced || view || tag);
    const scope = `${filtered ? 'Of the models this list finds, the' : 'The'} ones you may change${yours.length < found.length ? ` (${plural(found.length - yours.length, 'model')} shared with you to use stay as they are)` : ''}.`;
    Alert.alert(action.ask(plural(targets.length, 'model')), `${action.note} ${scope}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: action.button, style: kind === 'off' ? 'destructive' : 'default', onPress: () => void runBulk(kind, targets) },
    ]);
  };
  const remove = (model: WorkspaceModel) =>
    Alert.alert(`Delete ${model.name}?`, 'Everyone it’s shared with loses it, and it leaves anyone’s defaults. Chats keep what it said.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => deleteWorkspaceModel(client, model.id), `${model.name} deleted`) },
    ]);
  const pin = (model: WorkspaceModel): MenuItem => {
    const kept = pinned.isPinned(model.id);
    return {
      key: 'pin',
      label: kept ? 'Hide from Sidebar' : 'Keep in Sidebar',
      icon: kept ? 'bookmark-slash' : 'bookmark',
      onPress: () => {
        pinned.toggle(model.id);
        toast(kept ? `${model.name} left the sidebar` : `${model.name} is kept in the sidebar`);
      },
    };
  };
  const menuFor = (model: WorkspaceModel): MenuItem[] => [
    ...(model.isActive ? [{ key: 'try', label: 'Try in Chat', icon: 'chat-bubble-left' as const, onPress: () => router.replace({ pathname: '/', params: { model: model.id } }) }, pin(model)] : []),
    { key: 'link', label: 'Copy Link', icon: 'link', onPress: () => void Clipboard.setStringAsync(`${session.baseUrl}/?model=${encodeURIComponent(model.id)}`).then(() => toast('Link copied')) },
    ...(model.writeAccess
      ? [
          { key: 'edit', label: 'Edit', icon: 'pencil-square' as const, onPress: () => setEditor({ kind: 'edit', id: model.id }) },
          { key: 'share', label: 'Share…', icon: 'users' as const, onPress: () => setSharing({ area: 'models', id: model.id, name: model.name, grants: model.accessGrants }) },
          ...(versioned ? [{ key: 'versions', label: 'Versions…', icon: 'clock' as const, onPress: () => setVersions({ kind: 'models', id: model.id, name: model.name, canWrite: true }) }] : []),
          { key: 'hide', label: model.hidden ? 'Show in Pickers' : 'Hide from Pickers', icon: model.hidden ? ('eye' as const) : ('eye-slash' as const), onPress: () => run(() => setWorkspaceModelHidden(client, model.id, !model.hidden), model.hidden ? 'Shown in everyone’s picker' : 'Hidden from everyone’s picker') },
          ...(canCreate ? [{ key: 'clone', label: 'Clone', icon: 'rectangle-stack' as const, onPress: () => setEditor({ kind: 'clone', id: model.id }) }] : []),
          ...(canExport ? [{ key: 'export', label: 'Export', icon: 'arrow-down-tray' as const, onPress: () => void exportModel(model) }] : []),
          { key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => remove(model) },
        ]
      : [{ key: 'view', label: 'View', icon: 'eye' as const, onPress: () => setEditor({ kind: 'edit', id: model.id }) }]),
  ];
  const more: MenuItem[] = [
    ...(canImport ? [{ key: 'import', label: importing ? 'Importing…' : 'Import…', icon: 'arrow-up-tray' as const, onPress: () => void (importing ? undefined : importModels()) }] : []),
    ...(canExport ? [{ key: 'export', label: 'Export All', icon: 'arrow-down-tray' as const, onPress: () => void exportAll() }] : []),
    // The web offers these to everyone; here to those who make models (the rest seldom may change any).
    ...(canCreate
      ? (Object.keys(BULK) as Bulk[]).map((kind) => ({ key: `bulk-${kind}`, label: bulk === kind ? 'Working…' : BULK[kind].label, icon: BULK[kind].icon, onPress: () => void (bulk ? undefined : askBulk(kind)) }))
      : []),
  ];

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
      <CodeVersionsSheet target={versions} onClose={() => setVersions(null)} onChanged={refresh} />
      <AccessSheet target={sharing} onClose={() => setSharing(null)} onSaved={refresh} />
    </View>
  );
}
