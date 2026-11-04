import { getMcpCatalog, type DtMcpEntry } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { CatalogBrowser } from '@/features/deeptutor/services/CatalogBrowser';
import { McpEntrySheet } from '@/features/deeptutor/services/McpEntrySheet';
import { useMcpState } from '@/features/deeptutor/services/mcpBits';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const CATEGORY_NAMES: Record<string, string> = { search: 'Search', docs: 'Docs', code: 'Code', data: 'Data', browser: 'Browser', science: 'Science', maps: 'Maps', business: 'Business', ai: 'AI', utility: 'Utility' };

/** DeepTutor's store of MCP servers you can install yourself (it ships with DeepTutor: browsing it reaches nothing). */
export default function McpStore() {
  const palette = usePalette();
  const { client, session } = useDtAuthed();
  const state = useMcpState();
  const [entry, setEntry] = useState<DtMcpEntry | null>(null);
  // The app is in English for now; DeepTutor's store has English and Chinese texts.
  const language = 'en';
  const atCap = state.data ? state.data.servers.length >= state.data.maxServers : false;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="MCP Store" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.intro, { color: palette.textMuted }]}>Servers you can install yourself. Ones that run on the server itself are your admin’s to add.</Text>
        <CatalogBrowser<DtMcpEntry>
          queryKey={[DT_QUERY_ROOT, session.baseUrl, 'mcp-store', language]}
          load={({ q, category, cursor }) => getMcpCatalog(client, { q, category, cursor, limit: 30, language })}
          categoryLabel={(key) => CATEGORY_NAMES[key] ?? key}
          empty="The store is empty: add a server by its URL instead."
          renderRow={(row) => (
            <Pressable accessibilityRole="button" onPress={() => setEntry(row)} style={({ pressed }) => [styles.row, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : 'transparent' }]}>
              <View style={[styles.mark, { backgroundColor: palette.surfaceStrong }]}>
                <Text style={[styles.markText, { color: palette.text }]}>{row.name.slice(0, 2).toUpperCase()}</Text>
              </View>
              <View style={styles.text}>
                <Text style={[styles.name, { color: palette.text }]}>{row.name}</Text>
                <Text style={[styles.detail, { color: palette.textMuted }]} numberOfLines={2}>
                  {row.description}
                </Text>
                <Text style={[styles.marks, { color: palette.textFaint }]}>
                  {[row.installed ? 'Installed' : '', row.fields.some((field) => field.required) ? 'Needs credentials' : '', row.verified ? '' : 'Unverified', row.tier === 'registry' ? 'From the registry' : ''].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </Pressable>
          )}
        />
      </ScrollView>
      <McpEntrySheet visible={entry !== null} entry={entry} atCap={atCap} onClose={() => setEntry(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  intro: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  mark: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  markText: { fontFamily: fonts.semibold, fontSize: 13 },
  text: { flex: 1, gap: 3 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  detail: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  marks: { fontFamily: fonts.regular, fontSize: 11 },
});
