import {
  APP_SCOPES,
  appScopeLabel,
  appSlugFrom,
  appSlugProblem,
  connectApp,
  forEveryone,
  getApp,
  installApp,
  manifestChanged,
  manifestProblem,
  previewAppManifest,
  uninstallApp,
  updateApp,
  withEveryone,
  type AppManifest,
  type ServerApp,
} from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { editorStyles, Field, SheetHeader } from '@/features/workspace/EditorParts';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

/** What the sheet opens on: a new app, or an installed one. */
export type AppSheetTarget = { kind: 'new' } | { kind: 'edit'; app: ServerApp };

const STATUS: Record<ServerApp['connection'], string> = { connected: 'Connected', connecting: 'Connecting', disconnected: 'Not connected' };
export const appState = (app: ServerApp) => (!app.configured ? 'Uninstalled' : app.active ? STATUS[app.connection] : 'Off');

/**
 * Adding an app, or changing one (the web's app settings). New: its address and key, then its
 * details read from there (or typed by hand), the access it asks for (each granted or not), a
 * short name and who may use it; installed and connected together. Installed: its name, access,
 * who may use it, a new key, its details read again; connect, or uninstall.
 */
export function AppSheet({ target, onClose, onChanged }: { target: AppSheetTarget | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target?.kind === 'new' ? <NewApp onClose={onClose} onChanged={onChanged} /> : target?.kind === 'edit' ? <Loaded id={target.app.id} onClose={onClose} onChanged={onChanged} /> : null}
    </Modal>
  );
}

/** An installed app, read with who may use it. */
function Loaded({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const app = useQuery({ queryKey: ['admin', 'apps', id], queryFn: () => getApp(client, id), staleTime: 0, gcTime: 0 });
  if (!app.data) {
    return (
      <View style={[editorStyles.sheet, editorStyles.center, { backgroundColor: palette.background }]}>
        {app.isError ? <Text style={[editorStyles.note, { color: palette.danger }]}>{`Couldn’t open it: ${describeError(app.error)}`}</Text> : <ActivityIndicator color={palette.textMuted} />}
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[editorStyles.action, { color: palette.link }]}>Close</Text>
        </Pressable>
      </View>
    );
  }
  return <Installed key={app.data.id} app={app.data} onClose={onClose} onChanged={onChanged} />;
}

const blankManifest = (): AppManifest => ({ id: '', name: '', description: '', picture: null, publicKey: '', requestedScopes: [] });

