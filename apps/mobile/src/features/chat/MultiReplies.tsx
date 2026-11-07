import { type HistoryMessage, type MergedResponse, type ReplyGroup } from '@maviechat/owui-protocol';
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View, type ScrollView } from 'react-native';
import { Icon } from '@/components/Icon';
import { SideScroll } from '@/components/SideScroll';
import { Markdown } from '@/markdown/Markdown';
import { fonts, radius, usePalette } from '@/theme';

interface MultiRepliesProps {
  groups: ReplyGroup[];
  /** The reply on the shown branch: its column is the one the chat continues from. */
  replyId: string;
  messages: Record<string, HistoryMessage>;
  labelOf: (message: HistoryMessage) => string;
  /** The web's "multi-model responses as tabs" setting; cards otherwise. */
  tabs: boolean;
  renderReply: (message: HistoryMessage, group: ReplyGroup) => ReactNode;
  /** Continue the chat from this column's answer. */
  onSelect: (group: ReplyGroup) => void;
  merged: MergedResponse | null;
  /** "Merge Responses", offered on the last turn once every answer has finished. */
  onMerge?: () => void;
  merging: boolean;
  baseUrl: string;
  token: string;
}

/**
 * A message answered by several models (Compare), as on the web: one card per model, side by side
 * (full width on a phone, so you swipe between them), or tabs. The card drawn solid is the answer the
 * chat continues from. Each card has its own version arrows; under them, the merged answer.
 */
export function MultiReplies({ groups, replyId, messages, labelOf, tabs, renderReply, onSelect, merged, onMerge, merging, baseUrl, token }: MultiRepliesProps) {
  const palette = usePalette();
  const selected = Math.max(0, groups.findIndex((group) => group.shownId === replyId));
  const pager = useRef<ComponentRef<typeof ScrollView>>(null);
  // Until the pager has measured itself: the screen less the chat's side margins.
  const { width: screenWidth } = useWindowDimensions();
  const [measured, setMeasured] = useState(0);
  const width = measured || screenWidth - 32;
  const [page, setPage] = useState(selected);
  const [pageFor, setPageFor] = useState(selected);
  const opened = useRef(false);

  // The chat continuing from another column (version arrows, Overview) brings its card into view.
  // The pager opens on it (`contentOffset`), so the first run has nothing to do.
  if (pageFor !== selected) {
    setPageFor(selected);
    setPage(selected);
  }
  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      return;
    }
    pager.current?.scrollTo({ x: selected * width, animated: true });
  }, [selected, width]);

  const shown = groups.map((group) => messages[group.shownId]).filter((message): message is HistoryMessage => Boolean(message));
  const current = groups[selected];
  const currentMessage = current ? messages[current.shownId] : undefined;

  return (
    <View style={styles.wrap}>
      {tabs ? (
        <>
          <SideScroll showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.tabs, { borderBottomColor: palette.border }]}>
            {groups.map((group, index) => {
              const message = messages[group.shownId];
              const on = index === selected;
              return (
                <Pressable
                  key={group.modelIdx}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => (on ? undefined : onSelect(group))}
                  style={[styles.tab, { borderBottomColor: on ? palette.text : 'transparent' }]}>
                  <Text style={[styles.tabText, { color: on ? palette.text : palette.textFaint }]} numberOfLines={1}>
                    {message ? labelOf(message) : group.modelId}
                  </Text>
                </Pressable>
              );
            })}
          </SideScroll>
          {current && currentMessage ? renderReply(currentMessage, current) : null}
        </>
      ) : (
        <>
          <SideScroll
            ref={pager}
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: selected * width, y: 0 }}
            onLayout={(event) => setMeasured(event.nativeEvent.layout.width)}
            onMomentumScrollEnd={(event) => setPage(Math.round(event.nativeEvent.contentOffset.x / width))}
            accessibilityHint="Swipe left or right for the other models' answers">
            {groups.map((group, index) => {
              const message = messages[group.shownId];
              const on = index === selected;
              return (
                <View key={group.modelIdx} style={[styles.page, { width }]}>
                  <View
                    style={[
                      styles.card,
                      on
                        ? { borderWidth: 2, borderColor: palette.border, backgroundColor: palette.surface }
                        : { borderWidth: 1, borderStyle: 'dashed', borderColor: palette.border },
                    ]}>
                    {message ? renderReply(message, group) : null}
                    {on ? null : (
                      <Pressable accessibilityRole="button" onPress={() => onSelect(group)} hitSlop={6} style={styles.choose}>
                        <Icon name="check" size={15} color={palette.link} strokeWidth={2} />
                        <Text style={[styles.chooseText, { color: palette.link }]}>Continue with this answer</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </SideScroll>
          {groups.length > 1 ? (
            <View style={styles.dots} accessibilityLabel={`Answer ${page + 1} of ${groups.length}`}>
              {groups.map((group, index) => (
                <Pressable
                  key={group.modelIdx}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${shown[index] ? labelOf(shown[index]) : 'answer'}`}
                  hitSlop={6}
                  onPress={() => {
                    setPage(index);
                    pager.current?.scrollTo({ x: index * width, animated: true });
                  }}
                  style={[styles.dot, { backgroundColor: index === page ? palette.text : palette.border }]}
                />
              ))}
            </View>
          ) : null}
        </>
      )}

      {merged ? (
        <View style={styles.merged}>
          <Text style={[styles.mergedTitle, { color: palette.text }]}>Merged Response</Text>
          {merged.content ? (
            <Markdown text={merged.content} baseUrl={baseUrl} token={token} />
          ) : (
            <ActivityIndicator style={styles.mergedWait} color={palette.textMuted} />
          )}
        </View>
      ) : null}
      {onMerge ? (
        <Pressable accessibilityRole="button" disabled={merging} onPress={onMerge} hitSlop={6} style={({ pressed }) => [styles.merge, (pressed || merging) && { opacity: 0.6 }]}>
          {merging ? <ActivityIndicator size="small" color={palette.textMuted} /> : <Icon name="arrows-pointing-in" size={16} color={palette.textMuted} />}
          <Text style={[styles.mergeText, { color: palette.textMuted }]}>{merged ? 'Merge Again' : 'Merge Responses'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 6 },
  tabs: { flexDirection: 'row', gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  tab: { paddingHorizontal: 10, paddingBottom: 6, paddingTop: 2, borderBottomWidth: 2, maxWidth: 220 },
  tabText: { fontFamily: fonts.medium, fontSize: 14 },
  page: { paddingHorizontal: 2 },
  card: { flex: 1, borderRadius: radius.lg, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  choose: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 8 },
  chooseText: { fontFamily: fonts.medium, fontSize: 14 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingTop: 10 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  merged: { marginTop: 14, gap: 6 },
  mergedTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  mergedWait: { alignSelf: 'flex-start', marginVertical: 8 },
  merge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4 },
  mergeText: { fontFamily: fonts.medium, fontSize: 14 },
});
