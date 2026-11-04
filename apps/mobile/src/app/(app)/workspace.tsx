import { deleteWorkspaceModel, getWorkspaceModel, setWorkspaceModelHidden, toggleWorkspaceModel, type WorkspaceModel, type WorkspaceView } from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { ModelAvatar } from '@/features/chat/ModelAvatar';
import { fileNameOf, shareFile } from '@/features/settings/exportFile';
import { ModelEditor, type ModelEditorTarget } from '@/features/workspace/ModelEditor';
import { useWorkspaceModels, useWorkspaceModelTags, useWorkspaceRefresh } from '@/features/workspace/queries';
import { describeError } from '@/lib/errors';
import { useDebounced } from '@/lib/useDebounced';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

type Area = 'models' | 'knowledge' | 'prompts' | 'skills' | 'tools';
const AREAS: { key: Area; label: string }[] = [
  { key: 'models', label: 'Models' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'prompts', label: 'Prompts' },
  { key: 'skills', label: 'Skills' },
  { key: 'tools', label: 'Tools' },
];
const VIEWS: { key: WorkspaceView; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'created', label: 'Yours' },
  { key: 'shared', label: 'Shared with you' },
];

/**
 * Open WebUI's Workspace: the areas this account may use (Models here; Knowledge, Prompts,
 * Skills and Tools on the web until their slices), and the workspace models: search, whose,
 * tag, order; each with what it builds on, whether it's off or hidden, and what you may do.
 */
