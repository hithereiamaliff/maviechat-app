import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import licenses from '@/generated/licenses.json';
import { Icon } from '@/components/Icon';
import { supportLabel, useCapabilities, useServerConfig, useServerVersion } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

function updateLabel(): string {
  if (Updates.isEmbeddedLaunch || !Updates.updateId) return 'the version built into this install';
  const when = Updates.createdAt ? Updates.createdAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown date';
  return `${when} (${Updates.updateId.slice(0, 8)})`;
}

/** About: app and server versions, and the open-source packages the app ships. */
export function AboutSettings() {
  const palette = usePalette();
  const config = useServerConfig();
  const version = useServerVersion();
  const capabilities = useCapabilities();
  const [showLicenses, setShowLicenses] = useState(false);

  const rows: [string, string][] = [
    ['MavieChat', Constants.expoConfig?.version ?? 'unknown'],
    ['Update', updateLabel()],
    ['Server', config.data?.name ?? 'Open WebUI'],
    ['Open WebUI', version.data ? `${version.data.version} (${supportLabel(capabilities?.support)})` : version.isError ? 'unavailable' : 'checking…'],
  ];

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
      <Text style={[styles.note, { color: palette.textFaint }]}>
        MavieChat is an independent app for Open WebUI servers. It is not affiliated with Open WebUI.
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showLicenses }}
        onPress={() => setShowLicenses((value) => !value)}
        style={[styles.group, styles.toggle, { borderColor: palette.border }]}>
        <Text style={[styles.label, styles.toggleLabel, { color: palette.text }]}>Open-source software ({licenses.length})</Text>
        <Icon name={showLicenses ? 'chevron-up' : 'chevron-down'} size={16} color={palette.textMuted} strokeWidth={2} />
      </Pressable>
      {showLicenses ? (
        <View style={styles.licenses}>
          {licenses.map((item) => (
            <Text key={`${item.name}@${item.version}`} style={[styles.license, { color: palette.textMuted }]}>
              {item.name} {item.version} · {item.license}
            </Text>
          ))}
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
  licenses: { gap: 4, paddingHorizontal: 4 },
  license: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 16 },
});
