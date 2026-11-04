import { INTERFACE_SETTINGS, interfaceChange, type InterfaceGroup, type InterfaceKey } from '@maviechat/owui-protocol';
import { ScrollView } from 'react-native';
import { useCapabilities } from '@/lib/server';
import { useCanSaveSettings, useInterface, useSaveUiSettings } from '@/lib/uiSettings';
import { Group, Note, rowStyles, SectionTitle, SwitchRow } from './rows';

const GROUPS: { group: InterfaceGroup; title: string }[] = [
  { group: 'UI', title: 'Interface' },
  { group: 'Chat', title: 'Chat' },
  { group: 'File', title: 'Files' },
];

/**
 * Open WebUI's Interface tab: the web's display and chat settings that the app follows, each
 * saved with your account the moment you switch it (so the web and the app agree).
 */
export function InterfaceSettings() {
  const on = useInterface();
  const save = useSaveUiSettings();
  const canSave = useCanSaveSettings();
  const capabilities = useCapabilities();
  // As on the web, "temporary by default" is for accounts that may start temporary chats.
  const temporary = capabilities ? capabilities.isAdmin || capabilities.can('chat.temporary') : false;
  const keys = Object.keys(INTERFACE_SETTINGS) as InterfaceKey[];

  return (
    <ScrollView contentContainerStyle={rowStyles.content}>
      {GROUPS.map(({ group, title }) => {
        const shown = keys.filter((key) => {
          const setting = INTERFACE_SETTINGS[key];
          return setting.group === group && (!('needsTemporary' in setting) || temporary);
        });
        if (!shown.length) return null;
        return [
          <SectionTitle key={`${group}-title`} title={title} />,
          <Group key={group}>
            {shown.map((key) => {
              const setting = INTERFACE_SETTINGS[key];
              return (
                <SwitchRow
                  key={key}
                  label={setting.label}
                  hint={'hint' in setting ? setting.hint : undefined}
                  value={on(key)}
                  disabled={!canSave}
                  onChange={(value) => void save(interfaceChange(key, value))}
                />
              );
            })}
          </Group>,
        ];
      })}
      <Note>
        {canSave
          ? 'Saved with your account, so the web app follows them too. The web’s other display settings are about the browser (text size, fonts, keyboard) or features the app doesn’t have yet.'
          : 'Your admin doesn’t let this account change its settings.'}
      </Note>
    </ScrollView>
  );
}