export default function Workspace() {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useAuthed();
  const capabilities = useCapabilities();
  const refresh = useWorkspaceRefresh();
  const allowed = AREAS.filter((area) => (capabilities?.isAdmin || capabilities?.can(`workspace.${area.key}`)) && (area.key !== 'tools' || capabilities?.feature('plugins')));
  const [picked, setPicked] = useState<Area | null>(null);
  const area = picked ?? allowed[0]?.key ?? null;
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const [view, setView] = useState<WorkspaceView>('');
  const [tag, setTag] = useState('');
  const [byName, setByName] = useState(false);
  const [editor, setEditor] = useState<ModelEditorTarget | null>(null);
  const models = useWorkspaceModels({ query: debounced, view, tag, orderBy: byName ? 'name' : 'updated_at', direction: byName ? 'asc' : 'desc' });
  const tags = useWorkspaceModelTags();
  const items = models.data?.pages.flatMap((page) => page.items) ?? [];
  const total = models.data?.pages[0]?.total ?? 0;
  const canCreate = capabilities?.isAdmin || capabilities?.can('workspace.models');
  const canExport = capabilities?.isAdmin || capabilities?.can('workspace.models_export');

  const run = (work: () => Promise<unknown>, done: string) =>
    void work().then(
      () => {
        refresh();
        toast(done);
      },
      (error: unknown) => toast(describeError(error), 'error'),
    );
  const exportModel = async (model: WorkspaceModel) => {
    try {
      const full = await getWorkspaceModel(client, model.id);
      await shareFile(`${fileNameOf(full.name, 'model')}.json`, JSON.stringify([{ id: full.id, base_model_id: full.baseModelId, name: full.name, meta: full.meta, params: full.params, is_active: full.isActive }], null, 2));
    } catch (error) {
      toast(`Couldn’t export it: ${describeError(error)}`, 'error');
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
          { key: 'hide', label: model.hidden ? 'Show in Pickers' : 'Hide from Pickers', icon: model.hidden ? ('eye' as const) : ('eye-slash' as const), onPress: () => run(() => setWorkspaceModelHidden(client, model.id, !model.hidden), model.hidden ? 'Shown in everyone’s picker' : 'Hidden from everyone’s picker') },
          ...(canCreate ? [{ key: 'clone', label: 'Clone', icon: 'rectangle-stack' as const, onPress: () => setEditor({ kind: 'clone', id: model.id }) }] : []),
          ...(canExport ? [{ key: 'export', label: 'Export', icon: 'arrow-down' as const, onPress: () => void exportModel(model) }] : []),
          { key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => remove(model) },
        ]
      : [{ key: 'view', label: 'View', icon: 'eye' as const, onPress: () => setEditor({ kind: 'edit', id: model.id }) }]),
  ];

  const header = (
    <View style={styles.top}>
      <View style={styles.tabs}>
        {allowed.map((item) => {
          const on = item.key === area;
          return (
            <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setPicked(item.key)} style={[styles.tab, on && { borderBottomColor: palette.text }]}>
              <Text style={[styles.tabText, { color: on ? palette.text : palette.textMuted }]}>{item.key === 'models' && models.data ? `${item.label} ${total}` : item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {area === 'models' ? (
        <>
          <View style={styles.row}>
            <TextInput value={query} onChangeText={setQuery} placeholder="Search models" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search models" style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
            {canCreate ? (
              <View>
                <Button label="New" onPress={() => setEditor({ kind: 'new' })} />
              </View>
            ) : null}
          </View>
          <View style={styles.chips}>
            {VIEWS.map((item) => (
              <Chip key={item.key || 'all'} label={item.label} on={view === item.key} onPress={() => setView(item.key)} />
            ))}
            <Chip label={byName ? 'By name' : 'Latest'} on={false} onPress={() => setByName(!byName)} />
          </View>
          {tags.data?.length ? (
            <View style={styles.chips}>
              {tags.data.map((name) => (
                <Chip key={name} label={`#${name}`} on={tag === name} onPress={() => setTag(tag === name ? '' : name)} />
              ))}
            </View>
          ) : null}
          {models.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
          {models.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load the models: ${describeError(models.error)}`}</Text> : null}
          {models.data && !items.length ? <Text style={[styles.note, styles.center, { color: palette.textMuted }]}>{debounced || tag || view ? 'Nothing matches.' : 'No workspace models yet.'}</Text> : null}
        </>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ChatHeader title="Workspace" menu={[{ key: 'web', label: 'Open on the Web', icon: 'globe-alt', onPress: () => void WebBrowser.openBrowserAsync(`${session.baseUrl}/workspace${area ? `/${area}` : ''}`) }]} />
      {!allowed.length ? (
        <Text style={[styles.note, styles.center, styles.pad, { color: palette.textMuted }]}>Your account has no Workspace areas. An admin gives them.</Text>
      ) : area !== 'models' ? (
        <View style={styles.flex}>
          {header}
          <View style={styles.pad}>
            <Text style={[styles.note, { color: palette.textMuted }]}>{`${AREAS.find((item) => item.key === area)?.label} opens on the web for now.`}</Text>
            <Button label="Open on the Web" variant="secondary" onPress={() => void WebBrowser.openBrowserAsync(`${session.baseUrl}/workspace/${area}`)} />
          </View>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(model) => model.id}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          keyboardDismissMode="on-drag"
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (models.hasNextPage && !models.isFetchingNextPage) void models.fetchNextPage();
          }}
          refreshing={false}
          onRefresh={refresh}
          ListFooterComponent={models.isFetchingNextPage ? <ActivityIndicator color={palette.textMuted} /> : undefined}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityHint={item.writeAccess ? 'Opens its editor' : 'Shows it'}
              onPress={() => setEditor({ kind: 'edit', id: item.id })}
              style={({ pressed }) => [styles.item, { borderColor: palette.border, opacity: item.hidden ? 0.6 : 1 }, pressed && { backgroundColor: palette.surface }]}>
              <ModelAvatar modelId={item.id} size={38} rounded={10} />
              <View style={styles.text}>
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.detail, { color: palette.textMuted }]} numberOfLines={2}>
                  {item.description || (item.baseModelId ? `Built on ${item.baseModelId}` : item.id)}
                </Text>
                <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
                  {[item.isActive ? '' : 'Off', item.hidden ? 'Hidden' : '', item.writeAccess ? '' : 'Read-only', item.ownerName && view !== 'created' ? `by ${item.ownerName}` : ''].filter(Boolean).join(' · ') || item.id}
                </Text>
              </View>
              {item.writeAccess ? <Switch accessibilityLabel={`${item.name} on`} value={item.isActive} onValueChange={() => run(() => toggleWorkspaceModel(client, item.id), item.isActive ? `${item.name} is off for everyone` : `${item.name} is on`)} /> : null}
              <MenuButton label={`Options for ${item.name}`} size={18} color={palette.textMuted} items={menuFor(item)} />
            </Pressable>
          )}
        />
      )}
      <ModelEditor target={editor} onClose={() => setEditor(null)} />
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[styles.chip, { borderColor: palette.border }, on && { backgroundColor: palette.active, borderColor: palette.active }]}>
      <Text style={[styles.chipText, { color: on ? palette.onActive : palette.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  pad: { padding: 16, gap: 12 },
  top: { gap: 10, paddingBottom: 6 },
  tabs: { flexDirection: 'row', gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'transparent' },
  tab: { paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontFamily: fonts.medium, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  search: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 30, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  center: { textAlign: 'center' },
  list: { padding: 16, gap: 8, paddingBottom: 48 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  detail: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 11 },
});
