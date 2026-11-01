import { FEATURES, openSocketSession, type FeatureId, type SocketStatus } from '@maviechat/owui-protocol';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from '@/components/IconButton';
import { supportLabel, useAuthed, useCapabilities, useServerConfig, useServerVersion, useSessionUser } from '@/lib/server';
import { fonts, radius, usePalette, type Palette } from '@/theme';

const FEATURE_LABELS: Record<FeatureId, string> = {
  webSearch: 'Web search',
  imageGeneration: 'Image generation',
  codeInterpreter: 'Code interpreter',
  codeExecution: 'Run code blocks',
  folders: 'Folders',
  notes: 'Notes',
  channels: 'Channels',
  memories: 'Memory',
  apiKeys: 'API keys',
  automations: 'Automations',
  calendar: 'Calendar',
  userWebhooks: 'Notification webhooks',
  messageRating: 'Message rating',
};

type LiveState = { status: SocketStatus | 'idle'; detail?: string; joinedAs?: string };

/** Connection details: server, version support, live socket and the features this account can use. */
export default function Connection() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { session } = useAuthed();
  const config = useServerConfig();
  const version = useServerVersion();
  const user = useSessionUser();
  const capabilities = useCapabilities();

  const [live, setLive] = useState<LiveState>({ status: 'idle' });
  const websocketOnly = capabilities?.websocketOnly;
  const heartbeatIntervalSec = capabilities?.heartbeatIntervalSec;
  const { baseUrl, token } = session;
  const userId = session.user.id;

  useEffect(() => {
    if (websocketOnly === undefined) return;
    const socket = openSocketSession({
      baseUrl,
      token,
      expectedUserId: userId,
      websocketOnly,
      heartbeatIntervalSec,
      onStatus: (status, detail) => setLive((previous) => ({ ...previous, status, detail })),
    });
    socket.joined.then((joined) => setLive({ status: 'joined', joinedAs: joined.name })).catch(() => {});
    return () => socket.close();
  }, [baseUrl, token, userId, websocketOnly, heartbeatIntervalSec]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <Text style={[styles.headerTitle, { color: palette.text }]}>Connection</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: palette.text }]}>{config.data?.name ?? 'Open WebUI'}</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>{session.baseUrl}</Text>
        </View>

        <Section title="Connection" palette={palette}>
          <Row palette={palette} label="Signed in as" value={user.data ? `${user.data.name} · ${user.data.role}` : session.user.name} />
          <Row
            palette={palette}
            label="Server version"
            value={version.data ? `${version.data.version} (${supportLabel(capabilities?.support)})` : version.isError ? 'unavailable' : 'checking…'}
            tone={capabilities && capabilities.support !== 'supported' ? 'warning' : undefined}
          />
          <Row palette={palette} label="Live updates" value={liveLabel(live)} tone={live.status === 'joined' ? 'success' : live.detail ? 'warning' : undefined} />
        </Section>

        <Section title="Features on this server" palette={palette}>
          {(Object.keys(FEATURES) as FeatureId[]).map((id) => (
            <Row key={id} palette={palette} label={FEATURE_LABELS[id]} value={capabilities ? (capabilities.feature(id) ? 'On' : 'Off') : '…'} />
          ))}
        </Section>
      </ScrollView>
    </View>
  );
}

function liveLabel(live: LiveState): string {
  switch (live.status) {
    case 'joined':
      return live.joinedAs ? `connected as ${live.joinedAs}` : 'connected';
    case 'connecting':
      return live.detail ? `connecting… (${live.detail})` : 'connecting…';
    case 'reconnecting':
      return 'reconnecting…';
    case 'closed':
      return live.detail ?? 'closed';
    default:
      return 'waiting for server settings…';
  }
}

function Section({ title, palette, children }: { title: string; palette: Palette; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.textMuted }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>{children}</View>
    </View>
  );
}

function Row({ label, value, palette, tone }: { label: string; value: string; palette: Palette; tone?: 'success' | 'warning' }) {
  const valueColor = tone === 'success' ? palette.success : tone === 'warning' ? palette.warning : palette.text;
  return (
    <View style={[styles.row, { borderBottomColor: palette.border }]}>
      <Text style={[styles.rowLabel, { color: palette.textMuted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 6 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 16 },
  content: { paddingHorizontal: 20, gap: 24, paddingTop: 8 },
  titleBlock: { gap: 4 },
  title: { fontFamily: fonts.semibold, fontSize: 22 },
  subtitle: { fontFamily: fonts.regular, fontSize: 14 },
  section: { gap: 8 },
  sectionTitle: { fontFamily: fonts.medium, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontFamily: fonts.regular, fontSize: 15 },
  rowValue: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 15, textAlign: 'right' },
});
