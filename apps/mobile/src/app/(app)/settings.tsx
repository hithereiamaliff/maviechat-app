import { useState } from 'react';
import { AboutSettings } from '@/features/settings/AboutSettings';
import { ArchivedChats } from '@/features/settings/ArchivedChats';
import { GeneralSettings } from '@/features/settings/GeneralSettings';
import { SettingsFrame, type SettingsTab } from '@/features/settings/SettingsFrame';

type Tab = 'general' | 'archived' | 'about';

const TABS: SettingsTab<Tab>[] = [
  { key: 'general', label: 'General', icon: 'cog-6-tooth' },
  { key: 'archived', label: 'Archived Chats', icon: 'archive-box' },
  { key: 'about', label: 'About', icon: 'information-circle' },
];

/** The web's settings modal in its phone layout: a strip of tabs on top. More tabs arrive in M2. */
export default function SettingsScreen() {
  const [tab, setTab] = useState<Tab>('general');
  return (
    <SettingsFrame tabs={TABS} tab={tab} onTab={setTab}>
      {tab === 'general' ? <GeneralSettings note="Language, system prompt and the other settings come in a later update." /> : tab === 'archived' ? <ArchivedChats /> : <AboutSettings />}
    </SettingsFrame>
  );
}
