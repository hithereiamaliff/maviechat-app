import { deleteAdminFunction, exportAdminFunctions, FUNCTION_TYPE_LABELS, getAdminFunction, listAdminFunctions, setFunctionActive, setFunctionGlobal, type AdminFunction } from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, FlatList, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { fileNameOf, shareFile, stampedName } from '@/features/settings/exportFile';
import { editorStyles, SheetHeader, SheetLoading } from '@/features/workspace/EditorParts';
import { Chip } from '@/features/workspace/ListControls';
import { SharedValvesSheet, type ValvesTarget } from '@/features/workspace/ToolSheets';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

const TYPES = ['all', 'pipe', 'filter', 'action', 'event'] as const;

const openOnWeb = (baseUrl: string, id: string | null) => void WebBrowser.openBrowserAsync(id ? `${baseUrl}/admin/functions/edit?id=${encodeURIComponent(id)}` : `${baseUrl}/admin/functions/create`);

/**
 * Admin → Functions: pipes (models of their own), filters, actions and event handlers. Switch one
 * on or off, apply a filter or action to every model, its shared settings, its code, export,
 * delete. New ones, edits and imports open the web's editor (saving runs the code on the server).
 */
export function FunctionsTab({ tabs }: { tabs: ReactNode }) {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useAuthed();
  const queryClient = useQueryClient();
  const functions = useQuery({ queryKey: ['admin', 'functions'], queryFn: () => listAdminFunctions(client), staleTime: 15_000 });
  const [query, setQuery] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]>('all');
  const [valves, setValves] = useState<ValvesTarget | null>(null);
  const [showing, setShowing] = useState<string | null>(null);
  const wanted = query.trim().toLowerCase();
  const items = [...(functions.data ?? [])]
    .filter((fn) => type === 'all' || fn.type === type)
    .filter((fn) => !wanted || `${fn.name} ${fn.id} ${fn.description}`.toLowerCase().includes(wanted))
    .sort((a, b) => a.name.localeCompare(b.name));
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'functions'] });
    void queryClient.invalidateQueries({ queryKey: ['models'] });
    void queryClient.invalidateQueries({ queryKey: ['functions'] });
  };
  const run = (done: string, work: () => Promise<unknown>) =>
    void work().then(
      () => {
        refresh();
        toast(done);
      },
      (error: unknown) => toast(describeError(error), 'error'),
    );
  const exportFunctions = async (only: AdminFunction | null) => {
    try {
      const all = await exportAdminFunctions(client);
      const chosen = only ? all.filter((row) => typeof row === 'object' && row !== null && (row as { id?: unknown }).id === only.id) : all;
      if (!chosen.length) return toast('There’s nothing to export.', 'error');
      await shareFile(only ? `${fileNameOf(only.name, 'function')}.json` : stampedName('functions'), JSON.stringify(chosen, null, 2));
    } catch (error) {
      toast(`Couldn’t export: ${describeError(error)}`, 'error');
    }
  };
  const remove = (fn: AdminFunction) =>
    Alert.alert(`Delete ${fn.name}?`, fn.type === 'pipe' ? 'Its models leave everyone’s picker. Chats keep what they said.' : 'Models that use it lose it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(`${fn.name} deleted`, () => deleteAdminFunction(client, fn.id)) },
    ]);
  const menuFor = (fn: AdminFunction): MenuItem[] => [
    { key: 'valves', label: 'Settings…', icon: 'cog-6-tooth', onPress: () => setValves({ kind: 'functions', id: fn.id, name: fn.name }) },
    ...(fn.type === 'filter' || fn.type === 'action'
      ? [{ key: 'global', label: fn.isGlobal ? 'Only Models That Choose It' : 'Apply to Every Model', icon: 'squares-2x2' as const, onPress: () => run(fn.isGlobal ? `${fn.name} applies only where chosen` : `${fn.name} applies to every model`, () => setFunctionGlobal(client, fn.id, !fn.isGlobal)) }]
      : []),
    { key: 'code', label: 'View Code', icon: 'code-bracket', onPress: () => setShowing(fn.id) },
    { key: 'edit', label: 'Edit on the Web', icon: 'globe-alt', onPress: () => openOnWeb(session.baseUrl, fn.id) },
    ...(fn.fundingUrl ? [{ key: 'fund', label: 'Support the Author', icon: 'link' as const, onPress: () => void WebBrowser.openBrowserAsync(fn.fundingUrl) }] : []),
    { key: 'export', label: 'Export', icon: 'arrow-down-tray', onPress: () => void exportFunctions(fn) },
    { key: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: () => remove(fn) },
  ];

  const header = (
    <View style={styles.top}>
      {tabs}
      <View style={styles.row}>
        <TextInput value={query} onChangeText={setQuery} placeholder="Search functions" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search functions" style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        <View>
          <Button label="New" onPress={() => openOnWeb(session.baseUrl, null)} />
        </View>
        <MenuButton
          label="Import and export"
          color={palette.textMuted}
          items={[
            { key: 'import', label: 'Import on the Web', icon: 'globe-alt', onPress: () => void WebBrowser.openBrowserAsync(`${session.baseUrl}/admin/functions`) },
            { key: 'export', label: 'Export All', icon: 'arrow-down-tray', onPress: () => void exportFunctions(null) },
          ]}
        />
      </View>
      <View style={styles.chips}>
        {TYPES.map((item) => (
          <Chip key={item} label={item === 'all' ? 'All' : (FUNCTION_TYPE_LABELS[item] ?? item)} on={type === item} onPress={() => setType(item)} />
        ))}
      </View>
      {functions.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {functions.isError ? <Text style={[styles.meta, { color: palette.danger }]}>{`Couldn’t load them: ${describeError(functions.error)}`}</Text> : null}
      {functions.data && !items.length ? <Text style={[styles.meta, styles.center, { color: palette.textMuted }]}>{wanted || type !== 'all' ? 'Nothing matches.' : 'No functions yet.'}</Text> : null}
    </View>
  );

  return (
    <View style={styles.flex}>
      <FlatList
        data={items}
        keyExtractor={(fn) => fn.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        refreshing={false}
        onRefresh={refresh}
        renderItem={({ item: fn }) => (
          <View style={[styles.item, { borderColor: palette.border, opacity: fn.isActive ? 1 : 0.6 }]}>
            <View style={styles.text}>
              <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                {fn.name}
              </Text>
              {fn.description ? (
                <Text style={[styles.detail, { color: palette.textMuted }]} numberOfLines={2}>
                  {fn.description}
                </Text>
              ) : null}
              <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
                {[FUNCTION_TYPE_LABELS[fn.type] ?? fn.type, fn.isGlobal ? 'every model' : '', fn.author ? `by ${fn.author}` : '', fn.version ? `v${fn.version}` : ''].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Switch accessibilityLabel={`${fn.name} on`} value={fn.isActive} onValueChange={(on) => run(on ? `${fn.name} is on` : `${fn.name} is off`, () => setFunctionActive(client, fn.id, on))} />
            <MenuButton label={`Options for ${fn.name}`} size={18} color={palette.textMuted} items={menuFor(fn)} />
          </View>
        )}
      />
      <SharedValvesSheet target={valves} onClose={() => setValves(null)} />
      <FunctionCode id={showing} onClose={() => setShowing(null)} />
    </View>
  );
}

/** A function's code, read-only, with the way to its editor on the web. */
function FunctionCode({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Modal visible={id !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {id ? <CodeView id={id} onClose={onClose} /> : null}
    </Modal>
  );
}

function CodeView({ id, onClose }: { id: string; onClose: () => void }) {
  const palette = usePalette();
  const { client, session } = useAuthed();
  const fn = useQuery({ queryKey: ['admin', 'function', id], queryFn: () => getAdminFunction(client, id), staleTime: 0 });
  if (!(fn.data && fn.isFetchedAfterMount)) return <SheetLoading error={fn.isError ? fn.error : null} onClose={onClose} />;
  return (
    <View style={[editorStyles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={fn.data.name} onCancel={onClose} onSave={onClose} canSave busy={false} readOnly />
      <ScrollView contentContainerStyle={editorStyles.content}>
        <Text selectable style={[editorStyles.mono, styles.code, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]}>
          {fn.data.content ?? ''}
        </Text>
        <Text style={[editorStyles.note, { color: palette.textMuted }]}>Saving a function runs its code on the server, so its code is changed on the web.</Text>
        <View style={styles.start}>
          <Button label="Edit on the Web" variant="secondary" onPress={() => openOnWeb(session.baseUrl, id)} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { gap: 10, paddingBottom: 6 },
  list: { padding: 16, gap: 8, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  search: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  detail: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  center: { textAlign: 'center' },
  code: { padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, lineHeight: 19, overflow: 'hidden' },
  start: { alignSelf: 'flex-start' },
});
