import { folderSearch, listFolders, listTags, tagSearch, typedFilter, typedTag, withFilterWord, withTagSearch } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, usePalette } from '@/theme';

const FLAGS = [
  { label: 'Pinned', words: 'pinned:true' },
  { label: 'Shared', words: 'shared:true' },
  { label: 'Archived', words: 'archived:true' },
  { label: 'Untagged', words: 'tag:none' },
];

/**
 * Under the sidebar's search, the filters the web's search understands: pinned, shared and
 * archived chats, chats without tags, your tags (`tag:`) and your folders (`folder:`, subfolders
 * included). While you type `tag:` or `folder:`, only the matching ones show.
 */
export function SearchFilters({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const foldersOn = capabilities?.feature('folders') ?? false;
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => listTags(client), staleTime: 60_000 });
  const folders = useQuery({ queryKey: ['folders'], queryFn: () => listFolders(client), enabled: foldersOn });
  const words = value.split(/\s+/).filter(Boolean);
  const typing = typedTag(value);
  const typingFolder = typedFilter(value, 'folder:');
  const has = (word: string) => words.includes(word);
  const toggle = (word: string) => onChange((has(word) ? words.filter((item) => item !== word) : [...words, word]).join(' '));
  const shownTags = typingFolder !== null ? [] : (tags.data ?? []).filter((tag) => !typing || tag.id.includes(typing) || tag.name.toLowerCase().includes(typing));
  const shownFolders =
    typing !== null || !foldersOn ? [] : (folders.data ?? []).filter((folder) => !typingFolder || folderSearch(folder).slice('folder:'.length).includes(typingFolder.replace(/\s+/g, '_')));
  if (!shownTags.length && !shownFolders.length && (typing !== null || typingFolder !== null)) return null;

  const chip = (key: string, label: string, on: boolean, onPress: () => void, icon?: IconName) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={icon === 'folder' ? `Folder ${label}` : undefined}
      onPress={onPress}
      style={[styles.chip, { borderColor: palette.border }, on && { backgroundColor: palette.active, borderColor: palette.active }]}>
      {icon ? <Icon name={icon} size={13} color={on ? palette.onActive : palette.textMuted} strokeWidth={2} /> : null}
      <Text style={[styles.chipText, { color: on ? palette.onActive : palette.textMuted }]}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.row}>
      {typing === null && typingFolder === null ? FLAGS.map((flag) => chip(flag.words, flag.label, has(flag.words), () => toggle(flag.words))) : null}
      {shownTags.map((tag) => {
        const on = has(tagSearch(tag));
        return chip(`tag-${tag.id}`, `#${tag.name}`, on, () => (on ? onChange(words.filter((item) => item !== tagSearch(tag)).join(' ')) : onChange(withTagSearch(value, tag))));
      })}
      {shownFolders.map((folder) => {
        const word = folderSearch(folder);
        const on = has(word);
        return chip(`folder-${folder.id}`, folder.name, on, () => (on ? onChange(words.filter((item) => item !== word).join(' ')) : onChange(withFilterWord(value, word))), 'folder');
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6, paddingHorizontal: 12, paddingBottom: 6 },
  chip: { height: 28, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
});
