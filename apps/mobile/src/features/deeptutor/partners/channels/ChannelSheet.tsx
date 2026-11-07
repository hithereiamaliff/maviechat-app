import {
  applyChannelOnboarding,
  cancelChannelOnboarding,
  checkChannelOnboarding,
  checkWeixinLogin,
  startChannelOnboarding,
  startWeixinLogin,
  withSetting,
  type DtChannelSchema,
  type DtChannelState,
  type DtOnboarding,
  type DtWeixinLogin,
} from '@maviechat/deeptutor-protocol';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SvgXml } from 'react-native-svg';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { SettingField } from './SettingField';

type Tree = Record<string, unknown>;

const STATUS_WORDS: Record<string, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  starting: 'Starting…',
  running: 'Running',
  waiting_for_scan: 'Waiting for a scan',
  action_required: 'Needs you',
  unavailable: 'Unavailable',
  error: 'Something’s wrong',
  disconnected: 'Disconnected',
};

/** How one app is doing, in a few words, for the list and the sheet. */
export function channelStateWords(config: Tree | null | undefined, state: DtChannelState | undefined, running: boolean): string {
  if (!config) return 'Not set up';
  if (config.enabled !== true) return 'Off';
  if (!running) return 'Not running: the partner is stopped';
  if (state?.status) return STATUS_WORDS[state.status] ?? state.status.replace(/_/g, ' ');
  return state?.running ? 'Running' : 'Not running';
}

/**
 * One chat app's settings for a partner, drawn from DeepTutor's schema, with its status while it
 * runs. Feishu and WeCom also connect by a scan (or their link, on this phone); WeChat by a code
 * scanned with WeChat on another device. Save sends every app's settings at once.
 */
