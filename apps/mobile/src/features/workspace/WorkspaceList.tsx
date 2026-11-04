import type { AccessGrant, WorkspaceView } from '@maviechat/owui-protocol';
import type { ReactElement, ReactNode } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { fonts, radius, usePalette } from '@/theme';
import { useWorkspaceRefresh } from './queries';

/** What a Workspace row says under its name: off, anything else, read-only, how it's shared, and whose (unless the list is yours). */
export function rowFacts(item: { isActive: boolean; writeAccess: boolean; accessGrants: AccessGrant[]; ownerName: string }, view: WorkspaceView, extra: string[] = []): string {
  const shared = item.accessGrants.some((grant) => grant.principal_id === '*') ? 'Everyone' : item.accessGrants.length ? 'Shared' : '';
  return [item.isActive ? '' : 'Off', ...extra, item.writeAccess ? '' : 'Read-only', shared, item.ownerName && view !== 'created' ? `by ${item.ownerName}` : ''].filter(Boolean).join(' · ');
}

/** Runs a Workspace change, then reloads what it touches and says how it went. */
export function useWorkspaceRun(): (work: () => Promise<unknown>, done: string) => void {
  const toast = useToast();
  const refresh = useWorkspaceRefresh();
  return (work, done) =>
    void work().then(
      () => {
        refresh();
        toast(done);
      },
      (error: unknown) => toast(describeError(error), 'error'),
    );
}

/** One Workspace item: its picture, name, a code line (a command or id), what it's for, facts, an on switch for writers, and its menu. */
export function WorkspaceRow({
  leading,
  title,
  code,
  detail,
  facts,
  dim = false,
  on,
  onToggle,
  menu,
  onPress,
  hint,
}: {
  leading?: ReactNode;
  title: string;
  code?: string;
  detail?: string;
  facts: string;
  dim?: boolean;
  on?: boolean;
  onToggle?: () => void;
  menu: MenuItem[];
  onPress: () => void;
  hint: string;
}) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityHint={hint} onPress={onPress} style={({ pressed }) => [styles.item, { borderColor: palette.border, opacity: dim ? 0.6 : 1 }, pressed && { backgroundColor: palette.surface }]}>
      {leading}
      <View style={styles.text}>
        <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
          {title}
        </Text>
        {code ? (
          <Text style={[styles.code, { color: palette.textMuted }]} numberOfLines={1}>
            {code}
          </Text>
        ) : null}
        {detail ? (
          <Text style={[styles.detail, { color: palette.textMuted }]} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
        {facts ? (
          <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
            {facts}
          </Text>
        ) : null}
      </View>
      {onToggle ? <Switch accessibilityLabel={`${title} on`} value={on} onValueChange={onToggle} /> : null}
      <MenuButton label={`Options for ${title}`} size={18} color={palette.textMuted} items={menu} />
    </Pressable>
  );
}

/** Loading, a failure, or nothing there, above a Workspace list. */
export function ListState({ loading, error, empty, filtered, noun }: { loading: boolean; error: unknown; empty: boolean; filtered: boolean; noun: string }) {
  const palette = usePalette();
  if (loading) return <ActivityIndicator color={palette.textMuted} />;
  if (error) return <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load the ${noun}: ${describeError(error)}`}</Text>;
  if (empty) return <Text style={[styles.note, styles.center, { color: palette.textMuted }]}>{filtered ? 'Nothing matches.' : `No ${noun} yet.`}</Text>;
  return null;
}

/** A Workspace list: its header (tabs and controls) scrolls with it; more pages load near the end; pull to reload. */
export function WorkspaceList<T>({
  items,
  keyOf,
  header,
  paging,
  onRefresh,
  renderItem,
}: {
  items: T[];
  keyOf: (item: T) => string;
  header: ReactElement;
  paging: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
  onRefresh: () => void;
  renderItem: (item: T) => ReactElement;
}) {
  const palette = usePalette();
  return (
    <FlatList
      data={items}
      keyExtractor={keyOf}
      ListHeaderComponent={header}
      contentContainerStyle={styles.list}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (paging.hasNextPage && !paging.isFetchingNextPage) void paging.fetchNextPage();
      }}
      refreshing={false}
      onRefresh={onRefresh}
      ListFooterComponent={paging.isFetchingNextPage ? <ActivityIndicator color={palette.textMuted} /> : undefined}
      renderItem={({ item }) => renderItem(item)}
    />
  );
}

export const listStyles = StyleSheet.create({
  flex: { flex: 1 },
  top: { gap: 10, paddingBottom: 6 },
});

const styles = StyleSheet.create({
  list: { padding: 16, gap: 8, paddingBottom: 48 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  code: { fontFamily: fonts.mono, fontSize: 12 },
  detail: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 11 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  center: { textAlign: 'center' },
});
