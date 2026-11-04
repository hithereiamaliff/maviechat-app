import {
  describeSettingChange,
  getAdminConfig,
  getBanners,
  saveAdminConfig,
  saveBanners,
  sameBanners,
  settingChanges,
  settingConflicts,
  settingProblems,
  settingsPayload,
  storedValue,
  uuidv4,
  type Banner,
  type BannerType,
  type SettingEdits,
  type SettingOption,
  type OwuiClient,
  type SettingSection,
} from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useAdminGroups } from '@/features/admin/queries';
import { Note, SectionTitle } from '@/features/settings/rows';
import { Chip } from '@/features/workspace/ListControls';
import { describeError } from '@/lib/errors';
import { useAuthed, useModels } from '@/lib/server';
import { useSession } from '@/session/SessionProvider';
import { fonts, radius, usePalette } from '@/theme';
import { SettingsForm } from './SettingsForm';

/** After an admin setting changes: the admin screens, the server's public settings and your own session. */
export function useSettingsRefresh(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
    void queryClient.invalidateQueries({ queryKey: ['config'] });
    void queryClient.invalidateQueries({ queryKey: ['session-user'] });
  };
}

/** Asks, naming each change (secrets only as "changed") and anything that needs a second thought. */
export function reviewChanges(title: string, lines: string[], warnings: string[], save: () => void): void {
  Alert.alert(title, [...lines, ...(warnings.length ? ['', ...warnings] : [])].join('\n'), [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Save', style: warnings.length ? 'destructive' : 'default', onPress: save },
  ]);
}

/** A page of the admin config (General and Authentication share it). */
export function AdminConfigPage({ sections, children }: { sections: SettingSection[]; children?: ReactNode }) {
  return (
    <SettingsEndpointPage name="config" read={getAdminConfig} save={saveAdminConfig} sections={sections}>
      {children}
    </SettingsEndpointPage>
  );
}

type Tree = Record<string, unknown>;

/**
 * A settings page backed by one endpoint: the admin's edits, a bar that says how many and saves
 * them after listing them. The save is laid over a fresh read; if something the admin changed
 * was changed elsewhere meanwhile, it asks first.
 */
