import {
  chatDirection,
  getAdminConfig,
  hasSettingAt,
  INTERFACE_SETTINGS,
  interfaceChange,
  interfaceDefaultsOf,
  interfaceOn,
  otherDefaultKeys,
  saveInterfaceDefaults,
  withoutEmpty,
  withUiChanges,
  type ChatDirection,
  type InterfaceGroup,
  type InterfaceKey,
} from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { ActionRow, Group, Note, SectionTitle } from '@/features/settings/rows';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, usePalette } from '@/theme';
import { reviewChanges, useSettingsRefresh } from './AdminConfigPage';

const DEFAULTS_KEY = ['admin', 'interface-defaults'];

const GROUPS: { group: InterfaceGroup; title: string }[] = [
  { group: 'UI', title: 'Interface' },
  { group: 'Chat', title: 'Chat' },
  { group: 'File', title: 'Files' },
];

const DIRECTIONS: Record<ChatDirection, string> = { auto: 'Automatic', LTR: 'Left to right', RTL: 'Right to left' };

type Tree = Record<string, unknown>;

/**
 * Default Interface Settings (the web's Admin → General → UI): what everyone's Interface settings
 * start as. Anyone's own choice wins; whatever they haven't chosen follows these, on the web and
 * in the app. Edited in a sheet and saved together, over the server's settings as they are then.
 */
export function InterfaceDefaults() {
  const { client } = useAuthed();
  const defaults = useQuery({ queryKey: DEFAULTS_KEY, queryFn: async () => interfaceDefaultsOf(await getAdminConfig(client)), staleTime: 0 });
  const [open, setOpen] = useState(false);
  const count = Object.keys(defaults.data ?? {}).length;
  return (
    <View style={styles.wrap}>
      <SectionTitle title="Default Interface Settings" />
      <Group>
        <ActionRow
          label="Everyone’s Interface settings"
          hint="What they start as. Anyone’s own choice wins."
          value={defaults.isPending ? '…' : defaults.error ? 'Couldn’t load' : count ? `${count} set` : 'None set'}
          onPress={() => setOpen(true)}
        />
      </Group>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        {open ? <Editor onClose={() => setOpen(false)} /> : null}
      </Modal>
    </View>
  );
}

/** A setting's value in words, set or not. */
function stateOf(tree: Tree, key: InterfaceKey): string {
  return hasSettingAt(tree, INTERFACE_SETTINGS[key].path) ? (interfaceOn(tree, key) ? 'on' : 'off') : 'not set';
}