function NewApp({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [manifest, setManifest] = useState<AppManifest | null>(null);
  const [byHand, setByHand] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [everyone, setEveryone] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [installed, setInstalled] = useState<ServerApp | null>(null);
  const input = [editorStyles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];

  if (installed) return <Installed app={installed} onClose={onClose} onChanged={onChanged} />;

  const read = async () => {
    setBusy(true);
    setProblem('');
    try {
      const found = await previewAppManifest(client, { url, apiKey });
      setManifest(found);
      setByHand(false);
      setName(found.name);
      setSlug(appSlugFrom(found.id));
      setScopes(found.requestedScopes);
    } catch (error) {
      setProblem(`Couldn’t read its details: ${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const typed = manifest && byHand ? { ...manifest, id: manifest.id || slug, name } : manifest;
  const missing = !url.trim() ? 'Enter its address.' : !apiKey.trim() ? 'Enter its key.' : !typed ? 'Read its details, or enter them by hand.' : (byHand ? manifestProblem(typed) : null) ?? (!name.trim() ? 'Give it a name.' : appSlugProblem(slug));
  const install = async () => {
    if (!typed || missing) return;
    setBusy(true);
    setProblem('');
    let made: ServerApp | null = null;
    try {
      made = await installApp(client, { manifest: { ...typed, name }, url, apiKey, slug, grantedScopes: scopes.filter((scope) => typed.requestedScopes.includes(scope)), accessGrants: everyone ? withEveryone([], true) : [] });
      onChanged();
      await connectApp(client, made.id);
      onChanged();
      toast(`${name.trim()} is installed and connected`);
      onClose();
    } catch (error) {
      if (made) {
        // Installed, but not connected: what's next is the installed app's own sheet.
        Alert.alert('Installed, but not connected', `${describeError(error)}\n\nCheck its address and key, then Connect again.`);
        setInstalled(made);
      } else setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[editorStyles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title="New App" onCancel={onClose} onSave={() => void install()} canSave={!missing && !busy} busy={busy} />
      <ScrollView contentContainerStyle={editorStyles.content} keyboardShouldPersistTaps="handled">
        <Text style={[editorStyles.note, { color: palette.textMuted }]}>The server reaches the app at its address over HTTPS, with its key. Read its details from there, or enter them by hand.</Text>
        <Field label="Address">
          <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://" placeholderTextColor={palette.textFaint} accessibilityLabel="Address" style={input} />
        </Field>
        <Field label="Key" note="The key set up on the app’s side.">
          <View style={styles.inputRow}>
            <TextInput value={apiKey} onChangeText={setApiKey} autoCapitalize="none" autoCorrect={false} secureTextEntry={!showKey} accessibilityLabel="Key" style={[input, styles.flex]} />
            <Pressable accessibilityRole="button" accessibilityLabel={showKey ? 'Hide the key' : 'Show the key'} onPress={() => setShowKey(!showKey)} hitSlop={8}>
              <Icon name={showKey ? 'eye-slash' : 'eye'} size={18} color={palette.textMuted} />
            </Pressable>
          </View>
        </Field>
        <View style={styles.buttons}>
          <Button label={busy && !manifest ? 'Reading…' : 'Read Its Details'} variant="secondary" disabled={busy || !url.trim() || !apiKey.trim()} onPress={() => void read()} />
          {!byHand ? (
            <Button
              label="Enter Details by Hand"
              variant="secondary"
              onPress={() => {
                setByHand(true);
                setManifest(manifest ?? blankManifest());
              }}
            />
          ) : null}
        </View>
        {manifest && byHand ? <ManualDetails manifest={manifest} setManifest={setManifest} /> : null}
        {manifest && !byHand ? <ManifestSummary manifest={manifest} /> : null}
        {manifest ? (
          <>
            <Field label="Name">
              <TextInput value={name} onChangeText={setName} accessibilityLabel="Name" style={input} />
            </Field>
            <Field label="Short name" note={appSlugProblem(slug) ?? 'How it’s mentioned in channels. It can’t change later.'} problem={Boolean(slug && appSlugProblem(slug))}>
              <TextInput value={slug} onChangeText={setSlug} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Short name" style={input} />
            </Field>
            <Scopes requested={manifest.requestedScopes} granted={scopes} setGranted={setScopes} />
            <Toggle label="Everyone may use it" hint="Off: only admins." value={everyone} onChange={setEveryone} />
          </>
        ) : null}
        {problem ? <Text style={[editorStyles.note, { color: palette.danger }]}>{problem}</Text> : manifest && missing ? <Text style={[editorStyles.note, { color: palette.textMuted }]}>{missing}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Installed({ app, onClose, onChanged }: { app: ServerApp; onClose: () => void; onChanged: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const [name, setName] = useState(app.name);
  const [scopes, setScopes] = useState(app.grantedScopes);
  const [grants, setGrants] = useState(app.accessGrants ?? []);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [newer, setNewer] = useState<AppManifest | null>(null);
  const [busy, setBusy] = useState<'save' | 'check' | null>(null);
  const [problem, setProblem] = useState('');
  const requested = (newer ?? app.manifest).requestedScopes;
  const input = [editorStyles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];
  const ready = Boolean(name.trim()) && (app.configured || Boolean(apiKey.trim()));

  const check = async () => {
    setBusy('check');
    setProblem('');
    try {
      const found = await previewAppManifest(client, { url: app.url, appId: app.id, apiKey });
      if (!manifestChanged(found, app.manifest)) return toast('Its details haven’t changed');
      setNewer(found);
      setScopes(scopes.filter((scope) => found.requestedScopes.includes(scope)));
    } catch (error) {
      setProblem(`Couldn’t read its details: ${describeError(error)}`);
    } finally {
      setBusy(null);
    }
  };
  // As on the web: the changes are saved, then it's connected if it's off or has a new key.
  const save = async () => {
    setBusy('save');
    setProblem('');
    try {
      const saved = await updateApp(client, app.id, { name, grantedScopes: scopes.filter((scope) => requested.includes(scope)), accessGrants: grants, ...(newer ? { manifest: newer } : {}) });
      onChanged();
      if (!saved.active || apiKey.trim()) await connectApp(client, app.id, apiKey);
      onChanged();
      toast(`${name.trim()} saved and connected`);
      onClose();
    } catch (error) {
      setProblem(`${describeError(error)}${app.configured ? '' : ' An uninstalled app needs its key again.'}`);
      onChanged();
    } finally {
      setBusy(null);
    }
  };
  const uninstall = () =>
    Alert.alert(`Uninstall ${app.name}?`, 'Its key and its places in channels go, and it’s switched off. Its messages stay, and it stays listed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Uninstall',
        style: 'destructive',
        onPress: () =>
          void uninstallApp(client, app.id).then(
            () => {
              onChanged();
              toast(`${app.name} uninstalled`);
              onClose();
            },
            (error: unknown) => setProblem(`Couldn’t uninstall it: ${describeError(error)}`),
          ),
      },
    ]);

  return (
    <KeyboardAvoidingView behavior="padding" style={[editorStyles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={app.name} onCancel={onClose} onSave={() => void save()} canSave={ready && busy === null} busy={busy === 'save'} />
      <ScrollView contentContainerStyle={editorStyles.content} keyboardShouldPersistTaps="handled">
        <Text style={[editorStyles.note, { color: palette.textMuted }]}>{`${appState(app)} · @${app.slug} · ${app.url}`}</Text>
        <ManifestSummary manifest={newer ?? app.manifest} />
        {newer ? <Text style={[editorStyles.note, { color: palette.warning }]}>Newer details: look over what it asks for. Saving switches it off until it’s connected again.</Text> : null}
        <Field label="Name">
          <TextInput value={name} onChangeText={setName} accessibilityLabel="Name" style={input} />
        </Field>
        <Scopes requested={requested} granted={scopes} setGranted={setScopes} />
        <Toggle label="Everyone may use it" hint={grants.some((grant) => grant.principal_id !== '*') ? 'Others it’s shared with stay.' : 'Off: only admins.'} value={forEveryone(grants)} onChange={(on) => setGrants(withEveryone(grants, on))} />
        <Field label={app.configured ? 'New key' : 'Key'} note={app.configured ? 'Optional: only to change it. Saving connects it again with this one.' : 'An uninstalled app needs its key to connect again.'}>
          <View style={styles.inputRow}>
            <TextInput value={apiKey} onChangeText={setApiKey} autoCapitalize="none" autoCorrect={false} secureTextEntry={!showKey} accessibilityLabel={app.configured ? 'New key' : 'Key'} style={[input, styles.flex]} />
            <Pressable accessibilityRole="button" accessibilityLabel={showKey ? 'Hide the key' : 'Show the key'} onPress={() => setShowKey(!showKey)} hitSlop={8}>
              <Icon name={showKey ? 'eye-slash' : 'eye'} size={18} color={palette.textMuted} />
            </Pressable>
          </View>
        </Field>
        <Text style={[editorStyles.note, { color: palette.textMuted }]}>{app.active ? 'Saving keeps it connected (with a new key, it connects again).' : 'Saving connects it.'}</Text>
        <View style={styles.buttons}>
          <Button label={busy === 'check' ? 'Reading…' : 'Check for New Details'} variant="secondary" disabled={busy !== null || (!app.configured && !apiKey.trim())} onPress={() => void check()} />
          {app.configured ? <Button label="Uninstall…" variant="secondary" disabled={busy !== null} onPress={uninstall} /> : null}
        </View>
        {problem ? <Text style={[editorStyles.note, { color: palette.danger }]}>{problem}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** A manifest read from the app: its name, what it's for, its id and what it asks for. */
function ManifestSummary({ manifest }: { manifest: AppManifest }) {
  const palette = usePalette();
  return (
    <View style={[styles.summary, { borderColor: palette.border, backgroundColor: palette.surface }]}>
      <Text style={[styles.summaryName, { color: palette.text }]}>{manifest.name || manifest.id}</Text>
      {manifest.description ? <Text style={[editorStyles.note, { color: palette.textMuted }]}>{manifest.description}</Text> : null}
      <Text style={[editorStyles.note, { color: palette.textFaint }]}>{`Its id: ${manifest.id}`}</Text>
    </View>
  );
}

/** A manifest typed by hand: id, name, what it's for, its public key and what it asks for. */
function ManualDetails({ manifest, setManifest }: { manifest: AppManifest; setManifest: (manifest: AppManifest) => void }) {
  const palette = usePalette();
  const input = [editorStyles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];
  return (
    <>
      <Field label="Its id" note="As the app names itself.">
        <TextInput value={manifest.id} onChangeText={(id) => setManifest({ ...manifest, id })} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Its id" style={input} />
      </Field>
      <Field label="What it’s for">
        <TextInput value={manifest.description} onChangeText={(description) => setManifest({ ...manifest, description })} multiline accessibilityLabel="What it’s for" style={[input, styles.multiline]} />
      </Field>
      <Field label="Public key" note="The Ed25519 key it signs with, as PEM.">
        <TextInput value={manifest.publicKey} onChangeText={(publicKey) => setManifest({ ...manifest, publicKey })} multiline autoCapitalize="none" autoCorrect={false} placeholder="-----BEGIN PUBLIC KEY-----" placeholderTextColor={palette.textFaint} accessibilityLabel="Public key" style={[input, styles.multiline, styles.mono]} />
      </Field>
      <Text style={[styles.label, { color: palette.text }]}>What it asks for</Text>
      {APP_SCOPES.map((item) => (
        <Toggle
          key={item.scope}
          label={item.label}
          hint={item.scope}
          value={manifest.requestedScopes.includes(item.scope)}
          onChange={(on) => setManifest({ ...manifest, requestedScopes: on ? [...manifest.requestedScopes, item.scope] : manifest.requestedScopes.filter((scope) => scope !== item.scope) })}
        />
      ))}
    </>
  );
}

/** What the app asks for, each granted or not. */
function Scopes({ requested, granted, setGranted }: { requested: string[]; granted: string[]; setGranted: (scopes: string[]) => void }) {
  const palette = usePalette();
  return (
    <View style={styles.scopes}>
      <Text style={[styles.label, { color: palette.text }]}>What it may do</Text>
      {requested.length ? null : <Text style={[editorStyles.note, { color: palette.textFaint }]}>It asks for nothing.</Text>}
      {requested.map((scope) => (
        <Toggle key={scope} label={appScopeLabel(scope)} hint={scope} value={granted.includes(scope)} onChange={(on) => setGranted(on ? [...granted, scope] : granted.filter((item) => item !== scope))} />
      ))}
    </View>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (on: boolean) => void }) {
  const palette = usePalette();
  return (
    <View style={styles.toggle}>
      <View style={styles.flex}>
        <Text style={[styles.toggleLabel, { color: palette.text }]}>{label}</Text>
        {hint ? <Text style={[editorStyles.note, { color: palette.textFaint }]}>{hint}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summary: { gap: 4, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  summaryName: { fontFamily: fonts.semibold, fontSize: 15 },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  mono: { fontFamily: fonts.mono, fontSize: 12 },
  label: { fontFamily: fonts.medium, fontSize: 14 },
  scopes: { gap: 6 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  toggleLabel: { fontFamily: fonts.regular, fontSize: 14 },
});