export function ChannelSheet({
  partnerId,
  schema,
  saved,
  state,
  running,
  onSave,
  onRemove,
  onConnected,
  onClose,
}: {
  partnerId: string;
  schema: DtChannelSchema | null;
  /** Its settings as saved (secrets included), or null when it has none. */
  saved: Tree | null;
  state: DtChannelState | undefined;
  running: boolean;
  onSave: (config: Tree) => Promise<string[] | null>;
  onRemove: () => Promise<void>;
  /** A scan saved the settings itself: read them again. */
  onConnected: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={schema !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {schema ? <Sheet partnerId={partnerId} schema={schema} saved={saved} state={state} running={running} onSave={onSave} onRemove={onRemove} onConnected={onConnected} onClose={onClose} /> : null}
    </Modal>
  );
}

function Sheet({ partnerId, schema, saved, state, running, onSave, onRemove, onConnected, onClose }: { partnerId: string; schema: DtChannelSchema; saved: Tree | null; state: DtChannelState | undefined; running: boolean; onSave: (config: Tree) => Promise<string[] | null>; onRemove: () => Promise<void>; onConnected: () => void; onClose: () => void }) {
  const palette = usePalette();
  const base = saved ?? schema.defaultConfig;
  // Your changes, if any; until then it shows what's saved, so a scan that saves settings shows at once.
  const [draft, setDraft] = useState<Tree | null>(null);
  const [generation, setGeneration] = useState(0);
  const config = draft ?? base;
  const dirty = draft !== null;
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const change = (path: string, value: unknown) => setDraft((current) => withSetting(current ?? base, path, value));
  const connected = () => {
    // A scan saved its own settings: drop any half-made changes and show them.
    setDraft(null);
    setProblems([]);
    setGeneration((value) => value + 1);
    onConnected();
  };
  const asksWho = schema.fields.some((field) => field.key === 'allow_from');
  const save = async () => {
    setBusy(true);
    const refused = await onSave(config);
    setBusy(false);
    if (refused) setProblems(refused);
    else {
      setDraft(null);
      setProblems([]);
      onClose();
    }
  };
  const remove = () =>
    Alert.alert(`Remove ${schema.displayName}?`, 'Its settings are deleted and it stops listening there.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void onRemove().then(
            () => onClose(),
            () => setBusy(false),
          );
        },
      },
    ]);

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>{dirty ? 'Cancel' : 'Done'}</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
          {schema.displayName}
        </Text>
        {busy ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : (
          <Pressable accessibilityRole="button" disabled={!dirty} onPress={() => void save()} hitSlop={10}>
            <Text style={[styles.action, styles.strong, { color: dirty ? palette.link : palette.textFaint }]}>Save</Text>
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {schema.description ? <Text style={[styles.note, { color: palette.textMuted }]}>{schema.description}</Text> : null}
        {state?.enabled ? (
          <View style={[styles.status, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Text style={[styles.statusText, { color: palette.text }]}>{channelStateWords(saved ?? { enabled: true }, state, running)}</Text>
            {state.message ? <Text style={[styles.note, { color: palette.textMuted }]}>{state.message}</Text> : null}
            {state.qrImage ? <Image source={{ uri: state.qrImage }} style={styles.qr} contentFit="contain" accessibilityLabel="A code to scan" /> : null}
          </View>
        ) : null}
        {schema.name === 'feishu' || schema.name === 'wecom' ? <ScanToConnect partnerId={partnerId} channel={schema.name} name={schema.displayName} onConnected={connected} /> : null}
        {schema.name === 'weixin' ? <WeixinConnect partnerId={partnerId} onConnected={connected} /> : null}
        {problems.length ? (
          <View style={[styles.problems, { borderColor: palette.danger }]}>
            {problems.map((problem) => (
              <Text key={problem} style={[styles.note, { color: palette.danger }]}>
                {problem}
              </Text>
            ))}
          </View>
        ) : null}
        {asksWho && config.enabled === true && (!Array.isArray(config.allow_from) || !config.allow_from.length) ? (
          <Text style={[styles.note, { color: palette.warning }]}>It’s on, but nobody may talk to it yet: add who may (their IDs, or * for anyone).</Text>
        ) : null}
        {[...schema.fields].sort((a, b) => (a.key === 'enabled' ? -1 : b.key === 'enabled' ? 1 : 0)).map((field) => (
          <SettingField key={`${generation}:${field.path}`} field={field} config={config} onChange={change} />
        ))}
        {saved ? (
          <Pressable accessibilityRole="button" onPress={remove} style={styles.remove} hitSlop={6}>
            <Text style={[styles.removeText, { color: palette.danger }]}>{`Remove ${schema.displayName}`}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const ONBOARDING_WORDS: Record<string, string> = {
  pending_scan: 'Waiting for the scan…',
  ready: 'Scanned: connecting…',
  applied: 'Connected.',
  cancelled: 'Cancelled.',
  expired: 'The code expired.',
  denied: 'Not authorised.',
  failed: 'It didn’t connect.',
};

/** Feishu and WeCom: a code to scan, or on this phone the app's own authorization link. */
function ScanToConnect({ partnerId, channel, name, onConnected }: { partnerId: string; channel: 'feishu' | 'wecom'; name: string; onConnected: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const [onboarding, setOnboarding] = useState<DtOnboarding | null>(null);
  const [busy, setBusy] = useState(false);
  const applied = useRef(false);
  // The parent redraws as it polls; the timer here follows only the attempt itself.
  const latest = useRef({ onboarding, onConnected, toast, name });
  useEffect(() => {
    latest.current = { onboarding, onConnected, toast, name };
  });

  useEffect(() => {
    if (!onboarding || onboarding.status !== 'pending_scan') return;
    const timer = setTimeout(() => {
      checkChannelOnboarding(client, partnerId, onboarding.id).then(
        async (next) => {
          const { onConnected: connected, toast: say, name: app } = latest.current;
          if (next.status === 'ready' && !applied.current) {
            applied.current = true;
            try {
              await applyChannelOnboarding(client, partnerId, next.id);
              setOnboarding({ ...next, status: 'applied' });
              say(`${app} connected`);
              connected();
              return;
            } catch (error) {
              say(`Couldn’t save the connection: ${describeError(error)}`, 'error');
            }
          }
          setOnboarding(next);
        },
        () => setOnboarding({ ...onboarding, status: 'failed' }),
      );
    }, onboarding.pollSeconds * 1000);
    return () => clearTimeout(timer);
  }, [onboarding, client, partnerId]);
  // Leaving the sheet mid-way calls the attempt off.
  useEffect(
    () => () => {
      const current = latest.current.onboarding;
      if (current && current.status === 'pending_scan') void cancelChannelOnboarding(client, partnerId, current.id).catch(() => undefined);
    },
    [client, partnerId],
  );

  const start = async () => {
    setBusy(true);
    applied.current = false;
    try {
      setOnboarding(await startChannelOnboarding(client, partnerId, channel));
    } catch (error) {
      toast(`Couldn’t start: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.scan, { borderColor: palette.border }]}>
      <Text style={[styles.statusText, { color: palette.text }]}>{`Connect by scanning`}</Text>
      <Text style={[styles.note, { color: palette.textMuted }]}>
        {channel === 'wecom'
          ? `Scan with ${name}, or open its link on this phone. Then anyone who can reach the bot may talk to the partner, unless you set who may.`
          : `Scan with ${name}, or open its link on this phone. You’ll be the one allowed to talk to it; add others after.`}
      </Text>
      {onboarding && onboarding.status === 'pending_scan' ? (
        <>
          {onboarding.qrImage ? <Image source={{ uri: onboarding.qrImage }} style={styles.qr} contentFit="contain" accessibilityLabel={`A code to scan with ${name}`} /> : null}
          {onboarding.link ? <Button label={`Open in ${name}`} onPress={() => void Linking.openURL(onboarding.link)} /> : null}
        </>
      ) : null}
      {onboarding ? <Text style={[styles.note, { color: onboarding.status === 'failed' || onboarding.status === 'denied' ? palette.danger : palette.textMuted }]}>{ONBOARDING_WORDS[onboarding.status] ?? onboarding.status}</Text> : null}
      {!onboarding || ['cancelled', 'expired', 'denied', 'failed'].includes(onboarding.status) ? <Button label={onboarding ? 'Try Again' : 'Get a Code'} variant="secondary" loading={busy} onPress={() => void start()} /> : null}
    </View>
  );
}

const WEIXIN_WORDS: Record<string, string> = {
  waiting: 'Waiting for a scan…',
  scanned: 'Scanned: confirm in WeChat.',
  confirmed: 'Connected. WeChat’s token is saved.',
  expired: 'The code expired.',
};

/** Personal WeChat: a code to scan with WeChat on another device (it can't scan its own screen). */
function WeixinConnect({ partnerId, onConnected }: { partnerId: string; onConnected: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const [login, setLogin] = useState<DtWeixinLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef({ onConnected, toast });
  useEffect(() => {
    latest.current = { onConnected, toast };
  });

  useEffect(() => {
    if (!login || (login.status !== 'waiting' && login.status !== 'scanned')) return;
    const timer = setTimeout(() => {
      checkWeixinLogin(client, partnerId, login).then(
        (next) => {
          setLogin(next);
          if (next.status === 'confirmed') {
            latest.current.toast('WeChat connected');
            latest.current.onConnected();
          }
        },
        () => setLogin({ ...login, status: 'error', error: 'Lost track of the login.' }),
      );
    }, 2000);
    return () => clearTimeout(timer);
  }, [login, client, partnerId]);

  const start = async () => {
    setBusy(true);
    try {
      setLogin(await startWeixinLogin(client, partnerId));
    } catch (error) {
      toast(`Couldn’t get a code: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.scan, { borderColor: palette.border }]}>
      <Text style={[styles.statusText, { color: palette.text }]}>Connect WeChat</Text>
      <Text style={[styles.note, { color: palette.textMuted }]}>Scan the code with WeChat on another device and confirm there. Anyone may then talk to it, unless you set who may.</Text>
      {login && (login.status === 'waiting' || login.status === 'scanned') ? (
        login.svg ? (
          <View style={styles.svg}>
            <SvgXml xml={login.svg} width={200} height={200} />
          </View>
        ) : (
          <Text selectable style={[styles.payload, { color: palette.text }]}>
            {login.payload}
          </Text>
        )
      ) : null}
      {login ? <Text style={[styles.note, { color: login.status === 'error' ? palette.danger : palette.textMuted }]}>{login.status === 'error' ? login.error || 'Something went wrong.' : (WEIXIN_WORDS[login.status] ?? login.status)}</Text> : null}
      {!login || login.status === 'expired' || login.status === 'error' ? <Button label={login ? 'New Code' : 'Get a Code'} variant="secondary" loading={busy} onPress={() => void start()} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  status: { gap: 6, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  statusText: { fontFamily: fonts.semibold, fontSize: 15 },
  qr: { width: 200, height: 200, alignSelf: 'center', backgroundColor: '#FFFFFF' },
  svg: { alignSelf: 'center', padding: 8, backgroundColor: '#FFFFFF', borderRadius: radius.md },
  payload: { fontFamily: fonts.mono, fontSize: 12 },
  scan: { gap: 8, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  problems: { gap: 4, padding: 10, borderWidth: 1, borderRadius: radius.md },
  remove: { alignSelf: 'center', marginTop: 12, padding: 8 },
  removeText: { fontFamily: fonts.medium, fontSize: 15 },
});