function Editor({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const refresh = useSettingsRefresh();
  // Read again as the sheet opens, so the changes go over what's saved now.
  const saved = useQuery({ queryKey: DEFAULTS_KEY, queryFn: async () => interfaceDefaultsOf(await getAdminConfig(client)), staleTime: 0 });
  const [changes, setChanges] = useState<Record<string, unknown>>({});
  const [cleared, setCleared] = useState(false);
  const [busy, setBusy] = useState(false);
  const loaded = saved.data ?? {};
  const effective = withoutEmpty(withUiChanges(cleared ? {} : loaded, changes));
  const keys = Object.keys(INTERFACE_SETTINGS) as InterfaceKey[];
  const others = otherDefaultKeys(effective);
  const direction = hasSettingAt(effective, 'chatDirection') ? chatDirection(effective) : null;

  const change = (paths: Record<string, unknown>) => setChanges((current) => ({ ...current, ...paths }));

  // What changes, in the order the sheet shows it.
  const lines = [
    ...keys.flatMap((key) => {
      const was = stateOf(loaded, key);
      const now = stateOf(effective, key);
      return was !== now ? [`${INTERFACE_SETTINGS[key].label}: ${was} → ${now}`] : [];
    }),
    ...(String(loaded.chatDirection ?? '') !== String(effective.chatDirection ?? '')
      ? [`Chat direction: ${hasSettingAt(loaded, 'chatDirection') ? DIRECTIONS[chatDirection(loaded)] : 'not set'} → ${direction ? DIRECTIONS[direction] : 'not set'}`]
      : []),
    ...(cleared && otherDefaultKeys(loaded).length ? [`The web’s other ${otherDefaultKeys(loaded).length === 1 ? 'setting' : 'settings'}: cleared`] : []),
  ];
  const ready = !busy && saved.isSuccess && lines.length > 0;

  const save = () => {
    if (!ready) return;
    reviewChanges('Save everyone’s defaults?', [...lines, '', 'Everyone who hasn’t chosen these themselves follows them, on the web and here.'], [], () => {
      void (async () => {
        setBusy(true);
        try {
          const kept = await saveInterfaceDefaults(client, changes, { clear: cleared });
          queryClient.setQueryData(DEFAULTS_KEY, kept);
          refresh();
          // Your own settings follow the defaults wherever you haven't chosen.
          void queryClient.invalidateQueries({ queryKey: ['user-settings'] });
          toast('Defaults saved');
          onClose();
        } catch (error) {
          toast(`Couldn’t save them: ${describeError(error)}`, 'error');
        } finally {
          setBusy(false);
        }
      })();
    });
  };

  const chooseDirection = () =>
    Alert.alert('Chat direction', 'Which way text runs in chats, for everyone who hasn’t chosen. Automatic follows each paragraph’s language.', [
      ...(Object.keys(DIRECTIONS) as ChatDirection[]).map((value) => ({
        text: value === direction ? `${DIRECTIONS[value]} ✓` : DIRECTIONS[value],
        onPress: () => change({ chatDirection: value }),
      })),
      ...(direction ? [{ text: 'Don’t Set It', style: 'destructive' as const, onPress: () => change({ chatDirection: undefined }) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
          Interface Defaults
        </Text>
        {busy ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : (
          <Pressable accessibilityRole="button" onPress={save} disabled={!ready} hitSlop={10}>
            <Text style={[styles.action, styles.strong, { color: ready ? palette.link : palette.textFaint }]}>Save</Text>
          </Pressable>
        )}
      </View>
      {saved.isPending ? (
        <ActivityIndicator style={styles.loading} color={palette.textMuted} />
      ) : saved.error ? (
        <Pressable accessibilityRole="button" onPress={() => void saved.refetch()} style={styles.loading}>
          <Text style={[styles.hint, { color: palette.danger }]}>{`Couldn’t load them: ${describeError(saved.error)}. Tap to try again.`}</Text>
        </Pressable>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Note>What everyone’s Interface settings start as, for the whole server. Anyone’s own choice wins; whatever they haven’t chosen follows these. Not set, the web’s own default applies.</Note>
          <View style={styles.countRow}>
            <Text style={[styles.hint, styles.grow, { color: palette.textMuted }]}>{`${Object.keys(effective).length} set`}</Text>
            {Object.keys(effective).length ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setCleared(true);
                  setChanges({});
                }}
                hitSlop={8}>
                <Text style={[styles.clear, { color: palette.danger }]}>Clear All</Text>
              </Pressable>
            ) : null}
          </View>
          {GROUPS.map(({ group, title }) => {
            const shown = keys.filter((key) => {
              const setting: (typeof INTERFACE_SETTINGS)[InterfaceKey] = INTERFACE_SETTINGS[key];
              return setting.group === group && (!('onlyWhenOff' in setting) || !interfaceOn(effective, setting.onlyWhenOff as InterfaceKey));
            });
            return [
              <SectionTitle key={`${group}-title`} title={title} />,
              <Group key={group}>
                {shown.map((key) => {
                  const setting: (typeof INTERFACE_SETTINGS)[InterfaceKey] = INTERFACE_SETTINGS[key];
                  const isSet = hasSettingAt(effective, setting.path);
                  return (
                    <View key={key} style={styles.row}>
                      <View style={styles.grow}>
                        <Text style={[styles.label, { color: palette.text }]}>{setting.label}</Text>
                        {'hint' in setting ? <Text style={[styles.hint, { color: palette.textMuted }]}>{setting.hint}</Text> : null}
                        <Text style={[styles.hint, { color: isSet ? palette.link : palette.textFaint }]}>
                          {isSet ? 'Set for everyone' : `Not set: ${setting.default ? 'on' : 'off'}, the web’s own default`}
                          {'needsTemporary' in setting ? ' · only for accounts that may start temporary chats' : ''}
                        </Text>
                      </View>
                      {isSet ? <IconButton icon="x-mark" label={`Don’t set ${setting.label}`} size={16} color={palette.textMuted} onPress={() => change({ [setting.path]: undefined })} /> : null}
                      <Switch accessibilityLabel={setting.label} value={interfaceOn(effective, key)} onValueChange={(on) => change(interfaceChange(key, on))} />
                    </View>
                  );
                })}
                {group === 'Chat' ? <ActionRow key="direction" label="Chat direction" value={direction ? DIRECTIONS[direction] : 'Not set'} onPress={chooseDirection} /> : null}
              </Group>,
            ];
          })}
          {others.length ? (
            <Note>{`Also set, for things only the web has: ${others.join(', ')}. Saving here keeps ${others.length === 1 ? 'it' : 'them'}; change ${others.length === 1 ? 'it' : 'them'} on the web.`}</Note>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  loading: { padding: 32, alignItems: 'center' },
  content: { padding: 16, gap: 8, paddingBottom: 48 },
  countRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 4, marginTop: 4 },
  grow: { flex: 1, gap: 2 },
  clear: { fontFamily: fonts.medium, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46, paddingLeft: 14, paddingRight: 10, paddingVertical: 10 },
  label: { fontFamily: fonts.regular, fontSize: 15 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
