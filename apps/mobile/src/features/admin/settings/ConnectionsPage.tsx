import {
  connectionKindOn,
  connectionsOf,
  getConnectionConfig,
  getConnectionSwitches,
  headersFromText,
  idsFromText,
  sameConnection,
  saveConnectionConfig,
  saveConnectionSwitches,
  tagsFromText,
  verifyConnection,
  withConnectionAdded,
  withConnectionChange,
  withConnectionRemoved,
  withKindOn,
  type Connection,
  type ConnectionKind,
} from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { Group, Note, SectionTitle, SwitchRow } from '@/features/settings/rows';
import { editorStyles, Field, SheetHeader } from '@/features/workspace/EditorParts';
import { Chip } from '@/features/workspace/ListControls';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, usePalette } from '@/theme';
import { reviewChanges, useSettingsRefresh } from './AdminConfigPage';

const KIND_LABEL: Record<ConnectionKind, string> = { openai: 'OpenAI-compatible', ollama: 'Ollama' };
const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

/** Connections to the servers models come from: each kind on or off, each connection on or off, edited, added, taken out. */
export function ConnectionsPage() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const refreshSettings = useSettingsRefresh();
  const openai = useQuery({ queryKey: ['admin', 'connections', 'openai'], queryFn: () => getConnectionConfig(client, 'openai'), staleTime: 0 });
  const ollama = useQuery({ queryKey: ['admin', 'connections', 'ollama'], queryFn: () => getConnectionConfig(client, 'ollama'), staleTime: 0 });
  const switches = useQuery({ queryKey: ['admin', 'connection-switches'], queryFn: () => getConnectionSwitches(client), staleTime: 0 });
  const [editing, setEditing] = useState<{ kind: ConnectionKind; connection: Connection | null } | null>(null);
  const refresh = () => {
    refreshSettings();
    void queryClient.invalidateQueries({ queryKey: ['models'] });
  };
  // A switch reads the server first and changes only itself (a switch saved twice isn't the same as once).
  const flip = (what: string, run: () => Promise<unknown>) =>
    void run().then(
      () => {
        refresh();
        toast(what);
      },
      (error: unknown) => toast(`Couldn’t save: ${describeError(error)}`, 'error'),
    );
  const setKind = (kind: ConnectionKind, on: boolean) => {
    const go = () => flip(`${KIND_LABEL[kind]} connections ${on ? 'on' : 'off'}`, async () => saveConnectionConfig(client, kind, withKindOn(await getConnectionConfig(client, kind), kind, on)));
    if (on) go();
    else Alert.alert(`Switch off ${KIND_LABEL[kind]} connections?`, 'Every model from them leaves everyone’s model picker until they’re back on.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Switch Off', style: 'destructive', onPress: go }]);
  };
  const setOne = (kind: ConnectionKind, connection: Connection, on: boolean) =>
    flip(`${host(connection.url)} ${on ? 'on' : 'off'}`, async () => {
      const fresh = await getConnectionConfig(client, kind);
      if (!sameConnection(fresh, kind, connection.index, connection.url)) throw new Error('the connections changed meanwhile: pull down to reload');
      return saveConnectionConfig(client, kind, withConnectionChange(fresh, kind, connection.index, { settings: { enable: on } }));
    });
  const setSwitch = (key: 'direct' | 'cache', on: boolean) =>
    flip('Saved', async () => {
      const fresh = await getConnectionSwitches(client);
      return saveConnectionSwitches(client, { ...fresh, [key]: on });
    });

  const kindSection = (kind: ConnectionKind, query: typeof openai) => {
    const config = query.data;
    return (
      <View key={kind} style={styles.section}>
        <SectionTitle title={KIND_LABEL[kind]} />
        {query.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {query.isError ? <Note>{`Couldn’t load them: ${describeError(query.error)}`}</Note> : null}
        {config ? (
          <>
            <Group>
              <SwitchRow label={`${KIND_LABEL[kind]} connections`} value={connectionKindOn(config, kind)} onChange={(on) => setKind(kind, on)} />
              {connectionsOf(config, kind).map((connection) => (
                <Pressable key={`${connection.index}:${connection.url}`} accessibilityRole="button" onPress={() => setEditing({ kind, connection })} style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.surface }]}>
                  <View style={styles.flex}>
                    <Text style={[styles.label, { color: connection.enabled ? palette.text : palette.textMuted }]} numberOfLines={1}>
                      {host(connection.url)}
                    </Text>
                    <Text style={[styles.hint, { color: palette.textMuted }]} numberOfLines={1}>
                      {[typeof connection.config.prefix_id === 'string' && connection.config.prefix_id ? `prefix ${connection.config.prefix_id}` : '', Array.isArray(connection.config.model_ids) && connection.config.model_ids.length ? `${connection.config.model_ids.length} models listed` : '', typeof connection.config.provider === 'string' && connection.config.provider ? connection.config.provider : '', connection.config.connection_type === 'local' ? 'local' : '', connection.key ? 'key set' : 'no key'].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Switch accessibilityLabel={`${host(connection.url)} on`} value={connection.enabled} onValueChange={(on) => setOne(kind, connection, on)} />
                </Pressable>
              ))}
            </Group>
            <View style={styles.start}>
              <Button label="Add Connection" variant="secondary" onPress={() => setEditing({ kind, connection: null })} />
            </View>
          </>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.page}>
      <Note>Where models come from, for everyone. Keys stay hidden until you show them.</Note>
      {kindSection('openai', openai)}
      {kindSection('ollama', ollama)}
      <View style={styles.section}>
        <SectionTitle title="Other" />
        {switches.data ? (
          <Group>
            <SwitchRow label="People’s own connections" hint="Each person can add their own providers in their settings." value={switches.data.direct} onChange={(on) => setSwitch('direct', on)} />
            <SwitchRow label="Remember providers’ model lists" hint="Faster start; new models show after a refresh." value={switches.data.cache} onChange={(on) => setSwitch('cache', on)} />
          </Group>
        ) : null}
      </View>
      <ConnectionSheet target={editing} onClose={() => setEditing(null)} onSaved={refresh} />
    </View>
  );
}