export function SettingsEndpointPage({ name, read: readConfig, save: saveConfig, sections, children }: { name: string; read: (client: OwuiClient) => Promise<Tree>; save: (client: OwuiClient, config: Tree) => Promise<unknown>; sections: SettingSection[]; children?: ReactNode }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const { expireSession } = useSession();
  const refresh = useSettingsRefresh();
  const config = useQuery({ queryKey: ['admin', 'endpoint', name], queryFn: () => readConfig(client), staleTime: 0 });
  const groups = useAdminGroups();
  const models = useModels();
  const [edits, setEdits] = useState<SettingEdits>({});
  const [busy, setBusy] = useState(false);
  const fields = sections.flatMap((section) => section.fields);
  const read = config.data ?? {};
  const changes = config.data ? settingChanges(fields, read, edits) : [];
  const problems = config.data ? settingProblems(fields, read, edits) : [];
  const options: Record<string, SettingOption[]> = {
    groups: [{ value: '', label: 'No group' }, ...(groups.data ?? []).map((group) => ({ value: group.id, label: group.name }))],
    models: [{ value: '', label: 'The chat’s own model' }, ...(models.data ?? []).map((model) => ({ value: model.id, label: model.name ?? model.id }))],
  };

  const save = async () => {
    setBusy(true);
    try {
      const fresh = await readConfig(client);
      const send = async () => {
        const answer = await saveConfig(client, settingsPayload(fields, fresh, read, edits));
        setEdits({});
        // A two-step sign-in change signs everyone out (0.12): this session is gone too.
        if ((answer as Tree | undefined)?.sessions_revoked === true) {
          await expireSession('Two-step sign-in changed, so everyone was signed out. Sign in again.');
          return;
        }
        refresh();
        toast('Saved for this server');
      };
      const clashes = settingConflicts(fields, read, fresh, edits);
      if (clashes.length) {
        const names = clashes.map((key) => fields.find((field) => field.key === key)?.label ?? key).join(', ');
        Alert.alert('Changed elsewhere meanwhile', `${names} changed on the server since this page opened. Save yours over it?`, [
          { text: 'Cancel', style: 'cancel', onPress: () => void config.refetch() },
          { text: 'Save Mine', style: 'destructive', onPress: () => void send().catch((error: unknown) => toast(`Couldn’t save: ${describeError(error)}`, 'error')) },
        ]);
        return;
      }
      await send();
    } catch (error) {
      toast(`Couldn’t save: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const review = () => {
    if (problems.length) return Alert.alert('Not saved yet', problems.join('\n'));
    const lines = changes.flatMap((key) => {
      const field = fields.find((item) => item.key === key);
      return field ? [describeSettingChange(field, read[key], storedValue(field, edits[key] as string | boolean, read[key]), field.optionsFrom ? options[field.optionsFrom] : field.options)] : [];
    });
    const warnings = changes.flatMap((key) => {
      const field = fields.find((item) => item.key === key);
      const warning = field?.confirm?.(storedValue(field, edits[key] as string | boolean, read[key]));
      return warning ? [warning] : [];
    });
    reviewChanges(`Save ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}?`, lines, warnings, () => void save());
  };

  if (config.isLoading) return <ActivityIndicator color={palette.textMuted} />;
  if (config.isError) return <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load the settings: ${describeError(config.error)}`}</Text>;
  return (
    <View style={styles.page}>
      <View style={[styles.bar, { borderColor: palette.border, backgroundColor: palette.surface }]}>
        <Text style={[styles.note, styles.flex, { color: changes.length ? palette.text : palette.textMuted }]}>{changes.length ? `${changes.length} not saved` : 'Nothing changed'}</Text>
        {changes.length ? (
          <Pressable accessibilityRole="button" onPress={() => setEdits({})} hitSlop={8}>
            <Text style={[styles.note, { color: palette.link }]}>Undo</Text>
          </Pressable>
        ) : null}
        <View>
          <Button label="Review" onPress={review} disabled={!changes.length} loading={busy} />
        </View>
      </View>
      <SettingsForm sections={sections} stored={read} edits={edits} onEdit={(key, value) => setEdits({ ...edits, [key]: value })} options={options} />
      {children}
    </View>
  );
}

const BANNER_TYPES: { key: BannerType; label: string }[] = [
  { key: 'info', label: 'Info' },
  { key: 'warning', label: 'Warning' },
  { key: 'error', label: 'Error' },
  { key: 'success', label: 'Success' },
];

/** Banners everyone sees at the top of their chats: add, change, take away; saved together. */
export function BannersEditor() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const refresh = useSettingsRefresh();
  const saved = useQuery({ queryKey: ['admin', 'banners'], queryFn: () => getBanners(client), staleTime: 0 });
  const [edited, setEdited] = useState<Banner[] | null>(null);
  const [busy, setBusy] = useState(false);
  const list = edited ?? saved.data ?? [];
  const changed = edited !== null && !sameBanners(edited, saved.data ?? []);
  const patch = (id: string, change: Partial<Banner>) => setEdited(list.map((banner) => (banner.id === id ? { ...banner, ...change } : banner)));
  const add = () => setEdited([...list, { id: uuidv4(), type: 'info', title: '', content: '', dismissible: true, timestamp: Math.floor(new Date().getTime() / 1000) }]);
  const save = () => {
    if (list.some((banner) => !banner.content.trim())) return Alert.alert('Not saved yet', 'Every banner needs some text.');
    reviewChanges('Save the banners?', [`${list.length} ${list.length === 1 ? 'banner' : 'banners'}, shown to everyone at the top of their chats.`], [], () => {
      void (async () => {
        setBusy(true);
        try {
          await saveBanners(client, list);
          setEdited(null);
          refresh();
          toast('Banners saved');
        } catch (error) {
          toast(`Couldn’t save: ${describeError(error)}`, 'error');
        } finally {
          setBusy(false);
        }
      })();
    });
  };
  return (
    <View style={styles.section}>
      <SectionTitle title="Banners" />
      {saved.isError ? <Note>{`Couldn’t load them: ${describeError(saved.error)}`}</Note> : null}
      {!list.length && saved.data ? <Note>None. Banners show at the top of everyone’s chats, until they close them (if they can).</Note> : null}
      {list.map((banner) => (
        <View key={banner.id} style={[styles.banner, { borderColor: palette.border }]}>
          <View style={styles.chips}>
            {BANNER_TYPES.map((type) => (
              <Chip key={type.key} label={type.label} on={banner.type === type.key} onPress={() => patch(banner.id, { type: type.key })} />
            ))}
            <Pressable accessibilityRole="button" accessibilityLabel="Take this banner away" onPress={() => setEdited(list.filter((item) => item.id !== banner.id))} hitSlop={8} style={styles.remove}>
              <Icon name="trash" size={16} color={palette.danger} />
            </Pressable>
          </View>
          <TextInput value={banner.title} onChangeText={(title) => patch(banner.id, { title })} placeholder="Title (optional)" placeholderTextColor={palette.textFaint} accessibilityLabel="Banner title" style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
          <TextInput value={banner.content} onChangeText={(content) => patch(banner.id, { content })} multiline placeholder="What it says (Markdown)" placeholderTextColor={palette.textFaint} accessibilityLabel="Banner text" style={[styles.input, styles.multiline, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
          <View style={styles.switchRow}>
            <Text style={[styles.note, styles.flex, { color: palette.text }]}>People can close it</Text>
            <Switch accessibilityLabel="People can close it" value={banner.dismissible} onValueChange={(dismissible) => patch(banner.id, { dismissible })} />
          </View>
        </View>
      ))}
      <View style={styles.actions}>
        <Button label="Add Banner" variant="secondary" onPress={add} />
        {changed ? <Button label="Save Banners" onPress={save} loading={busy} /> : null}
        {edited !== null ? (
          <Pressable accessibilityRole="button" onPress={() => setEdited(null)} hitSlop={8}>
            <Text style={[styles.note, { color: palette.link }]}>Undo</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 10 },
  section: { gap: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  flex: { flex: 1 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  banner: { gap: 8, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  remove: { marginLeft: 'auto' },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
});
