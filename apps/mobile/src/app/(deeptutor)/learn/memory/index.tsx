import { MEMORY_SLOTS, MEMORY_SURFACES, type DtMemoryDocInfo, type DtMemoryLayer } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useMemoryOverview, useMemoryRefresh } from '@/features/deeptutor/memory/queries';
import { useDtModules } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { fonts, radius, usePalette } from '@/theme';

function updated(doc: DtMemoryDocInfo | undefined): string {
  if (!doc?.exists || !doc.updatedAt) return 'Nothing yet';
  const when = new Date(doc.updatedAt);
  const facts = `${doc.entries} ${doc.entries === 1 ? 'fact' : 'facts'}`;
  return Number.isNaN(when.getTime()) ? facts : `${facts} · ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

/**
 * Memory, as DeepTutor's hub has it: the big picture (recent, your profile, your knowledge
 * scope, and the preferences chats save), then a fact sheet per area of your workspace. Each
 * opens to its facts and where they came from.
 */
export default function Memory() {
  const palette = usePalette();
  const modules = useDtModules();
  const overview = useMemoryOverview();
  const refresh = useMemoryRefresh();
  const docs = overview.data?.docs ?? [];
  const find = (layer: DtMemoryLayer, key: string) => docs.find((doc) => doc.layer === layer && doc.key === key);
  const off = modules.data ? !modules.data.some((module) => module.id === 'memory' && module.enabled) : false;
  const open = (layer: DtMemoryLayer, key: string) => router.push({ pathname: '/learn/memory/sheet', params: { layer, key } });

  const row = (layer: DtMemoryLayer, key: string, label: string, index: number) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${updated(find(layer, key))}`}
      onPress={() => open(layer, key)}
      style={({ pressed }) => [styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
      <Text style={[styles.name, { color: palette.text }]}>{label}</Text>
      <Text style={[styles.state, { color: palette.textMuted }]}>{updated(find(layer, key))}</Text>
      <Icon name="chevron-right" size={14} color={palette.textFaint} />
    </Pressable>
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Memory" menu={[{ key: 'web', label: 'Memory on the Web', icon: 'globe-alt', onPress: () => router.push({ pathname: '/learn/web', params: { path: '/memory', title: 'Memory' } }) }]} />
      {off ? (
        <Text style={[styles.empty, { color: palette.textMuted }]}>Memory is switched off on this server.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
          <Text style={[styles.intro, { color: palette.textMuted }]}>
            What DeepTutor has learned from your workspace. Each area has a fact sheet, every fact citing where it came from; the big picture draws on all of them. You fill them by asking the model to update a sheet.
          </Text>
          {overview.data?.archived ? <Text style={[styles.note, { color: palette.textMuted, borderColor: palette.border }]}>Memory from DeepTutor’s earlier version is archived on the server.</Text> : null}
          {overview.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
          {overview.isError ? (
            <View style={styles.error}>
              <Text style={[styles.empty, { color: palette.textMuted }]}>{`Couldn’t load your memory: ${describeError(overview.error)}`}</Text>
              <Button label="Try Again" variant="secondary" onPress={refresh} />
            </View>
          ) : null}
          {overview.data ? (
            <>
              <Text style={[styles.section, { color: palette.textMuted }]}>The big picture</Text>
              <View style={[styles.group, { borderColor: palette.border }]}>{MEMORY_SLOTS.map((slot, index) => row('L3', slot.key, slot.label, index))}</View>
              <Text style={[styles.hint, { color: palette.textFaint }]}>Preferences are what you told a chat about how you like things; chats save them themselves.</Text>
              <Text style={[styles.section, { color: palette.textMuted }]}>Fact sheets</Text>
              <View style={[styles.group, { borderColor: palette.border }]}>{MEMORY_SURFACES.map((surface, index) => row('L2', surface.key, surface.label, index))}</View>
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  intro: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  error: { gap: 12 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 10, marginLeft: 4 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  name: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  state: { fontFamily: fonts.regular, fontSize: 13 },
});
