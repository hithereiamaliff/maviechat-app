import { FlashList } from '@shopify/flash-list';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Modal } from '@/components/Modal';
import { emojiGroups, findEmoji, firstEmoji, recentEmoji, searchEmoji, withRecent, type Emoji } from '@/lib/emoji';
import { useUserSettings } from '@/lib/server';
import { useCanSaveSettings, useSaveUiSettings } from '@/lib/uiSettings';
import { fonts, radius, usePalette } from '@/theme';

const CELL = 46;

type Row = { kind: 'title'; key: string; title: string } | { kind: 'emoji'; key: string; emoji: Emoji[] };

/** Emoji laid out a row at a time, under their group's title. */
function rowsOf(groups: { title: string; emoji: Emoji[] }[], columns: number): Row[] {
  return groups.flatMap((group) => {
    if (!group.emoji.length) return [];
    const rows: Row[] = [{ kind: 'title', key: `t:${group.title}`, title: group.title }];
    for (let start = 0; start < group.emoji.length; start += columns) rows.push({ kind: 'emoji', key: `${group.title}:${start}`, emoji: group.emoji.slice(start, start + columns) });
    return rows;
  });
}

/**
 * The web's emoji picker, as a sheet: recently used first (kept in your settings, as the web keeps
 * them), then every group; search by name, or type an emoji with the keyboard. Picking the one
 * already chosen takes it off, as on the web.
 */
export function EmojiPicker({ visible, selected, onClose, onPick }: { visible: boolean; selected?: string; onClose: () => void; onPick: (emoji: string | null) => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <EmojiGrid selected={selected} onClose={onClose} onPick={onPick} /> : null}
    </Modal>
  );
}

function EmojiGrid({ selected, onClose, onPick }: { selected?: string; onClose: () => void; onPick: (emoji: string | null) => void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const settings = useUserSettings();
  const canSave = useCanSaveSettings();
  const saveUi = useSaveUiSettings();
  const [query, setQuery] = useState('');
  const columns = Math.max(6, Math.floor((width - 24) / CELL));
  const saved = (settings.data?.ui as { recentEmojis?: unknown } | undefined)?.recentEmojis;
  const all = useMemo(() => emojiGroups(), []);
  const typed = firstEmoji(query);
  const rows = useMemo(() => {
    if (typed) return rowsOf([{ title: findEmoji(typed)?.names[0]?.replace(/_/g, ' ') ?? 'Your emoji', emoji: [findEmoji(typed) ?? { code: '', char: typed, names: [], group: -1 }] }], columns);
    if (query.trim()) return rowsOf([{ title: 'Results', emoji: searchEmoji(query) }], columns);
    return rowsOf([{ title: 'Recently Used', emoji: recentEmoji(saved) }, ...all], columns);
  }, [typed, query, columns, saved, all]);

  const pick = (emoji: Emoji) => {
    // A listed emoji goes as the list has it (the web's names have no skin tones); a newer one as typed.
    const char = emoji.code ? emoji.char : typed;
    if (emoji.code && canSave) void saveUi({ recentEmojis: withRecent(saved, emoji) });
    onPick(selected === char ? null : char);
    onClose();
  };

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Choose an Emoji
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search, or type an emoji"
        placeholderTextColor={palette.textFaint}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        accessibilityLabel="Search emoji"
        style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
      />
      {rows.length ? (
        <FlashList
          data={rows}
          keyExtractor={(row) => row.key}
          getItemType={(row) => row.kind}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 24 }}
          renderItem={({ item }) =>
            item.kind === 'title' ? (
              <Text style={[styles.group, { color: palette.textMuted }]}>{item.title}</Text>
            ) : (
              <View style={styles.row}>
                {item.emoji.map((emoji) => {
                  const chosen = selected !== undefined && selected === emoji.char;
                  return (
                    <Pressable
                      key={emoji.code || emoji.char}
                      accessibilityRole="button"
                      accessibilityLabel={emoji.names[0]?.replace(/_/g, ' ') ?? emoji.char}
                      accessibilityState={{ selected: chosen }}
                      onPress={() => pick(emoji)}
                      style={({ pressed }) => [styles.cell, (pressed || chosen) && { backgroundColor: palette.surface }]}>
                      <Text style={styles.emoji}>{emoji.char}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )
          }
        />
      ) : (
        <Text style={[styles.empty, { color: palette.textMuted }]}>No emoji match that.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.semibold, fontSize: 15 },
  search: { marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, fontFamily: fonts.regular, fontSize: 16 },
  group: { fontFamily: fonts.medium, fontSize: 12, paddingTop: 12, paddingBottom: 4, paddingHorizontal: 4 },
  row: { flexDirection: 'row' },
  cell: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  emoji: { fontSize: 28 },
  empty: { fontFamily: fonts.regular, fontSize: 14, padding: 24, textAlign: 'center' },
});
