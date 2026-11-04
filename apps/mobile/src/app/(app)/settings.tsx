import { ScrollView } from 'react-native';
import { useState } from 'react';
import { useCapabilities } from '@/lib/server';
import { AboutSettings } from '@/features/settings/AboutSettings';
import { ArchivedChats } from '@/features/settings/ArchivedChats';
import { GeneralSettings } from '@/features/settings/GeneralSettings';
import { InterfaceSettings } from '@/features/settings/InterfaceSettings';
import { NotificationSettings } from '@/features/settings/NotificationSettings';
import { PromptAndParams } from '@/features/settings/PromptAndParams';
import { rowStyles } from '@/features/settings/rows';
import { SettingsFrame, type SettingsTab } from '@/features/settings/SettingsFrame';

type Tab = 'general' | 'interface' | 'notifications' | 'archived' | 'about';

/** The web's settings modal in its phone layout: a strip of tabs on top, in the web's order. */
export default function SettingsScreen() {
  const capabilities = useCapabilities();
  const [tab, setTab] = useState<Tab>('general');
  // As on the web, Interface is for admins and accounts allowed to change their settings.
  const interfaceTab = capabilities ? capabilities.isAdmin || capabilities.can('settings.interface', true) : false;
  const tabs: SettingsTab<Tab>[] = [
    { key: 'general', label: 'General', icon: 'cog-6-tooth' },
    ...(interfaceTab ? [{ key: 'interface' as const, label: 'Interface', icon: 'computer-desktop' as const }] : []),
    { key: 'notifications', label: 'Notifications', icon: 'bell' },
    { key: 'archived', label: 'Archived Chats', icon: 'archive-box' },
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
      ) : shown === 'archived' ? (
        <ArchivedChats />
      ) : (
        <AboutSettings />
      )}
    </SettingsFrame>
  );
}
