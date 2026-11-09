import {
  adminModelTags,
  deleteAllModels,
  deleteKindOf,
  deleteWorkspaceModel,
  exportAdminModel,
  exportAdminModels,
  fullModelOrder,
  getModelsConfig,
  idsOf,
  importAdminModels,
  inAdminView,
  isAtLeast,
  inModelOrder,
  isPublicModel,
  listAdminModels,
  rowsFromImport,
  saveModelsConfig,
  setAdminModelActive,
  setAdminModelHidden,
  setAdminModelPublic,
  withListedModel,
  type AdminModel,
  type AdminModelView,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { ModelAvatar } from '@/features/chat/ModelAvatar';
import { usePinnedModels } from '@/features/chat/usePinnedModels';
import { fileNameOf, shareFile, stampedName } from '@/features/settings/exportFile';
import { ActionRow, Group, Note } from '@/features/settings/rows';
import { AccessSheet, type AccessTarget } from '@/features/workspace/AccessSheet';
import { CodeVersionsSheet, type CodeVersionsTarget } from '@/features/workspace/CodeVersionsSheet';
import { pickTextFile, plural } from '@/features/workspace/EditorParts';
import { Chip } from '@/features/workspace/ListControls';
import { ModelEditor, type ModelEditorTarget } from '@/features/workspace/ModelEditor';
import { eachFew, failures } from '@/lib/eachFew';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import { ModelDefaultsSheet } from './ModelDefaultsSheet';
import { ModelOrderSheet } from './ModelOrderSheet';

/** The web's views (0.11's and 0.12's together). */
const VIEWS: { key: AdminModelView; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'on', label: 'On' },
  { key: 'off', label: 'Off' },
  { key: 'visible', label: 'Visible' },
  { key: 'hidden', label: 'Hidden' },
  { key: 'public', label: 'Public' },
  { key: 'private', label: 'Private' },
  { key: 'default', label: 'New Chats' },
  { key: 'pinned', label: 'Pinned' },
  { key: 'available', label: 'Available' },
  { key: 'unavailable', label: 'Unavailable' },
  { key: 'base', label: 'Base' },
  { key: 'workspace', label: 'Workspace' },
];

/** The web's Actions menu's "… All", for the models the list shows. */
type Bulk = 'on' | 'off' | 'show' | 'hide';
const BULK: Record<Bulk, { label: string; icon: 'check-circle' | 'minus-circle' | 'eye' | 'eye-slash'; needs: (model: AdminModel) => boolean; ask: (count: string) => string; note: string; button: string; done: (count: string) => string; none: string; run: (client: OwuiClient, model: AdminModel) => Promise<unknown> }> = {
  on: {
    label: 'Turn All On',
    icon: 'check-circle',
    needs: (model) => !model.isActive,
    ask: (count) => `Turn on ${count}?`,
    note: 'They’re back in the model picker of everyone who may use them.',
    button: 'Turn On',
    done: (count) => `${count} turned on`,
    none: 'They’re all on already.',
    run: (client, model) => setAdminModelActive(client, model, true),
  },
  off: {
    label: 'Turn All Off',
    icon: 'minus-circle',
    needs: (model) => model.isActive,
    ask: (count) => `Turn off ${count}?`,
    note: 'They leave everyone’s model picker, and nobody can chat with them until they’re turned on again.',
    button: 'Turn Off',
    done: (count) => `${count} turned off for everyone`,
    none: 'They’re all off already.',
    run: (client, model) => setAdminModelActive(client, model, false),
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
    run: (client, model) => setAdminModelHidden(client, model, false),
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
    run: (client, model) => setAdminModelHidden(client, model, true),
  },
};

/**
 * Every model on the server, for admins, in the order everyone's pickers show them (with saved
 * settings of models no connection offers now): the web's views and tags; on or off for everyone,
 * hidden from pickers, what new chats start with, what's pinned for everyone, public or who may
 * use it; edit (a connection's model's own settings too), clone, reset or delete; the defaults
 * every model starts with, the order, import and export, the web's "… All" actions and Reset All.
 * Each change reads the server first and changes only itself.
 */
