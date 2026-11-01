import {
  buildCapabilities,
  FEATURES,
  getConfig,
  getSessionUser,
  getVersion,
  openSocketSession,
  OwuiHttpError,
  type FeatureId,
  type OwuiClient,
  type SocketStatus,
  type SupportStatus,
} from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { EXPIRED_NOTICE, useSession } from '@/session/SessionProvider';
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

function needClient(client: OwuiClient | null): OwuiClient {
  if (!client) throw new Error('Not signed in');
  return client;
}

/** Milestone M0: proves sign-in, config, capabilities and the live socket against the real server. */
export default function Home() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { state, client, signOut } = useSession();
  const session = state.status === 'signed-in' ? state.session : null;
  const baseUrl = session?.baseUrl;
  const token = session?.token;
  const userId = session?.user.id;

  const version = useQuery({
    queryKey: ['version', baseUrl],
    queryFn: () => getVersion(needClient(client)),
    enabled: client !== null,
  });
  const config = useQuery({
    queryKey: ['config', baseUrl, userId],
    queryFn: () => getConfig(needClient(client)),
    enabled: client !== null,
  });
  const user = useQuery({
    queryKey: ['session-user', baseUrl, userId],
    queryFn: () => getSessionUser(needClient(client)),
    enabled: client !== null,
  });

  const capabilities = useMemo(
    () =>
      config.data && user.data
        ? buildCapabilities({ config: config.data, user: user.data, version: version.data?.version })
        : null,
    [config.data, user.data, version.data?.version],
  );

  const [live, setLive] = useState<LiveState>({ status: 'idle' });
  const websocketOnly = capabilities?.websocketOnly;
  const heartbeatIntervalSec = capabilities?.heartbeatIntervalSec;

  useEffect(() => {
    if (!baseUrl || !token || !userId || websocketOnly === undefined) return;
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

  const unauthorized = [config.error, user.error].some((error) => error instanceof OwuiHttpError && error.isUnauthorized);
  useEffect(() => {
    if (unauthorized) void signOut({ notice: EXPIRED_NOTICE });
  }, [unauthorized, signOut]);

  if (!session) return <Redirect href="/login" />;

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>{config.data?.name ?? 'Open WebUI'}</Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>{session.baseUrl}</Text>
      </View>

      <Section title="Connection" palette={palette}>
        <Row
          palette={palette}
          label="Signed in as"
          value={user.data ? `${user.data.name} · ${user.data.role}` : session.user.name}
        />
        <Row
          palette={palette}
          label="Server version"
          value={
            version.data
              ? `${version.data.version} (${supportLabel(capabilities?.support)})`
              : version.isError
                ? 'unavailable'
                : 'checking…'
          }
          tone={capabilities && capabilities.support !== 'supported' ? 'warning' : undefined}
        />
        <Row palette={palette} label="Live updates" value={liveLabel(live)} tone={liveTone(live)} />
      </Section>

      <Section title="Features on this server" palette={palette}>
        {(Object.keys(FEATURES) as FeatureId[]).map((id) => (
          <Row
            key={id}
            palette={palette}
            label={FEATURE_LABELS[id]}
            value={capabilities ? (capabilities.feature(id) ? 'On' : 'Off') : '…'}
          />
        ))}
      </Section>

      <Text style={[styles.note, { color: palette.textMuted }]}>
        This is MavieChat&apos;s connection check. The chat screens come next.
      </Text>
      <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
    </ScrollView>
  );
}

function supportLabel(status: SupportStatus | undefined): string {
  switch (status) {
    case 'supported':
      return 'tested';
    case 'newer-than-validated':
      return 'newer than MavieChat has been tested with';
    case 'too-old':
      return 'older than MavieChat supports';
    default:
      return 'checking…';
  }
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

function liveTone(live: LiveState): 'success' | 'warning' | undefined {
  if (live.status === 'joined') return 'success';
  if (live.detail) return 'warning';
  return undefined;
}

function Section({ title, palette, children }: { title: string; palette: Palette; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.textMuted }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>{children}</View>
    </View>
  );
}

function Row({
  label,
  value,
  palette,
  tone,
}: {
  label: string;
  value: string;
  palette: Palette;
  tone?: 'success' | 'warning';
}) {
  const valueColor = tone === 'success' ? palette.success : tone === 'warning' ? palette.warning : palette.text;
  return (
    <View style={[styles.row, { borderBottomColor: palette.border }]}>
      <Text style={[styles.rowLabel, { color: palette.textMuted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 24 },
  header: { gap: 4 },
  title: { fontFamily: fonts.semibold, fontSize: 24 },
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
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
});