/** The form's own view of a connection: every setting as text or a choice. */
interface Form {
  url: string;
  key: string;
  prefix: string;
  ids: string;
  tags: string;
  headers: string;
  provider: string;
  auth: string;
  api: string;
  version: string;
  type: string;
}

function formOf(connection: Connection | null): Form {
  const config = connection?.config ?? {};
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    url: connection?.url ?? '',
    key: connection?.key ?? '',
    prefix: text(config.prefix_id),
    ids: Array.isArray(config.model_ids) ? config.model_ids.filter((id): id is string => typeof id === 'string').join(', ') : '',
    tags: Array.isArray(config.tags) ? config.tags.map((tag) => (typeof tag === 'string' ? tag : text((tag as { name?: unknown }).name))).filter(Boolean).join(', ') : '',
    headers: config.headers && typeof config.headers === 'object' ? JSON.stringify(config.headers, null, 2) : '',
    provider: text(config.provider),
    auth: text(config.auth_type) || 'bearer',
    api: config.api_type === 'responses' ? 'responses' : 'chat',
    version: text(config.api_version),
    type: config.connection_type === 'local' ? 'local' : 'external',
  };
}

const LABELS: Record<keyof Form, string> = { url: 'Address', key: 'Key', prefix: 'Prefix', ids: 'Model ids', tags: 'Tags', headers: 'Headers', provider: 'Provider', auth: 'Sign-in', api: 'API', version: 'API version', type: 'Kind' };

/** The settings an edit changes (only the fields that differ; an emptied field is taken away). */
function settingsChange(before: Form, after: Form, kind: ConnectionKind): Record<string, unknown> {
  const change: Record<string, unknown> = {};
  if (after.prefix !== before.prefix) change.prefix_id = after.prefix.trim() || undefined;
  if (after.ids !== before.ids) change.model_ids = idsFromText(after.ids).length ? idsFromText(after.ids) : undefined;
  if (after.tags !== before.tags) change.tags = tagsFromText(after.tags).length ? tagsFromText(after.tags) : undefined;
  if (after.headers !== before.headers) change.headers = headersFromText(after.headers).headers ?? undefined;
  if (after.type !== before.type) change.connection_type = after.type;
  if (kind === 'openai') {
    if (after.provider !== before.provider) change.provider = after.provider || undefined;
    if (after.auth !== before.auth) change.auth_type = after.auth;
    if (after.api !== before.api) change.api_type = after.api === 'responses' ? 'responses' : undefined;
    if (after.version !== before.version) change.api_version = after.version.trim() || undefined;
  }
  return change;
}

