import { deleteFeedback, exportFeedback, feedbackCsv, feedbackModels, getArenaEnabled, getFeedback, getLeaderboard, getModelHistory, listFeedback, setArenaEnabled, type Feedback, type LeaderboardEntry } from '@maviechat/owui-protocol';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { MenuButton } from '@/components/Menu';
import { Modal } from '@/components/Modal';
import { SideScroll } from '@/components/SideScroll';
import { useToast } from '@/components/Toast';
import { shareFile, stampedName } from '@/features/settings/exportFile';
import { editorStyles, SheetHeader, SheetLoading } from '@/features/workspace/EditorParts';
import { Chip } from '@/features/workspace/ListControls';
import { describeError } from '@/lib/errors';
import { useAuthed, useModels } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

const RESULT: Record<Feedback['result'], string> = { won: 'Thumbs up', lost: 'Thumbs down', draw: 'Even' };
const when = (ms: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/**
 * Admin → Evaluations: the arena on or off; the leaderboard (ratings from people's thumbs while
 * comparing models; a model's wins and losses over time); and everyone's feedback (by model,
 * with the rated reply; delete; export).
 */
export function EvaluationsTab({ tabs }: { tabs: ReactNode }) {
  const [part, setPart] = useState<'board' | 'feedback'>('board');
  const header = (
    <View style={styles.top}>
      {tabs}
      <Arena />
      <View style={styles.chips}>
        <Chip label="Leaderboard" on={part === 'board'} onPress={() => setPart('board')} />
        <Chip label="Feedback" on={part === 'feedback'} onPress={() => setPart('feedback')} />
      </View>
    </View>
  );
  return part === 'board' ? <Leaderboard header={header} /> : <FeedbackList header={header} />;
}

function Arena() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const arena = useQuery({ queryKey: ['admin', 'arena'], queryFn: () => getArenaEnabled(client), staleTime: 0 });
  if (arena.data === undefined) return null;
  return (
    <View style={[styles.arena, { borderColor: palette.border }]}>
      <View style={styles.flex}>
        <Text style={[styles.name, { color: palette.text }]}>Arena</Text>
        <Text style={[styles.meta, { color: palette.textMuted }]}>A model that answers with a randomly picked one, so people can compare. The arena’s models are set on the web.</Text>
      </View>
      <Switch
        accessibilityLabel="Arena"
        value={arena.data}
        onValueChange={(on) =>
          void setArenaEnabled(client, on).then(
            () => {
              void queryClient.invalidateQueries({ queryKey: ['admin', 'arena'] });
              void queryClient.invalidateQueries({ queryKey: ['models'] });
              toast(on ? 'Arena on' : 'Arena off');
            },
            (error: unknown) => toast(describeError(error), 'error'),
          )
        }
      />
    </View>
  );
}

