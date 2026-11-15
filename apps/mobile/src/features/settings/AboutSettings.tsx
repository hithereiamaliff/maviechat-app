import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import licenseTexts from '@/generated/license-texts.json';
import licenses from '@/generated/licenses.json';
import { Icon } from '@/components/Icon';
import { supportLabel, useCapabilities, useServerConfig, useServerVersion } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

/** An open-source library the app ships (scripts/check-licenses.mjs --write), and its licence texts. */
interface Notice {
  name: string;
  version: string;
  license: string;
  /** Native libraries and artwork: what brings it in. */
  via?: string;
  /** The package has no licence file of its own: its licence's standard text, with its author. */
  standard?: boolean;
  /** A native library in one app only (`ios` or `android`). */
  platform?: string;
  texts: number[];
}

// Each app lists what it carries: a native library of the other platform isn't in it.
const NOTICES: Notice[] = (licenses as Notice[]).filter((notice) => !notice.platform || notice.platform === Platform.OS);
const TEXTS: string[] = licenseTexts;

function updateLabel(): string {
  if (Updates.isEmbeddedLaunch || !Updates.updateId) return 'the version built into this install';
  const when = Updates.createdAt ? Updates.createdAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown date';
  return `${when} (${Updates.updateId.slice(0, 8)})`;
}

/** About in Open WebUI's Settings: the app, this server and its version. */
export function AboutSettings() {
  const config = useServerConfig();
  const version = useServerVersion();
  const capabilities = useCapabilities();
  return (
    <AppAbout
      serverRows={[
        ['Server', config.data?.name ?? 'Open WebUI'],
        ['Open WebUI', version.data ? `${version.data.version} (${supportLabel(capabilities?.support)})` : version.isError ? 'unavailable' : 'checking…'],
      ]}
    />
  );
}

/** About, in either space's Settings: the app's version and update, the space's server, and the open-source packages the app ships. */
export function AppAbout({ serverRows }: { serverRows: [string, string][] }) {
  const palette = usePalette();
  const [showLicenses, setShowLicenses] = useState(false);
  const [openNotice, setOpenNotice] = useState<string | null>(null);
  const { isUpdatePending, isChecking, isDownloading } = Updates.useUpdates();
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const updating = isChecking || isDownloading;

  // A downloaded update otherwise waits for the next full launch.
  const checkForUpdate = async () => {
    setUpdateNote(null);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) await Updates.fetchUpdateAsync();
      else setUpdateNote('This is the latest update.');
    } catch {
      setUpdateNote("Couldn't check for updates. Try again in a moment.");
    }
  };

  const rows: [string, string][] = [['MavieChat', Constants.expoConfig?.version ?? 'unknown'], ['Update', updateLabel()], ...serverRows];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={[styles.group, { borderColor: palette.border }]}>
        {rows.map(([label, value], index) => (
          <View key={label} style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }]}>
            <Text style={[styles.label, { color: palette.textMuted }]}>{label}</Text>
            <Text selectable style={[styles.value, { color: palette.text }]}>
              {value}
            </Text>
          </View>
        ))}
      </View>
      {Updates.isEnabled ? (
        <Pressable
          accessibilityRole="button"
          disabled={updating}
          onPress={() => void (isUpdatePending ? Updates.reloadAsync().catch(() => undefined) : checkForUpdate())}
          style={[styles.group, styles.toggle, { borderColor: palette.border }]}>
          <Text style={[styles.label, styles.toggleLabel, { color: palette.link }]}>
            {isUpdatePending ? 'Restart to Use the New Update' : updating ? 'Checking for Updates…' : 'Check for Updates'}
          </Text>
          {updating ? <ActivityIndicator color={palette.textMuted} /> : null}
        </Pressable>
      ) : null}
      {updateNote ? <Text style={[styles.note, { color: palette.textMuted }]}>{updateNote}</Text> : null}
      <Text style={[styles.note, { color: palette.textFaint }]}>
        MavieChat is an independent app for Open WebUI and DeepTutor servers. It is not affiliated with Open WebUI or DeepTutor.
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showLicenses }}
        onPress={() => setShowLicenses((value) => !value)}
        style={[styles.group, styles.toggle, { borderColor: palette.border }]}>
        <Text style={[styles.label, styles.toggleLabel, { color: palette.text }]}>Open-source software ({NOTICES.length})</Text>
        <Icon name={showLicenses ? 'chevron-up' : 'chevron-down'} size={16} color={palette.textMuted} strokeWidth={2} />
      </Pressable>
      {showLicenses ? (
        <View style={styles.licenses}>
          <Text style={[styles.note, styles.licensesNote, { color: palette.textFaint }]}>MavieChat is built with these libraries. Tap one to read its licence.</Text>
          {NOTICES.map((item) => {
            const key = `${item.name}@${item.version}`;
            const open = openNotice === key;
            return (
              <View key={key}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpenNotice(open ? null : key)} style={styles.noticeRow}>
                  <Text style={[styles.license, { color: open ? palette.text : palette.textMuted }]}>
                    {item.name} {item.version} · {item.license}
                    {item.via ? ` · in ${item.via}` : ''}
                  </Text>
                </Pressable>
                {open ? (
                  <View style={[styles.noticeBox, { borderColor: palette.border }]}>
                    {item.standard ? <Text style={[styles.note, { color: palette.textFaint }]}>This package has no licence file of its own, so this is its licence’s standard text.</Text> : null}
                    <Text selectable style={[styles.noticeText, { color: palette.textMuted }]}>
                      {item.texts.map((index) => TEXTS[index]).join('\n\n')}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  label: { width: 96, fontFamily: fonts.medium, fontSize: 14 },
  value: { flex: 1, fontFamily: fonts.regular, fontSize: 14, textAlign: 'right' },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginHorizontal: 4 },
  toggle: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, marginTop: 6 },
  toggleLabel: { flex: 1, width: undefined },
  licenses: { paddingHorizontal: 4 },
  licensesNote: { marginHorizontal: 0, marginBottom: 4 },
  license: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 16 },
  noticeRow: { paddingVertical: 6 },
  noticeBox: { gap: 8, marginBottom: 8, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  noticeText: { fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 15 },
});
