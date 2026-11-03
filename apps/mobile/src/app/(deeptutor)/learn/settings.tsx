import { isValidatedVersion } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { hostOf } from '@/features/deeptutor/crossReference';
import { useDtServerVersion } from '@/features/deeptutor/queries';
import { DtAccountSettings } from '@/features/deeptutor/settings/DtAccountSettings';
import { DtArchivedChats } from '@/features/deeptutor/settings/DtArchivedChats';
import { DtGeneralSettings } from '@/features/deeptutor/settings/DtGeneralSettings';
import { AppAbout } from '@/features/settings/AboutSettings';
import { SettingsFrame, type SettingsTab } from '@/features/settings/SettingsFrame';
import { useDtAuthed } from '@/session/DeepTutorProvider';

type Tab = 'general' | 'account' | 'archived' | 'about';

const TABS: SettingsTab<Tab>[] = [
  { key: 'general', label: 'General', icon: 'cog-6-tooth' },
  { key: 'account', label: 'Account', icon: 'user-circle' },
  { key: 'archived', label: 'Archived Chats', icon: 'archive-box' },
  { key: 'about', label: 'About', icon: 'information-circle' },
];

/** DeepTutor's Settings, in the same modal as Open WebUI's: the app's own settings and DeepTutor's, your account, archived chats and About. */
export default function DeepTutorSettings() {
  const [tab, setTab] = useState<Tab>('general');
  return (
    <SettingsFrame tabs={TABS} tab={tab} onTab={setTab}>
      {tab === 'general' ? <DtGeneralSettings /> : tab === 'account' ? <DtAccountSettings /> : tab === 'archived' ? <DtArchivedChats /> : <DtAbout />}
    </SettingsFrame>
  );
}

function DtAbout() {
  const { session } = useDtAuthed();
  const version = useDtServerVersion();
  return (
    <AppAbout
      serverRows={[
        ['Server', hostOf(session.baseUrl)],
        ['DeepTutor', version.data ? `${version.data} (${isValidatedVersion(version.data) ? 'tested' : 'not yet tested'})` : version.isError ? 'unavailable' : 'checking…'],
      ]}
    />
  );
}
