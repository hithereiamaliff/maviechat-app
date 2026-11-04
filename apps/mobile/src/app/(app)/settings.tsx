import { ScrollView } from 'react-native';
import { useState } from 'react';
import { useCapabilities } from '@/lib/server';
import { AboutSettings } from '@/features/settings/AboutSettings';
import { AccountSettings } from '@/features/settings/AccountSettings';
import { ArchivedChats } from '@/features/settings/ArchivedChats';
import { OwuiAudioSettings } from '@/features/settings/AudioSettings';
import { DataControls } from '@/features/settings/DataControls';
import { GeneralSettings } from '@/features/settings/GeneralSettings';
import { InterfaceSettings } from '@/features/settings/InterfaceSettings';
import { NotificationSettings } from '@/features/settings/NotificationSettings';
import { PersonalizationSettings } from '@/features/settings/PersonalizationSettings';
import { PromptAndParams } from '@/features/settings/PromptAndParams';
import { rowStyles } from '@/features/settings/rows';
import { SettingsFrame, type SettingsTab } from '@/features/settings/SettingsFrame';

type Tab = 'general' | 'interface' | 'notifications' | 'personalization' | 'audio' | 'data' | 'archived' | 'account' | 'about';

/** The web's settings modal in its phone layout: a strip of tabs on top, in the web's order. */
export default function SettingsScreen() {
  const capabilities = useCapabilities();
  const [tab, setTab] = useState<Tab>('general');
  // As on the web, Interface is for admins and accounts allowed to change their settings, and
  // Personalization for accounts with memories (the admin's switch, and the permission).
  const interfaceTab = capabilities ? capabilities.isAdmin || capabilities.can('settings.interface', true) : false;
  const memoriesTab = capabilities?.feature('memories', true) ?? false;
  const tabs: SettingsTab<Tab>[] = [
    { key: 'general', label: 'General', icon: 'cog-6-tooth' },
    ...(interfaceTab ? [{ key: 'interface' as const, label: 'Interface', icon: 'computer-desktop' as const }] : []),
    { key: 'notifications', label: 'Notifications', icon: 'bell' },
    ...(memoriesTab ? [{ key: 'personalization' as const, label: 'Personalization', icon: 'light-bulb' as const }] : []),
    { key: 'audio', label: 'Audio', icon: 'speaker-wave' },
    { key: 'data', label: 'Data Controls', icon: 'circle-stack' },
    { key: 'archived', label: 'Archived Chats', icon: 'archive-box' },
    { key: 'account', label: 'Account', icon: 'user-circle' },
    { key: 'about', label: 'About', icon: 'information-circle' },
  ];
  const shown = tabs.some((item) => item.key === tab) ? tab : 'general';
  return (
    <SettingsFrame tabs={tabs} tab={shown} onTab={setTab}>
      {shown === 'general' ? (
        <GeneralSettings note="" notifications={false}>
          <PromptAndParams />
        </GeneralSettings>
      ) : shown === 'interface' ? (
        <InterfaceSettings />
      ) : shown === 'notifications' ? (
        <ScrollView contentContainerStyle={rowStyles.content}>
          <NotificationSettings />
        </ScrollView>
      ) : shown === 'personalization' ? (
        <PersonalizationSettings />
      ) : shown === 'audio' ? (
        <OwuiAudioSettings />
      ) : shown === 'data' ? (
        <DataControls />
      ) : shown === 'archived' ? (
        <ArchivedChats />
      ) : shown === 'account' ? (
        <AccountSettings />
      ) : (
        <AboutSettings />
      )}
    </SettingsFrame>
  );
}
