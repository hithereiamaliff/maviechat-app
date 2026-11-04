import type { WorkspaceView } from '@maviechat/owui-protocol';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { fonts, radius, usePalette } from '@/theme';

const VIEWS: { key: WorkspaceView; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'created', label: 'Yours' },
  { key: 'shared', label: 'Shared with you' },
];

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[styles.chip, { borderColor: palette.border }, on && { backgroundColor: palette.active, borderColor: palette.active }]}>
      <Text style={[styles.chipText, { color: on ? palette.onActive : palette.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

/** A Workspace list's search, whose (all, yours, shared), order, tags, New, and more (import, export). */
export function ListControls({
  query,
  setQuery,
  placeholder,
  view,
  setView,
  byName,
  setByName,
  tags,
  tag,
  setTag,
  onNew,
  more,
}: {
  query: string;
  setQuery: (value: string) => void;
  placeholder: string;
  view: WorkspaceView;
  setView: (value: WorkspaceView) => void;
  byName: boolean;
  setByName: (value: boolean) => void;
  tags?: string[];
  tag?: string;
  setTag?: (value: string) => void;
  onNew?: () => void;
  more?: MenuItem[];
}) {
  const palette = usePalette();
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput value={query} onChangeText={setQuery} placeholder={placeholder} placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel={placeholder} style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        {onNew ? (
          <View>
            <Button label="New" onPress={onNew} />
          </View>
        ) : null}
        {more?.length ? <MenuButton label="Import and export" items={more} color={palette.textMuted} /> : null}
      </View>
      <View style={styles.chips}>
        {VIEWS.map((item) => (
          <Chip key={item.key || 'all'} label={item.label} on={view === item.key} onPress={() => setView(item.key)} />
        ))}
        <Chip label={byName ? 'By name' : 'Latest'} on={false} onPress={() => setByName(!byName)} />
      </View>
      {tags?.length && setTag ? (
        <View style={styles.chips}>
          {tags.map((name) => (
            <Chip key={name} label={`#${name}`} on={tag === name} onPress={() => setTag(tag === name ? '' : name)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  search: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 30, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
});
