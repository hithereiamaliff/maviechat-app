import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { useCapabilities } from '@/lib/server';
import { AdminSettings } from '@/features/admin/settings/AdminSettings';
import { AboutSettings } from '@/features/settings/AboutSettings';
import { AccountSettings } from '@/features/settings/AccountSettings';
import { ArchivedChats } from '@/features/settings/ArchivedChats';
import { OwuiAudioSettings } from '@/features/settings/AudioSettings';
import { DataControls } from '@/features/settings/DataControls';
import { GeneralSettings } from '@/features/settings/GeneralSettings';
import { InterfaceSettings } from '@/features/settings/InterfaceSettings';
import { NotificationSettings } from '@/features/settings/NotificationSettings';
import { NotificationTargets } from '@/features/settings/NotificationTargets';
import { PersonalizationSettings } from '@/features/settings/PersonalizationSettings';
import { PromptAndParams } from '@/features/settings/PromptAndParams';
import { rowStyles } from '@/features/settings/rows';
import { SettingsFrame, type SettingsTab } from '@/features/settings/SettingsFrame';

type Tab = 'general' | 'interface' | 'notifications' | 'personalization' | 'audio' | 'data' | 'archived' | 'account' | 'about' | 'admin';

/** The web's settings modal in its phone layout: a strip of tabs on top, in the web's order. */
export default function SettingsScreen() {
  const capabilities = useCapabilities();
  // `?tab=admin` opens the server's settings (the Admin Panel's Server Settings).
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'admin' ? 'admin' : 'general');
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
    ...(capabilities?.isAdmin ? [{ key: 'admin' as const, label: 'Admin', icon: 'wrench-screwdriver' as const }] : []),
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
        <ScrollView contentContainerStyle={rowStyles.content} keyboardShouldPersistTaps="handled">
          <NotificationSettings />
          {/* As on the web: where the admin lets people add webhooks, and your account may. */}
          {capabilities?.feature('userWebhooks') ? <NotificationTargets /> : null}
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
      ) : shown === 'admin' ? (
        <AdminSettings />
      ) : (
        <AboutSettings />
      )}
    </SettingsFrame>
  );
}
