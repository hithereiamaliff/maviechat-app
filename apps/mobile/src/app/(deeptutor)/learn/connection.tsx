import { isValidatedVersion, type DtConnectionState } from '@maviechat/deeptutor-protocol';
import { capabilityName } from '@/features/deeptutor/chat/capabilities';
import { useDtLive } from '@/features/deeptutor/chat/DtLiveProvider';
import { hostOf } from '@/features/deeptutor/crossReference';
import { useDtChatTools, useDtKnowledgeBases, useDtLlmOptions, useDtModes, useDtServerVersion } from '@/features/deeptutor/queries';
import { DetailRow, DetailScreen, DetailSection } from '@/features/settings/DetailScreen';
import { useDtAuthed } from '@/session/DeepTutorProvider';

const LIVE_LABELS: Record<DtConnectionState, string> = {
  idle: 'waiting',
  connecting: 'connecting…',
  open: 'connected',
  reconnecting: 'reconnecting…',
  'signed-out': 'signed out',
};

/** Connection details for DeepTutor, like Open WebUI's: server, version support, the live connection and what this account can use. */
export default function DeepTutorConnection() {
  const { session } = useDtAuthed();
  const live = useDtLive();
  const version = useDtServerVersion();
  const models = useDtLlmOptions();
  const modes = useDtModes();
  const tools = useDtChatTools();
  const knowledgeBases = useDtKnowledgeBases();
  const tested = isValidatedVersion(version.data);
  const count = (list: unknown[] | undefined, none: string) => (list ? (list.length ? String(list.length) : none) : '…');

  return (
    <DetailScreen title="Connection" heading="DeepTutor" subheading={session.baseUrl}>
      <DetailSection title="Connection">
        <DetailRow label="Signed in as" value={`${session.account.username} · ${session.account.isAdmin ? 'admin' : session.account.role}`} />
        <DetailRow
          label="Server version"
          value={version.data ? `${version.data} (${tested ? 'tested' : 'not yet tested with MavieChat'})` : version.isError ? 'unavailable' : 'checking…'}
          tone={version.data && !tested ? 'warning' : undefined}
        />
        <DetailRow label="Live updates" value={LIVE_LABELS[live.state]} tone={live.state === 'open' ? 'success' : live.state === 'signed-out' ? 'warning' : undefined} />
        <DetailRow label="Address" value={hostOf(session.baseUrl)} />
      </DetailSection>

      <DetailSection title="For this account">
        <DetailRow label="Models" value={count(models.data?.options, 'none granted')} />
        <DetailRow label="Modes" value={modes.data ? modes.data.map((mode) => capabilityName(mode.id)).join(', ') || 'none' : '…'} />
        <DetailRow label="Tools" value={count(tools.data, 'none')} />
        <DetailRow label="Knowledge bases" value={count(knowledgeBases.data, 'none')} />
      </DetailSection>
    </DetailScreen>
  );
}
