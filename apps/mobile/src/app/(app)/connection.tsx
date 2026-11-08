import { FEATURES, openSocketSession, type FeatureId, type SocketStatus } from '@maviechat/owui-protocol';
import { useEffect, useState } from 'react';
import { DetailRow, DetailScreen, DetailSection } from '@/features/settings/DetailScreen';
import { supportLabel, useAuthed, useCapabilities, useServerConfig, useServerVersion, useSessionUser } from '@/lib/server';

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
  adminChatAccess: 'Admins see users’ chats',
  plugins: 'Tools and functions',
  tools: 'Tools',
  functions: 'Functions',
};

type LiveState = { status: SocketStatus | 'idle'; detail?: string; joinedAs?: string };

/** Connection details: server, version support, live socket and the features this account can use. */
export default function Connection() {
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
    <DetailScreen title="Connection" heading={config.data?.name ?? 'Open WebUI'} subheading={session.baseUrl}>
      <DetailSection title="Connection">
        <DetailRow label="Signed in as" value={user.data ? `${user.data.name} · ${user.data.role}` : session.user.name} />
        <DetailRow
          label="Server version"
          value={version.data ? `${version.data.version} (${supportLabel(capabilities?.support)})` : version.isError ? 'unavailable' : 'checking…'}
          tone={capabilities && capabilities.support !== 'supported' ? 'warning' : undefined}
        />
        <DetailRow label="Live updates" value={liveLabel(live)} tone={live.status === 'joined' ? 'success' : live.detail ? 'warning' : undefined} />
      </DetailSection>

      <DetailSection title="Features on this server">
        {(Object.keys(FEATURES) as FeatureId[]).map((id) => (
          <DetailRow key={id} label={FEATURE_LABELS[id]} value={capabilities ? (capabilities.feature(id) ? 'On' : 'Off') : '…'} />
        ))}
      </DetailSection>
    </DetailScreen>
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
