import {
  chatBackgroundUrl,
  chatDirection,
  imageCompressionSize,
  INTERFACE_SETTINGS,
  interfaceChange,
  type ChatDirection,
  type InterfaceGroup,
  type InterfaceKey,
} from '@maviechat/owui-protocol';
import * as ImagePicker from 'expo-image-picker';
import { useState, type ReactNode } from 'react';
import { Alert, ScrollView } from 'react-native';
import { useToast } from '@/components/Toast';
import { selectionActions } from '@/features/chat/selectionActions';
import { setDevicePrefs, useDevicePrefs, type ToolCodeMode } from '@/lib/devicePrefs';
import { describeError } from '@/lib/errors';
import { useCapabilities, useUserSettings } from '@/lib/server';
import { useCanSaveSettings, useInterface, useSaveUiSettings } from '@/lib/uiSettings';
import { PhotoSizeSheet, photoSizeLabel } from './PhotoSizeSheet';
import { usePictureMaker } from './PictureMaker';
import { QuickActionsSheet } from './QuickActionsSheet';
import { ActionRow, Group, Note, rowStyles, SectionTitle, SwitchRow } from './rows';

const GROUPS: { group: InterfaceGroup; title: string }[] = [
  { group: 'UI', title: 'Interface' },
  { group: 'Chat', title: 'Chat' },
  { group: 'File', title: 'Files' },
];

const DIRECTIONS: Record<ChatDirection, string> = { auto: 'Automatic', LTR: 'Left to right', RTL: 'Right to left' };

/** A chat background is kept with your account as a picture in the settings: shrunk to this, as a folder's is. */
const BACKGROUND_SIDE = 1920;
const PHOTO: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9, base64: true, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };

/**
 * Open WebUI's Interface tab: the web's display and chat settings that the app follows, each
 * saved with your account the moment you change it (so the web and the app agree).
 */
