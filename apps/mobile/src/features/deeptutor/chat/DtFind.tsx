import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { fonts, radius, usePalette } from '@/theme';
import type { DtListItem } from './DtMessageList';
import { findInChat } from './find';

/** Find in Chat: type, then tap a match to jump to it. */
export function DtFindSheet({ visible, items, onPick, onClose }: { visible: boolean; items: DtListItem[]; onPick: (key: string) => void; onClose: () => void }) {
  const palette = usePalette();
  const [query, setQuery] = useState('');
  const matches = useMemo(() => findInChat(items, query), [items, query]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            Find in Chat
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
            <Text style={[styles.done, { color: palette.link }]}>Done</Text>
          </Pressable>
        </View>
        <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Words in this chat"
            placeholderTextColor={palette.textFaint}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.input, { color: palette.text }]}
          />
        </View>
        <ScrollView contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled">
          {query.trim().length >= 2 && matches.length === 0 ? <Text style={[styles.empty, { color: palette.textMuted }]}>Not in this chat.</Text> : null}
          {matches.map((match) => (
            <Pressable
              key={match.key}
              accessibilityRole="button"
              onPress={() => onPick(match.key)}
              style={({ pressed }) => [styles.match, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <Text style={[styles.who, { color: palette.textMuted }]}>{match.who}</Text>
              <Text style={[styles.snippet, { color: palette.text }]} numberOfLines={3}>
                {match.before}
                <Text style={[styles.hit, { backgroundColor: palette.active, color: palette.onActive }]}>{match.hit}</Text>
                {match.after}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, marginHorizontal: 16, paddingLeft: 10, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  results: { padding: 16, gap: 8 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 16 },
  match: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: 12, gap: 4 },
  who: { fontFamily: fonts.medium, fontSize: 12 },
  snippet: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  hit: { fontFamily: fonts.semibold },
});