function Leaderboard({ header }: { header: ReactNode }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const models = useModels();
  const board = useQuery({ queryKey: ['admin', 'leaderboard'], queryFn: () => getLeaderboard(client), staleTime: 30_000 });
  const [open, setOpen] = useState<LeaderboardEntry | null>(null);
  const nameOf = (id: string) => models.data?.find((model) => model.id === id)?.name ?? id;
  return (
    <>
      <FlatList
        data={board.data ?? []}
        keyExtractor={(entry) => entry.modelId}
        contentContainerStyle={styles.list}
        refreshing={false}
        onRefresh={() => void board.refetch()}
        ListHeaderComponent={
          <View style={styles.top}>
            {header}
            {board.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
            {board.isError ? <Text style={[styles.meta, { color: palette.danger }]}>{`Couldn’t load it: ${describeError(board.error)}`}</Text> : null}
            {board.data && !board.data.length ? <Text style={[styles.meta, styles.center, { color: palette.textMuted }]}>No ratings yet: only thumbs given while comparing models count.</Text> : null}
          </View>
        }
        renderItem={({ item, index }) => (
          <Pressable accessibilityRole="button" onPress={() => setOpen(item)} style={({ pressed }) => [styles.item, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <Text style={[styles.rank, { color: palette.textMuted }]}>{index + 1}</Text>
            <View style={styles.flex}>
              <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                {nameOf(item.modelId)}
              </Text>
              <Text style={[styles.meta, { color: palette.textFaint }]}>{`${item.won} won · ${item.lost} lost`}</Text>
            </View>
            <Text style={[styles.rating, { color: palette.text }]}>{item.rating}</Text>
          </Pressable>
        )}
      />
      <Modal visible={open !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(null)}>
        {open ? <ModelHistory entry={open} name={nameOf(open.modelId)} onClose={() => setOpen(null)} /> : null}
      </Modal>
    </>
  );
}

function ModelHistory({ entry, name, onClose }: { entry: LeaderboardEntry; name: string; onClose: () => void }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const [days, setDays] = useState(30);
  const history = useQuery({ queryKey: ['admin', 'model-history', entry.modelId, days], queryFn: () => getModelHistory(client, entry.modelId, days), staleTime: 30_000 });
  const rows = (history.data ?? []).filter((day) => day.won || day.lost);
  const won = rows.reduce((sum, day) => sum + day.won, 0);
  const lost = rows.reduce((sum, day) => sum + day.lost, 0);
  return (
    <View style={[editorStyles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={name} onCancel={onClose} onSave={onClose} canSave busy={false} readOnly />
      <ScrollView contentContainerStyle={editorStyles.content}>
        <Text style={[styles.meta, { color: palette.textMuted }]}>{`Rating ${entry.rating} · ${entry.won} won · ${entry.lost} lost · ${entry.count} ratings`}</Text>
        {entry.tags.length ? <Text style={[styles.meta, { color: palette.textMuted }]}>{`Most tagged: ${entry.tags.map((tag) => `${tag.tag} (${tag.count})`).join(', ')}`}</Text> : null}
        <View style={styles.chips}>
          {[
            { value: 30, label: '30 days' },
            { value: 365, label: 'A year' },
            { value: 0, label: 'All time' },
          ].map((item) => (
            <Chip key={item.value} label={item.label} on={days === item.value} onPress={() => setDays(item.value)} />
          ))}
        </View>
        {entry.modelId.includes('/') ? <Text style={[styles.meta, { color: palette.textMuted }]}>Open WebUI can’t show the history of a model whose id has a slash.</Text> : null}
        {history.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {history.data ? <Text style={[styles.name, { color: palette.text }]}>{`${won} won, ${lost} lost`}</Text> : null}
        {rows
          .slice(-30)
          .reverse()
          .map((day) => (
            <View key={day.date} style={styles.day}>
              <Text style={[styles.meta, styles.flex, { color: palette.textMuted }]}>{day.date}</Text>
              <View style={[styles.bar, { width: Math.min(160, day.won * 12), backgroundColor: palette.success }]} />
              <View style={[styles.bar, { width: Math.min(160, day.lost * 12), backgroundColor: palette.danger }]} />
              <Text style={[styles.meta, { color: palette.text }]}>{`${day.won}–${day.lost}`}</Text>
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

function FeedbackList({ header }: { header: ReactNode }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const [model, setModel] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const models = useQuery({ queryKey: ['admin', 'feedback-models'], queryFn: () => feedbackModels(client), staleTime: 30_000 });
  const feedback = useInfiniteQuery({
    queryKey: ['admin', 'feedback', model],
    queryFn: ({ pageParam }) => listFeedback(client, { page: pageParam, modelId: model || undefined }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (pages.reduce((sum, page) => sum + page.items.length, 0) < last.total && last.items.length ? pages.length + 1 : undefined),
    staleTime: 15_000,
  });
  const items = feedback.data?.pages.flatMap((page) => page.items) ?? [];
  const exportAll = async (kind: 'csv' | 'json') => {
    try {
      if (kind === 'json') {
        await shareFile(stampedName('feedback'), JSON.stringify(await exportFeedback(client), null, 2));
        return;
      }
      let all: Feedback[] = [];
      for (let page = 1; ; page += 1) {
        const batch = await listFeedback(client, { page, modelId: model || undefined });
        all = [...all, ...batch.items];
        if (!batch.items.length || all.length >= batch.total) break;
      }
      await shareFile(stampedName('feedback').replace(/\.json$/, '.csv'), feedbackCsv(all));
    } catch (error) {
      toast(`Couldn’t export: ${describeError(error)}`, 'error');
    }
  };
  const askJson = () =>
    Alert.alert('Export everything?', 'The export holds a full copy of every rated chat: what people said is in it. Share it with care.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Export', onPress: () => void exportAll('json') },
    ]);
  return (
    <>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={false}
        onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['admin', 'feedback'] })}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (feedback.hasNextPage && !feedback.isFetchingNextPage) void feedback.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={styles.top}>
            {header}
            <View style={styles.row}>
              <SideScroll showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.flex}>
                <Chip label="Every model" on={!model} onPress={() => setModel('')} />
                {(models.data ?? []).map((id) => (
                  <Chip key={id} label={id} on={model === id} onPress={() => setModel(id)} />
                ))}
              </SideScroll>
              <MenuButton
                label="Export"
                icon="arrow-down-tray"
                color={palette.textMuted}
                items={[
                  { key: 'csv', label: 'Export as CSV', icon: 'document-text', onPress: () => void exportAll('csv') },
                  { key: 'json', label: 'Export Everything (JSON)', icon: 'arrow-down-tray', onPress: askJson },
                ]}
              />
            </View>
            {feedback.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
            {feedback.isError ? <Text style={[styles.meta, { color: palette.danger }]}>{`Couldn’t load it: ${describeError(feedback.error)}`}</Text> : null}
            {feedback.data && !items.length ? <Text style={[styles.meta, styles.center, { color: palette.textMuted }]}>No feedback yet.</Text> : null}
          </View>
        }
        ListFooterComponent={feedback.isFetchingNextPage ? <ActivityIndicator color={palette.textMuted} /> : undefined}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => setOpen(item.id)} style={({ pressed }) => [styles.item, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <View style={styles.flex}>
              <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                {`${RESULT[item.result]} · ${item.modelId}`}
              </Text>
              <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={2}>
                {[item.siblings.length ? `against ${item.siblings.join(', ')}` : '', item.reason, item.comment].filter(Boolean).join(' · ') || 'No reason given'}
              </Text>
              <Text style={[styles.meta, { color: palette.textFaint }]}>{[item.userName, when(item.updatedAt)].filter(Boolean).join(' · ')}</Text>
            </View>
          </Pressable>
        )}
      />
      <Modal visible={open !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(null)}>
        {open ? <FeedbackDetail id={open} onClose={() => setOpen(null)} /> : null}
      </Modal>
    </>
  );
}

function FeedbackDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const item = useQuery({ queryKey: ['admin', 'feedback-item', id], queryFn: () => getFeedback(client, id), staleTime: 0 });
  if (!(item.data && item.isFetchedAfterMount)) return <SheetLoading error={item.isError ? item.error : null} onClose={onClose} />;
  const data = item.data;
  const remove = () =>
    Alert.alert('Delete this feedback?', 'It goes for good, and leaves the leaderboard.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteFeedback(client, id).then(
            () => {
              void queryClient.invalidateQueries({ queryKey: ['admin'] });
              toast('Feedback deleted');
              onClose();
            },
            (error: unknown) => toast(describeError(error), 'error'),
          ),
      },
    ]);
  const block = (label: string, value: string) =>
    value ? (
      <View style={styles.block}>
        <Text style={[styles.meta, { color: palette.textMuted }]}>{label}</Text>
        <Text selectable style={[styles.body, { color: palette.text, backgroundColor: palette.surface }]}>
          {value}
        </Text>
      </View>
    ) : null;
  return (
    <View style={[editorStyles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={`${RESULT[data.result]} · ${data.modelId}`} onCancel={onClose} onSave={onClose} canSave busy={false} readOnly />
      <ScrollView contentContainerStyle={editorStyles.content}>
        <Text style={[styles.meta, { color: palette.textMuted }]}>{[data.userName, when(data.updatedAt), data.siblings.length ? `against ${data.siblings.join(', ')}` : '', data.score !== null ? `${data.score} out of 10` : ''].filter(Boolean).join(' · ')}</Text>
        {block('Reason', data.reason)}
        {block('Comment', data.comment)}
        {data.tags.length ? <Text style={[styles.meta, { color: palette.textMuted }]}>{`Tags: ${data.tags.join(', ')}`}</Text> : null}
        {block('What they asked', data.prompt)}
        {block('The reply they rated', data.reply)}
        {!data.prompt && !data.reply ? <Text style={[styles.meta, { color: palette.textFaint }]}>No copy of the chat was kept with it.</Text> : null}
        <Pressable accessibilityRole="button" onPress={remove} style={styles.delete}>
          <Text style={[styles.name, { color: palette.danger }]}>Delete Feedback</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { gap: 10, paddingBottom: 6 },
  list: { padding: 16, gap: 8, paddingBottom: 48 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  arena: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  rank: { width: 24, fontFamily: fonts.semibold, fontSize: 15, textAlign: 'center' },
  rating: { fontFamily: fonts.semibold, fontSize: 17 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  center: { textAlign: 'center' },
  day: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bar: { height: 8, borderRadius: 4 },
  block: { gap: 4 },
  body: { padding: 10, borderRadius: radius.md, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, overflow: 'hidden' },
  delete: { alignSelf: 'flex-start', paddingVertical: 8 },
});