export function InterfaceSettings() {
  const on = useInterface();
  const save = useSaveUiSettings();
  const canSave = useCanSaveSettings();
  const capabilities = useCapabilities();
  const settings = useUserSettings();
  const toast = useToast();
  const picture = usePictureMaker();
  const [editing, setEditing] = useState<'actions' | 'size' | null>(null);
  const [picking, setPicking] = useState(false);
  const ui = settings.data?.ui;
  // As on the web, "temporary by default" is for accounts that may start temporary chats.
  const temporary = capabilities ? capabilities.isAdmin || capabilities.can('chat.temporary') : false;
  const keys = Object.keys(INTERFACE_SETTINGS) as InterfaceKey[];
  const direction = chatDirection(ui);
  const background = chatBackgroundUrl(ui);
  const actions = selectionActions(ui);

  const chooseDirection = () =>
    Alert.alert('Chat direction', 'Which way text runs in chats. Automatic follows each paragraph’s language.', [
      ...(Object.keys(DIRECTIONS) as ChatDirection[]).map((value) => ({
        text: value === direction ? `${DIRECTIONS[value]} ✓` : DIRECTIONS[value],
        onPress: () => void save({ chatDirection: value }),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);

  const pickBackground = async () => {
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync(PHOTO);
      const asset = result.canceled ? undefined : result.assets[0];
      if (asset?.base64) await save({ backgroundImageUrl: await picture.maker.fit(`data:image/jpeg;base64,${asset.base64}`, BACKGROUND_SIDE, BACKGROUND_SIDE) });
    } catch (error) {
      toast(`Couldn’t use the photo: ${describeError(error)}`, 'error');
    } finally {
      setPicking(false);
    }
  };
  const changeBackground = () => {
    if (!background) return void pickBackground();
    Alert.alert('Chat background', undefined, [
      { text: 'Choose Another Photo', onPress: () => void pickBackground() },
      { text: 'Remove', style: 'destructive', onPress: () => void save({ backgroundImageUrl: null }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // Rows that aren't switches, after the switch they belong with (the web's order).
  const after: Partial<Record<InterfaceKey, ReactNode[]>> = {
    enableMessageQueue: [
      <ActionRow key="direction" label="Chat direction" value={DIRECTIONS[direction]} onPress={chooseDirection} disabled={!canSave} />,
      <ActionRow
        key="background"
        label="Chat background"
        hint="A photo behind your chats, faded so they stay readable. A folder’s own picture shows in its chats instead."
        value={picking ? 'Choosing…' : background ? 'Photo' : 'None'}
        onPress={changeBackground}
        disabled={!canSave || picking}
      />,
    ],
    showFloatingActionButtons: on('showFloatingActionButtons')
      ? [<ActionRow key="actions" label="Edit quick actions" value={actions.length ? actions.map((action) => action.label).join(', ') : 'None'} onPress={() => setEditing('actions')} disabled={!canSave} />]
      : [],
    imageCompression: on('imageCompression')
      ? [<ActionRow key="size" label="Largest size" value={photoSizeLabel(imageCompressionSize(ui)) ?? 'Not set'} onPress={() => setEditing('size')} disabled={!canSave} />]
      : [],
  };

  return (
    <ScrollView contentContainerStyle={rowStyles.content}>
      {GROUPS.map(({ group, title }) => {
        const shown = keys.filter((key) => {
          const setting: (typeof INTERFACE_SETTINGS)[InterfaceKey] = INTERFACE_SETTINGS[key];
          if (setting.group !== group) return false;
          if ('needsTemporary' in setting && !temporary) return false;
          return !('onlyWhenOff' in setting) || !on(setting.onlyWhenOff as InterfaceKey);
        });
        if (!shown.length) return null;
        return [
          <SectionTitle key={`${group}-title`} title={title} />,
          <Group key={group}>
            {shown.flatMap((key) => {
              const setting = INTERFACE_SETTINGS[key];
              return [
                <SwitchRow
                  key={key}
                  label={setting.label}
                  hint={'hint' in setting ? setting.hint : undefined}
                  value={on(key)}
                  disabled={!canSave}
                  onChange={(value) => void save(interfaceChange(key, value))}
                />,
                ...(after[key] ?? []),
              ];
            })}
          </Group>,
        ];
      })}
      <Note>
        {canSave
          ? 'Saved with your account, so the web app follows them too. The web’s other display settings are about the browser (text size, fonts, keyboard) or features the app doesn’t have yet.'
          : 'Your admin doesn’t let this account change its settings.'}
      </Note>
      <ToolCodeRow />
      {picture.element}
      <QuickActionsSheet visible={editing === 'actions'} onClose={() => setEditing(null)} />
      <PhotoSizeSheet visible={editing === 'size'} onClose={() => setEditing(null)} />
    </ScrollView>
  );
}

const TOOL_CODE: Record<ToolCodeMode, string> = { ask: 'Ask first', run: 'Run', never: 'Never' };

/**
 * Whether tools may run their JavaScript on this phone (as the web runs it in the browser): asked
 * about each time, run, or never. Kept on this phone only.
 */
function ToolCodeRow() {
  const { toolCode } = useDevicePrefs();
  const choose = () =>
    Alert.alert('Tools’ code on this phone', 'Some tools send JavaScript to run where you are, as the web runs it in the browser. Here it runs sealed off from MavieChat: it can’t see your sign-in or your chats, but it can reach the internet.', [
      ...(['ask', 'run', 'never'] as const).map((mode) => ({ text: TOOL_CODE[mode], onPress: () => setDevicePrefs({ toolCode: mode }) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  return (
    <>
      <SectionTitle title="This phone" />
      <Group>
        <ActionRow label="Tools’ code" hint="JavaScript a tool sends to run here, sealed off from the app." value={TOOL_CODE[toolCode]} onPress={choose} />
      </Group>
    </>
  );
}
