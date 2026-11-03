import { listTags, tagSearch, typedTag, withTagSearch } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useAuthed } from '@/lib/server';
import { fonts, usePalette } from '@/theme';

const FLAGS = [
  { label: 'Pinned', words: 'pinned:true' },
  { label: 'Shared', words: 'shared:true' },
  { label: 'Archived', words: 'archived:true' },
];

/**
 * Under the sidebar's search, the filters the web's search understands: pinned, shared and
 * archived chats, and your tags (`tag:`). While you type `tag:`, only the matching tags show.
 */
export function SearchFilters({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => listTags(client), staleTime: 60_000 });
  const words = value.split(/\s+/).filter(Boolean);
  const typing = typedTag(value);
  const has = (word: string) => words.includes(word);
  const toggle = (word: string) => onChange((has(word) ? words.filter((item) => item !== word) : [...words, word]).join(' '));
  const shownTags = (tags.data ?? []).filter((tag) => !typing || tag.id.includes(typing) || tag.name.toLowerCase().includes(typing));
  if (!shownTags.length && typing !== null) return null;

  const chip = (key: string, label: string, on: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.chip, { borderColor: palette.border }, on && { backgroundColor: palette.active, borderColor: palette.active }]}>
      <Text style={[styles.chipText, { color: on ? palette.onActive : palette.textMuted }]}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.row}>
      {typing === null ? FLAGS.map((flag) => chip(flag.words, flag.label, has(flag.words), () => toggle(flag.words))) : null}
      {shownTags.map((tag) => {
        const on = has(tagSearch(tag));
        return chip(`tag-${tag.id}`, `#${tag.name}`, on, () => (on ? onChange(words.filter((item) => item !== tagSearch(tag)).join(' ')) : onChange(withTagSearch(value, tag))));
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6, paddingHorizontal: 12, paddingBottom: 6 },
  chip: { height: 28, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
});
