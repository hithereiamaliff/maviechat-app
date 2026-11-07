import { useInfiniteQuery } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { SideScroll } from '@/components/SideScroll';
import { describeError } from '@/lib/errors';
import { fonts, radius, usePalette } from '@/theme';

export interface CatalogPage<T> {
  entries: T[];
  next: string;
  total: number;
  categories: Record<string, number>;
}

/**
 * A store to browse: search (as you type, after a pause), categories with counts, an optional
 * switch, and more on demand.
 */
export function CatalogBrowser<T extends { id: string }>({
  queryKey,
  load,
  renderRow,
  categoryLabel = (key) => key.charAt(0).toUpperCase() + key.slice(1),
  toggle,
  empty,
}: {
  queryKey: unknown[];
  load: (params: { q: string; category: string; cursor: string; extra: boolean }) => Promise<CatalogPage<T>>;
  renderRow: (entry: T) => ReactNode;
  categoryLabel?: (key: string) => string;
  toggle?: { label: string; initial: boolean };
  empty: string;
}) {
  const palette = usePalette();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [extra, setExtra] = useState(toggle?.initial ?? false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pages = useInfiniteQuery({
    queryKey: [...queryKey, query, category, extra],
    queryFn: ({ pageParam }) => load({ q: query, category, cursor: pageParam, extra }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next || undefined,
    staleTime: 60_000,
  });
  const first = pages.data?.pages[0];
  const entries = pages.data?.pages.flatMap((page) => page.entries) ?? [];
  const categories = Object.entries(first?.categories ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <View style={styles.wrap}>
      <TextInput
        value={draft}
        onChangeText={(value) => {
          setDraft(value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setQuery(value.trim()), 250);
        }}
        placeholder="Search"
        placeholderTextColor={palette.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        accessibilityLabel="Search the store"
        style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
      />
      {categories.length ? (
        <SideScroll showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {[['', -1] as const, ...categories].map(([key, count]) => {
            const on = category === key;
            return (
              <Pressable
                key={key || 'all'}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setCategory(on ? '' : key)}
                style={[styles.chip, { borderColor: palette.border }, on && { backgroundColor: palette.active, borderColor: palette.active }]}>
                <Text style={[styles.chipText, { color: on ? palette.onActive : palette.textMuted }]}>{key ? `${categoryLabel(key)} ${count}` : 'All'}</Text>
              </Pressable>
            );
          })}
        </SideScroll>
      ) : null}
      {toggle ? (
        <View style={styles.toggle}>
          <Text style={[styles.note, styles.flex, { color: palette.textMuted }]}>{toggle.label}</Text>
          <Switch accessibilityLabel={toggle.label} value={extra} onValueChange={setExtra} />
        </View>
      ) : null}
      {pages.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {pages.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load the store: ${describeError(pages.error)}`}</Text> : null}
      {first && !entries.length ? <Text style={[styles.note, styles.center, { color: palette.textMuted }]}>{query || category ? 'Nothing matches.' : empty}</Text> : null}
      {entries.map((entry) => (
        <View key={entry.id}>{renderRow(entry)}</View>
      ))}
      {first && entries.length ? <Text style={[styles.note, styles.center, { color: palette.textFaint }]}>{`${entries.length} of ${first.total}`}</Text> : null}
      {pages.hasNextPage ? <Button label="Show More" variant="secondary" loading={pages.isFetchingNextPage} onPress={() => void pages.fetchNextPage()} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  search: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { height: 30, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  center: { textAlign: 'center' },
});