export function ModelsPage() {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useAuthed();
  const queryClient = useQueryClient();
  const models = useQuery({ queryKey: ['admin', 'models'], queryFn: () => listAdminModels(client), staleTime: 15_000 });
  const config = useQuery({ queryKey: ['admin', 'models-config'], queryFn: () => getModelsConfig(client), staleTime: 0 });
  const [query, setQuery] = useState('');
  const [view, setView] = useState<AdminModelView>('all');
  const [tag, setTag] = useState('');
  const [sharing, setSharing] = useState<AccessTarget | null>(null);
  const [editor, setEditor] = useState<ModelEditorTarget | null>(null);
  const [versions, setVersions] = useState<CodeVersionsTarget | null>(null);
  // 0.12 keeps each saved change of a model's settings as a version.
  const versioned = isAtLeast(useCapabilities()?.version, '0.12.0');
  const mine = usePinnedModels();
  const [sheet, setSheet] = useState<'defaults' | 'order' | null>(null);
  const [working, setWorking] = useState<Bulk | 'import' | null>(null);
  const defaults = idsOf(config.data?.DEFAULT_MODELS);
  const pinned = idsOf(config.data?.DEFAULT_PINNED_MODELS);
  const all = models.data ?? [];
  const ordered = config.data ? inModelOrder(all, fullModelOrder(config.data, all.map((model) => model.id))) : all;
  const tags = adminModelTags(all);
  const activeTag = tags.includes(tag) ? tag : '';
  const wanted = query.trim().toLowerCase();
  const filtered = Boolean(wanted) || view !== 'all' || Boolean(activeTag);
  const shown = ordered
    .filter((model) => inAdminView(model, view, { defaults, pinned }))
    .filter((model) => !activeTag || model.tags.includes(activeTag))
    .filter((model) => !wanted || `${model.name} ${model.id}`.toLowerCase().includes(wanted));
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
    void queryClient.invalidateQueries({ queryKey: ['models'] });
    void queryClient.invalidateQueries({ queryKey: ['config'] });
  };
  const run = (done: string, work: () => Promise<unknown>, failed = 'Couldn’t save') =>
    void work().then(
      () => {
        refresh();
        toast(done);
      },
      (error: unknown) => toast(`${failed}: ${describeError(error)}`, 'error'),
    );
  const listed = (model: AdminModel, key: 'DEFAULT_MODELS' | 'DEFAULT_PINNED_MODELS', on: boolean, done: string) => run(done, async () => saveModelsConfig(client, withListedModel(await getModelsConfig(client), key, model.id, on)));

  const exportAll = async () => {
    try {
      const rows = await exportAdminModels(client);
      if (!rows.length) return toast('No model has saved settings to export yet.', 'error');
      await shareFile(stampedName('models'), JSON.stringify(rows, null, 2));
    } catch (error) {
      toast(`Couldn’t export: ${describeError(error)}`, 'error');
    }
  };
  const exportOne = async (model: AdminModel) => {
    try {
      const row = await exportAdminModel(client, model);
      await shareFile(`${fileNameOf(model.name, 'model')}.json`, JSON.stringify([row], null, 2));
    } catch (error) {
      toast(`Couldn’t export it: ${describeError(error)}`, 'error');
    }
  };

  const runImport = async (rows: Record<string, unknown>[]) => {
    setWorking('import');
    try {
      await importAdminModels(client, rows);
      // The server leaves out ids it doesn't allow, or models with knowledge you can't reach, quietly.
      const saved = new Set((await exportAdminModels(client)).map((row) => String(row.id)));
      const arrived = rows.filter((row) => saved.has(String(row.id))).length;
      refresh();
      if (arrived === rows.length) toast(`Imported ${plural(rows.length, 'model')}`);
      else toast(`Imported ${arrived} of ${rows.length}: the server left out the rest (ids it doesn’t allow, or knowledge you can’t reach).`, 'error');
    } catch (error) {
      toast(`Couldn’t import: ${describeError(error)}`, 'error');
    } finally {
      setWorking(null);
    }
  };
  const importModels = async () => {
    let found: ReturnType<typeof rowsFromImport>;
    try {
      const file = await pickTextFile('application/json');
      if (!file) return;
      found = rowsFromImport(JSON.parse(file.text));
    } catch (error) {
      return toast(`Couldn’t read the file: ${describeError(error)}`, 'error');
    }
    if (!found.rows.length) return toast('There are no models in the file.', 'error');
    let saved: Set<string>;
    try {
      saved = new Set((await exportAdminModels(client)).map((row) => String(row.id)));
    } catch (error) {
      return toast(`Couldn’t read the saved models: ${describeError(error)}`, 'error');
    }
    const changed = found.rows.filter((row) => saved.has(String(row.id))).length;
    const made = found.rows.length - changed;
    const note = [
      made ? `${plural(made, 'model')} ${made === 1 ? 'is' : 'are'} new here.` : '',
      changed ? `${plural(changed, 'model')} saved here already ${changed === 1 ? 'takes' : 'take'} the file’s settings; what the file leaves out of ${changed === 1 ? 'its' : 'their'} details stays.` : '',
      'Each model’s sharing comes from the file where it has any.',
      found.skipped ? `${plural(found.skipped, 'entry', 'entries')} without an id or a name ${found.skipped === 1 ? 'is' : 'are'} left out.` : '',
    ];
    Alert.alert(`Import ${plural(found.rows.length, 'model')}?`, note.filter(Boolean).join(' '), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Import', onPress: () => void runImport(found.rows) },
    ]);
  };

  const runBulk = async (kind: Bulk, targets: AdminModel[]) => {
    const action = BULK[kind];
    setWorking(kind);
    const failed = await eachFew(targets, (model) => action.run(client, model), (model) => model.name);
    setWorking(null);
    refresh();
    if (!failed.length) toast(action.done(plural(targets.length, 'model')));
    else toast(`${action.done(`${targets.length - failed.length} of ${targets.length}`)}. ${failures(failed)}`, 'error');
  };
  const askBulk = (kind: Bulk) => {
    const action = BULK[kind];
    if (!shown.length) return toast('The list shows no models.', 'error');
    const targets = shown.filter(action.needs);
    if (!targets.length) return toast(action.none);
    Alert.alert(action.ask(plural(targets.length, 'model')), `${action.note} ${filtered ? 'This is for the models the list shows now (its search and chips).' : 'This is for every model on the server.'}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: action.button, style: kind === 'off' ? 'destructive' : 'default', onPress: () => void runBulk(kind, targets) },
    ]);
  };

  const edit = (model: AdminModel) => setEditor(model.preset ? { kind: 'edit', id: model.id } : { kind: 'base', id: model.id, name: model.name, saved: model.hasRow });
  const askDelete = (model: AdminModel, kind: 'reset' | 'delete') => {
    const ask =
      kind === 'reset'
        ? { title: `Reset ${model.name}?`, message: 'Its settings saved here go: its name, picture, prompt, parameters, sharing, and whether it’s on or hidden. With nothing saved, only admins see it, until settings are saved for it again (Edit, or Who May Use It).', button: 'Reset', done: `${model.name} reset` }
        : model.preset
          ? { title: `Delete ${model.name}?`, message: 'Everyone it’s shared with loses it, and it leaves anyone’s defaults. Chats keep what it said.', button: 'Delete', done: `${model.name} deleted` }
          : { title: `Delete ${model.name}’s settings?`, message: 'No connection offers it now. Its saved settings go; if a connection offers it again, it starts with none, seen only by admins until settings are saved.', button: 'Delete', done: `${model.name}’s settings deleted` };
    Alert.alert(ask.title, ask.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: ask.button, style: 'destructive', onPress: () => run(ask.done, () => deleteWorkspaceModel(client, model.id), kind === 'reset' ? 'Couldn’t reset it' : 'Couldn’t delete it') },
    ]);
  };
  const confirmResetAll = (count: number) =>
    Alert.alert('Delete them all?', `${plural(count, 'saved model')} go for good, for everyone. There’s no way back.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete All', style: 'destructive', onPress: () => run('Every saved model deleted', () => deleteAllModels(client), 'Couldn’t delete them') },
    ]);
  const askResetAll = async () => {
    let count: number;
    try {
      count = (await exportAdminModels(client)).length;
    } catch (error) {
      return toast(`Couldn’t read the saved models: ${describeError(error)}`, 'error');
    }
    if (!count) return toast('No model has saved settings.');
    Alert.alert(
      `Delete all ${plural(count, 'saved model')}?`,
      'Every workspace model, everyone’s, and every setting saved for the connections’ models: names, pictures, prompts, parameters, sharing, on or off. The connections’ models stay, with nothing saved, seen only by admins until settings are saved again. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Export First', onPress: () => void exportAll() },
        { text: 'Delete All…', style: 'destructive', onPress: () => confirmResetAll(count) },
      ],
    );
  };

  const actions: MenuItem[] = [
    { key: 'import', label: working === 'import' ? 'Importing…' : 'Import…', icon: 'arrow-up-tray', onPress: () => void (working ? undefined : importModels()) },
    { key: 'export', label: 'Export All', icon: 'arrow-down-tray', onPress: () => void exportAll() },
    ...(Object.keys(BULK) as Bulk[]).map((kind) => ({ key: `bulk-${kind}`, label: working === kind ? 'Working…' : BULK[kind].label, icon: BULK[kind].icon, onPress: () => void (working ? undefined : askBulk(kind)) })),
    { key: 'reset-all', label: 'Reset All…', icon: 'trash', destructive: true, onPress: () => void askResetAll() },
  ];
  const menuFor = (model: AdminModel): MenuItem[] => {
    const kind = deleteKindOf(model);
    const everyone = isPublicModel(model);
    const kept = mine.isPinned(model.id);
    return [
      { key: 'edit', label: 'Edit…', icon: 'pencil-square', onPress: () => edit(model) },
      { key: 'clone', label: 'Clone', icon: 'rectangle-stack', onPress: () => setEditor(model.preset ? { kind: 'clone', id: model.id } : { kind: 'build', id: model.id, name: model.name, saved: model.hasRow }) },
      { key: 'hide', label: model.hidden ? 'Show in Pickers' : 'Hide from Pickers', icon: model.hidden ? 'eye' : 'eye-slash', onPress: () => run(model.hidden ? `${model.name} shown` : `${model.name} hidden from everyone’s picker`, () => setAdminModelHidden(client, model, !model.hidden)) },
      defaults.includes(model.id)
        ? { key: 'default', label: 'Stop Starting Chats With It', icon: 'chat-bubble-left', onPress: () => listed(model, 'DEFAULT_MODELS', false, `New chats no longer start with ${model.name}`) }
        : { key: 'default', label: 'Start New Chats With It', icon: 'chat-bubble-left', onPress: () => listed(model, 'DEFAULT_MODELS', true, `New chats start with ${model.name}`) },
      pinned.includes(model.id)
        ? { key: 'pin', label: 'Unpin for Everyone', icon: 'bookmark-slash', onPress: () => listed(model, 'DEFAULT_PINNED_MODELS', false, `${model.name} unpinned`) }
        : { key: 'pin', label: 'Pin for Everyone', icon: 'bookmark', onPress: () => listed(model, 'DEFAULT_PINNED_MODELS', true, `${model.name} pinned for everyone`) },
      ...(model.isActive
        ? [
            {
              key: 'sidebar',
              label: kept ? 'Hide from Sidebar' : 'Keep in Sidebar',
              icon: 'star' as const,
              onPress: () => {
                mine.toggle(model.id);
                toast(kept ? `${model.name} left your sidebar` : `${model.name} is kept in your sidebar`);
              },
            },
          ]
        : []),
      // A model with nothing saved gets a row for its sharing, under its own name.
      { key: 'public', label: everyone ? 'Make Private' : 'Make Public', icon: everyone ? 'lock-closed' : 'globe-alt', onPress: () => run(everyone ? `${model.name} isn’t for everyone now` : `Everyone may use ${model.name} now`, () => setAdminModelPublic(client, model, !everyone)) },
      { key: 'share', label: 'Who May Use It…', icon: 'users', onPress: () => setSharing({ area: 'models', id: model.id, name: model.name, grants: model.accessGrants }) },
      { key: 'link', label: 'Copy Link', icon: 'link', onPress: () => void Clipboard.setStringAsync(`${session.baseUrl}/?model=${encodeURIComponent(model.id)}`).then(() => toast('Link copied')) },
      ...(model.hasRow && versioned ? [{ key: 'versions', label: 'Versions…', icon: 'clock' as const, onPress: () => setVersions({ kind: 'models', id: model.id, name: model.name, canWrite: true }) }] : []),
      ...(model.hasRow ? [{ key: 'export', label: 'Export', icon: 'arrow-down-tray' as const, onPress: () => void exportOne(model) }] : []),
      ...(kind ? [{ key: 'delete', label: kind === 'reset' ? 'Reset…' : 'Delete…', icon: kind === 'reset' ? ('arrow-path' as const) : ('trash' as const), destructive: true, onPress: () => askDelete(model, kind) }] : []),
    ];
  };

  return (
    <View style={styles.page}>
      <Note>Every model on this server, in the order everyone’s pickers show them. Opening this asks each connection for its list, as the web does.</Note>
      {config.data ? (
        <Note>{`New chats start with: ${defaults.length ? defaults.join(', ') : 'each person’s own choice'}. Pinned for everyone: ${pinned.length ? pinned.join(', ') : 'none'}.`}</Note>
      ) : null}
      <Group>
        <ActionRow label="Model Defaults" hint="What every model starts with: capabilities, parameters, prompt suggestions. A model’s own settings win." onPress={() => setSheet('defaults')} />
        <ActionRow
          label="Order in Pickers"
          hint="The order everyone’s model pickers show."
          value={models.data && config.data ? plural(all.length, 'model') : '…'}
          disabled={!models.data || !config.data}
          onPress={() => setSheet('order')}
        />
      </Group>
      <View style={styles.searchRow}>
        <TextInput value={query} onChangeText={setQuery} placeholder="Search models" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search models" style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        <MenuButton label="Model actions" size={22} color={palette.textMuted} items={actions} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.views}>
        {VIEWS.map((item) => (
          <Chip key={item.key} label={item.label} on={view === item.key} onPress={() => setView(item.key)} />
        ))}
      </ScrollView>
      {tags.length ? (
        <View style={styles.chips}>
          {tags.map((name) => (
            <Chip key={name} label={`#${name}`} on={activeTag === name} onPress={() => setTag(activeTag === name ? '' : name)} />
          ))}
        </View>
      ) : null}
      {models.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {models.isError ? <Note>{`Couldn’t load the models: ${describeError(models.error)}`}</Note> : null}
      {models.data && !shown.length ? <Note>Nothing matches.</Note> : null}
      {shown.map((model) => (
        <Pressable key={model.id} accessibilityRole="button" accessibilityHint="Opens its settings" onPress={() => edit(model)} style={({ pressed }) => [styles.item, { borderColor: palette.border, opacity: model.isActive ? 1 : 0.6, backgroundColor: pressed ? palette.surface : 'transparent' }]}>
          <ModelAvatar modelId={model.id} size={34} rounded={9} />
          <View style={styles.text}>
            <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
              {model.name}
            </Text>
            <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
              {[model.id, model.preset ? 'workspace' : model.available ? model.ownedBy : 'not offered now', model.hidden ? 'hidden' : '', defaults.includes(model.id) ? 'new chats' : '', pinned.includes(model.id) ? 'pinned' : '', model.hasRow && !model.preset ? (model.accessGrants.some((grant) => grant.principal_id === '*') ? 'everyone' : model.accessGrants.length ? 'shared' : 'not shared') : ''].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Switch accessibilityLabel={`${model.name} on`} value={model.isActive} onValueChange={(on) => run(on ? `${model.name} is on` : `${model.name} is off for everyone`, () => setAdminModelActive(client, model, on))} />
          <MenuButton label={`Options for ${model.name}`} size={18} color={palette.textMuted} items={menuFor(model)} />
        </Pressable>
      ))}
      <AccessSheet target={sharing} onClose={() => setSharing(null)} onSaved={refresh} />
      <ModelEditor target={editor} onClose={() => setEditor(null)} onSaved={refresh} />
      <CodeVersionsSheet target={versions} onClose={() => setVersions(null)} onChanged={refresh} />
      <ModelDefaultsSheet visible={sheet === 'defaults'} onClose={() => setSheet(null)} />
      <ModelOrderSheet visible={sheet === 'order'} models={all} onClose={() => setSheet(null)} onSaved={refresh} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 10 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  search: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  views: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  meta: { fontFamily: fonts.regular, fontSize: 11 },
});
