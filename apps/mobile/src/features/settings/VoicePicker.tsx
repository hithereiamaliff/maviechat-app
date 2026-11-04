import * as Speech from 'expo-speech';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { setDevicePrefs, useDevicePrefs } from '@/lib/devicePrefs';
import { speakText, stopReading } from '@/lib/readAloud';
import { fonts, radius, usePalette } from '@/theme';
import { voiceQuality, voiceSample, voiceSections, type PhoneVoice } from './voices';

const phoneLocale = () => Intl.DateTimeFormat().resolvedOptions().locale;

/** The phone's voices to read aloud with, by language. Tapping one picks it and lets you hear it. */
export function VoicePicker({ visible, rate, onClose }: { visible: boolean; rate: number; onClose: () => void }) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        stopReading();
        onClose();
      }}>
      {visible ? (
        <VoiceList
          rate={rate}
          onClose={() => {
            stopReading();
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}

function VoiceList({ rate, onClose }: { rate: number; onClose: () => void }) {
  const palette = usePalette();
  const { voice: chosen } = useDevicePrefs();
  const [voices, setVoices] = useState<PhoneVoice[] | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    Speech.getAvailableVoicesAsync().then(
      (list) => setVoices(list),
      () => setVoices([]),
    );
  }, []);
  const sections = useMemo(() => voiceSections(voices ?? [], phoneLocale(), query), [voices, query]);

  const pick = (voice: PhoneVoice | null) => {
    setDevicePrefs({ voice: voice ? { identifier: voice.identifier, name: voice.name, language: voice.language } : null });
    // Hear it: the voice says a line in its language (the phone's default, the line in English).
    if (voice) speakText('voice-sample', voiceSample(voice.language), { rate, voice, force: true });
    else speakText('voice-sample', voiceSample('en'), { rate, voice: null });
  };

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Voice
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.done, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search voices or languages"
          placeholderTextColor={palette.textFaint}
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search voices"
          style={[styles.searchInput, { color: palette.text }]}
        />
      </View>
      {voices === null ? (
        <ActivityIndicator style={styles.loading} color={palette.textMuted} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.identifier}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            query.trim() ? undefined : <Row title="Phone default" hint="The phone’s voice for each reply’s language" selected={!chosen} onPress={() => pick(null)} />
          }
          renderSectionHeader={({ section }) => <Text style={[styles.section, { color: palette.textMuted }]}>{section.title}</Text>}
          renderItem={({ item }) => <Row title={item.name} badge={voiceQuality(item)} selected={chosen?.identifier === item.identifier} onPress={() => pick(item)} />}
          ListEmptyComponent={<Text style={[styles.empty, { color: palette.textFaint }]}>{query.trim() ? 'No voices match.' : 'This phone has no voices to offer.'}</Text>}
          ListFooterComponent={
            <Text style={[styles.footer, { color: palette.textFaint }]}>
              More voices, and better-sounding downloads of these: iPhone Settings → Accessibility → Spoken Content → Voices.
            </Text>
          }
        />
      )}
    </View>
  );
}

function Row({ title, hint, badge, selected, onPress }: { title: string; hint?: string; badge?: string | null; selected: boolean; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityHint="Picks this voice and plays a sample"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: palette.text }]}>{title}</Text>
        {hint ? <Text style={[styles.rowHint, { color: palette.textMuted }]}>{hint}</Text> : null}
      </View>
      {badge ? <Text style={[styles.badge, { color: palette.textMuted, borderColor: palette.border }]}>{badge}</Text> : null}
      {selected ? <Icon name="check" size={18} color={palette.link} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16, marginBottom: 4, paddingHorizontal: 10, height: 38, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  loading: { marginTop: 32 },
  list: { paddingBottom: 48 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 18, marginBottom: 4, marginHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.regular, fontSize: 15 },
  rowHint: { fontFamily: fonts.regular, fontSize: 12 },
  badge: { fontFamily: fonts.medium, fontSize: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 24 },
  footer: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginHorizontal: 16, marginTop: 20 },
});