function ConnectionSheet({ target, onClose, onSaved }: { target: { kind: ConnectionKind; connection: Connection | null } | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target ? <ConnectionForm kind={target.kind} connection={target.connection} onClose={onClose} onSaved={onSaved} /> : null}
    </Modal>
  );
}

function ConnectionForm({ kind, connection, onClose, onSaved }: { kind: ConnectionKind; connection: Connection | null; onClose: () => void; onSaved: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const [initial] = useState(() => formOf(connection));
  const [form, setForm] = useState(initial);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const set = (key: keyof Form) => (value: string) => setForm({ ...form, [key]: value });
  const headers = headersFromText(form.headers);
  const changed = (Object.keys(form) as (keyof Form)[]).filter((key) => form[key] !== initial[key]);
  const ready = /^https?:\/\/\S+$/.test(form.url.trim()) && !headers.problem && (connection === null || changed.length > 0);

  const save = () =>
    reviewChanges(connection ? `Save ${changed.length} ${changed.length === 1 ? 'change' : 'changes'}?` : `Add ${host(form.url)}?`, connection ? changed.map((key) => (key === 'key' ? 'Key: changed' : `${LABELS[key]}: changed`)) : ['A new connection, on, for everyone.'], [], () => {
      void (async () => {
        setBusy(true);
        try {
          const fresh = await getConnectionConfig(client, kind);
          let next;
          if (!connection) {
            const settings = { ...settingsChange(formOf(null), form, kind), auth_type: kind === 'openai' ? form.auth : undefined, connection_type: form.type };
            next = withConnectionAdded(fresh, kind, { url: form.url, key: form.key, settings });
          } else {
            if (!sameConnection(fresh, kind, connection.index, connection.url)) throw new Error('the connections changed meanwhile: close this and open it again');
            next = withConnectionChange(fresh, kind, connection.index, { ...(form.url !== initial.url ? { url: form.url } : {}), ...(form.key !== initial.key ? { key: form.key } : {}), settings: settingsChange(initial, form, kind) });
          }
          await saveConnectionConfig(client, kind, next);
          onSaved();
          toast(connection ? 'Connection saved' : 'Connection added');
          onClose();
        } catch (error) {
          toast(`Couldn’t save: ${describeError(error)}`, 'error');
        } finally {
          setBusy(false);
        }
      })();
    });
  const remove = () =>
    connection &&
    Alert.alert(`Take out ${host(connection.url)}?`, 'Its models leave everyone’s picker. Chats keep what they said.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Take Out',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            try {
              const fresh = await getConnectionConfig(client, kind);
              if (!sameConnection(fresh, kind, connection.index, connection.url)) throw new Error('the connections changed meanwhile: close this and open it again');
              await saveConnectionConfig(client, kind, withConnectionRemoved(fresh, kind, connection.index));
              onSaved();
              toast('Connection taken out');
              onClose();
            } catch (error) {
              toast(`Couldn’t take it out: ${describeError(error)}`, 'error');
            }
          })(),
      },
    ]);
  const check = async () => {
    setChecking(true);
    try {
      const count = await verifyConnection(client, kind, { url: form.url.trim(), key: form.key, config: connection?.config });
      toast(count === null ? 'It answered' : `It answered: ${count} ${count === 1 ? 'model' : 'models'}`);
    } catch (error) {
      toast(`It didn’t answer as expected: ${describeError(error)}`, 'error');
    } finally {
      setChecking(false);
    }
  };
  const input = [editorStyles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];
  const chips = (key: keyof Form, options: { value: string; label: string }[]) => (
    <View style={styles.chips}>
      {options.map((option) => (
        <Chip key={option.value || 'none'} label={option.label} on={form[key] === option.value} onPress={() => set(key)(option.value)} />
      ))}
    </View>
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={[editorStyles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={connection ? host(connection.url) : `New ${KIND_LABEL[kind]} Connection`} onCancel={onClose} onSave={save} canSave={ready} busy={busy} />
      <ScrollView contentContainerStyle={editorStyles.content} keyboardShouldPersistTaps="handled">
        <Field label="Address" note={kind === 'openai' ? 'Its API’s base, like https://api.example.com/v1' : 'Like http://localhost:11434'}>
          <TextInput value={form.url} onChangeText={set('url')} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="Address" style={input} />
        </Field>
        <Field label="Key">
          <View style={styles.inputRow}>
            <TextInput value={form.key} onChangeText={set('key')} autoCapitalize="none" autoCorrect={false} secureTextEntry={!revealed} accessibilityLabel="Key" style={[input, styles.flex]} />
            <Pressable accessibilityRole="button" accessibilityLabel={revealed ? 'Hide the key' : 'Show the key'} onPress={() => setRevealed(!revealed)} hitSlop={8}>
              <Icon name={revealed ? 'eye-slash' : 'eye'} size={18} color={palette.textMuted} />
            </Pressable>
          </View>
        </Field>
        <View style={styles.start}>
          <Button label={checking ? 'Checking…' : 'Check It Answers'} variant="secondary" onPress={() => void check()} disabled={checking || !form.url.trim()} />
        </View>
        {kind === 'openai' ? (
          <>
            <Field label="Provider">
              {chips('provider', [
                { value: '', label: 'Standard' },
                { value: 'azure', label: 'Azure' },
                { value: 'litellm', label: 'LiteLLM' },
                { value: 'llama.cpp', label: 'llama.cpp' },
                { value: 'lmstudio', label: 'LM Studio' },
              ])}
            </Field>
            {form.provider === 'azure' ? (
              <Field label="API version">
                <TextInput value={form.version} onChangeText={set('version')} autoCapitalize="none" autoCorrect={false} placeholder="2024-10-21" placeholderTextColor={palette.textFaint} accessibilityLabel="API version" style={input} />
              </Field>
            ) : null}
            <Field label="Sign-in">
              {chips('auth', [
                { value: 'bearer', label: 'Key' },
                { value: 'none', label: 'None' },
                { value: 'session', label: 'Their session' },
                { value: 'system_oauth', label: 'Their OAuth' },
              ])}
            </Field>
            <Field label="API">
              {chips('api', [
                { value: 'chat', label: 'Chat Completions' },
                { value: 'responses', label: 'Responses' },
              ])}
            </Field>
          </>
        ) : null}
        <Field label="Kind">
          {chips('type', [
            { value: 'external', label: 'External' },
            { value: 'local', label: 'Local' },
          ])}
        </Field>
        <Field label="Prefix" note="Put before its model ids, to tell them apart (existing chats keep the old ids).">
          <TextInput value={form.prefix} onChangeText={set('prefix')} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Prefix" style={input} />
        </Field>
        <Field label="Model ids" note={kind === 'openai' ? 'Only these, without asking the provider; empty: whatever it lists.' : 'Only these; empty: all of them.'}>
          <TextInput value={form.ids} onChangeText={set('ids')} multiline autoCapitalize="none" autoCorrect={false} accessibilityLabel="Model ids" style={[input, styles.multiline]} />
        </Field>
        <Field label="Tags" note="Separated by commas.">
          <TextInput value={form.tags} onChangeText={set('tags')} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Tags" style={input} />
        </Field>
        <Field label="Headers" note={headers.problem ?? 'Sent with every request, as a JSON object.'} problem={Boolean(headers.problem)}>
          <TextInput value={form.headers} onChangeText={set('headers')} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} placeholder={'{"X-Team": "a"}'} placeholderTextColor={palette.textFaint} accessibilityLabel="Headers" style={[input, styles.multiline, editorStyles.mono]} />
        </Field>
        {connection ? (
          <View style={styles.start}>
            <Button label="Take Out This Connection" variant="secondary" onPress={remove} />
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { gap: 10 },
  section: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 14, paddingVertical: 10 },
  flex: { flex: 1 },
  label: { fontFamily: fonts.regular, fontSize: 15 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  start: { alignSelf: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
});
