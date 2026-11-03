import {
  addDays,
  dateKey,
  DT_TASK_STATUSES,
  dueMatches,
  isOverdue,
  setTaskColors,
  startOfWeek,
  updateTask,
  type DtDueFilter,
  type DtTaskBoard,
  type DtTaskCard,
  type DtTaskStatus,
} from '@maviechat/deeptutor-protocol';
import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { IconButton } from '@/components/IconButton';
import { MenuButton } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useDtTaskBlocks, useDtTaskBoard } from '@/features/deeptutor/queries';
import { dueLabel, STATUS_LABELS, TaskSheet } from '@/features/deeptutor/tasks/TaskSheet';
import { describeError } from '@/lib/errors';
import { useStoredState } from '@/lib/storedState';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const HINTS: Record<DtTaskStatus, string> = { todo: 'Next steps and ideas', doing: "What you're working on", done: 'Finished work' };
const FILTERS: { value: DtDueFilter; label: string }[] = [
  { value: 'all', label: 'All dates' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'This week' },
];
/** Colours offered for the columns. */
const SWATCHES = ['#2563eb', '#0891b2', '#0d9488', '#15803d', '#65a30d', '#a16207', '#ea580c', '#dc2626', '#db2777', '#7c3aed', '#475569'];

/**
 * DeepTutor's Task Board: To do, In progress and Done, one column at a time, with due days and
 * how many calendar blocks each task has. Chats can link tasks and then see them as context.
 */
export default function TaskBoardScreen() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const board = useDtTaskBoard();
  const blocks = useDtTaskBlocks();
  const [column, setColumn] = useStoredState<DtTaskStatus>('dt-tasks.column', 'todo');
  const [filter, setFilter] = useStoredState<DtDueFilter>('dt-tasks.filter', 'all');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<DtTaskCard | { new: true } | null>(null);
  const [coloring, setColoring] = useState(false);
  const keep = (next: DtTaskBoard) => queryClient.setQueryData([DT_QUERY_ROOT, session.baseUrl, 'task-board'], next);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'task-board'] });
    void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'calendar', 'task-blocks'] });
  };

  const now = new Date();
  const today = dateKey(now);
  const weekStart = startOfWeek(now);
  const cards = board.data?.cards ?? [];
  const active = cards.filter((card) => !card.archived && dueMatches(card, filter, today, dateKey(weekStart), dateKey(addDays(weekStart, 7))));
  const shown = archived ? cards.filter((card) => card.archived) : active.filter((card) => card.status === column);
  const colors = board.data?.colors;
  const linkedCount = (card: DtTaskCard) => (board.data?.sessionLinks ?? []).filter((link) => link.taskIds.includes(card.id)).length;

  const move = (card: DtTaskCard, status: DtTaskStatus) =>
    void updateTask(client, card.id, { status })
      .then(keep)
      .catch((error: unknown) => toast(`Couldn't move it: ${describeError(error)}`, 'error'));
  const setArchivedOn = (card: DtTaskCard, value: boolean) =>
    void updateTask(client, card.id, { archived: value })
      .then((next) => {
        keep(next);
        toast(value ? 'Archived' : 'Restored to the board', 'success');
      })
      .catch((error: unknown) => toast(`Couldn't change it: ${describeError(error)}`, 'error'));

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader
        title="Task Board"
        accessory={archived ? null : <IconButton icon="plus" label="New task" onPress={() => setEditing({ new: true })} />}
        menu={[
          { key: 'archived', label: archived ? 'Show Active' : 'Show Archived', icon: 'archive-box', onPress: () => setArchived(!archived) },
          { key: 'colors', label: 'Column Colours', icon: 'adjustments-horizontal', onPress: () => setColoring(true) },
          { key: 'calendar', label: 'Open Calendar', icon: 'calendar', onPress: () => router.replace('/learn/calendar') },
        ]}
        menuLabel="Task Board options"
      />
      {archived ? (
        <Text style={[styles.intro, { color: palette.textMuted }]}>Archived tasks. Restore one to put it back on the board.</Text>
      ) : (
        <>
          <View style={styles.columns}>
            {DT_TASK_STATUSES.map((status) => {
              const selected = status === column;
              const total = active.filter((card) => card.status === status).length;
              return (
                <Pressable
                  key={status}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${STATUS_LABELS[status]}, ${total}`}
                  onPress={() => setColumn(status)}
                  style={[styles.column, { borderColor: selected ? palette.text : palette.border }, selected && { backgroundColor: palette.surface }]}>
                  <View style={[styles.swatch, { backgroundColor: colors?.[status] ?? palette.textMuted }]} />
                  <Text style={[styles.columnText, { color: palette.text }]} numberOfLines={1}>
                    {STATUS_LABELS[status]}
                  </Text>
                  <Text style={[styles.count, { color: palette.textMuted }]}>{total}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.filters}>
            {FILTERS.map((item) => (
              <Pressable
                key={item.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: item.value === filter }}
                onPress={() => setFilter(item.value)}
                style={[styles.filter, { borderColor: palette.border }, item.value === filter && { backgroundColor: palette.surfaceStrong }]}>
                <Text style={[styles.filterText, { color: item.value === filter ? palette.text : palette.textMuted }]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      <FlashList
        data={shown}
        keyExtractor={(card) => card.id}
        refreshing={false}
        onRefresh={refresh}
        ListHeaderComponent={archived ? null : <Text style={[styles.hint, { color: palette.textFaint }]}>{HINTS[column]}</Text>}
        ListEmptyComponent={
          board.isLoading ? (
            <ActivityIndicator style={styles.loading} color={palette.textMuted} />
          ) : (
            <Text style={[styles.empty, { color: palette.textMuted }]}>
              {board.isError
                ? `Couldn't open the board: ${describeError(board.error)}`
                : archived
                  ? 'No archived tasks.'
                  : filter === 'all'
                    ? column === 'todo'
                      ? 'Nothing to do yet. Tap + to add a task.'
                      : `Nothing ${column === 'doing' ? 'in progress' : 'done'} yet.`
                    : 'No tasks due then.'}
            </Text>
          )
        }
        renderItem={({ item }) => {
          const index = DT_TASK_STATUSES.indexOf(item.status);
          const blockCount = blocks.data?.[item.id] ?? 0;
          const linked = linkedCount(item);
          const overdue = isOverdue(item, today);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Opens the task"
              onPress={() => setEditing(item)}
              style={({ pressed }) => [styles.card, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : palette.background }]}>
              <View style={[styles.bar, { backgroundColor: colors?.[item.status] ?? palette.textMuted }]} />
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: palette.text }, item.status === 'done' && styles.doneTitle]} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.note ? (
                  <Text style={[styles.note, { color: palette.textMuted }]} numberOfLines={2}>
                    {item.note}
                  </Text>
                ) : null}
                {item.dueDate || blockCount || linked ? (
                  <Text style={[styles.meta, { color: palette.textFaint }]}>
                    {item.dueDate ? (
                      <Text style={{ color: overdue ? palette.danger : item.dueDate === today ? palette.link : palette.textFaint }}>{`Due ${dueLabel(item.dueDate)}`}</Text>
                    ) : null}
                    {[blockCount ? `${blockCount} time ${blockCount === 1 ? 'block' : 'blocks'}` : '', linked ? `${linked} linked ${linked === 1 ? 'chat' : 'chats'}` : '']
                      .filter(Boolean)
                      .map((part, i) => `${item.dueDate || i > 0 ? ' · ' : ''}${part}`)
                      .join('')}
                  </Text>
                ) : null}
              </View>
              {archived ? (
                <IconButton icon="archive-box-arrow-down" label={`Restore ${item.title}`} size={18} color={palette.textMuted} onPress={() => setArchivedOn(item, false)} />
              ) : (
                <>
                  {index > 0 ? <IconButton icon="chevron-left" label={`Move to ${STATUS_LABELS[DT_TASK_STATUSES[index - 1]!]}`} size={18} color={palette.textMuted} onPress={() => move(item, DT_TASK_STATUSES[index - 1]!)} /> : null}
                  {index < 2 ? <IconButton icon="chevron-right" label={`Move to ${STATUS_LABELS[DT_TASK_STATUSES[index + 1]!]}`} size={18} color={palette.textMuted} onPress={() => move(item, DT_TASK_STATUSES[index + 1]!)} /> : null}
                  <MenuButton
                    label={`Options for ${item.title}`}
                    size={18}
                    color={palette.textMuted}
                    items={[
                      ...DT_TASK_STATUSES.filter((status) => status !== item.status).map((status) => ({ key: status, label: `Move to ${STATUS_LABELS[status]}`, icon: 'arrows-right-left' as const, onPress: () => move(item, status) })),
                      { key: 'archive', label: 'Archive', icon: 'archive-box', destructive: true, onPress: () => setArchivedOn(item, true) },
                    ]}
                  />
                </>
              )}
            </Pressable>
          );
        }}
      />
      <TaskSheet task={editing} onClose={() => setEditing(null)} colors={colors} linkedChats={editing && 'id' in editing ? linkedCount(editing) : 0} />
      <Modal visible={coloring} transparent animationType="fade" onRequestClose={() => setColoring(false)}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} onPress={() => setColoring(false)} accessibilityLabel="Close" />
        <View style={styles.colorWrap} pointerEvents="box-none">
          <View style={[styles.colorCard, { backgroundColor: palette.menu, borderColor: palette.border }]}>
            <Text style={[styles.colorTitle, { color: palette.text }]} accessibilityRole="header">
              Column Colours
            </Text>
            <Text style={[styles.note, { color: palette.textMuted }]}>A chat linked to a task shows its column&apos;s colour.</Text>
            {DT_TASK_STATUSES.map((status) => (
              <View key={status} style={styles.colorRow}>
                <Text style={[styles.colorLabel, { color: palette.text }]}>{STATUS_LABELS[status]}</Text>
                <View style={styles.swatches}>
                  {SWATCHES.map((color) => (
                    <Pressable
                      key={color}
                      accessibilityRole="radio"
                      accessibilityLabel={`${STATUS_LABELS[status]} colour ${color}`}
                      accessibilityState={{ checked: colors?.[status]?.toLowerCase() === color }}
                      onPress={() =>
                        colors &&
                        void setTaskColors(client, { ...colors, [status]: color })
                          .then(keep)
                          .catch((error: unknown) => toast(`Couldn't change the colour: ${describeError(error)}`, 'error'))
                      }
                      style={[styles.colorDot, { backgroundColor: color }, colors?.[status]?.toLowerCase() === color && { borderColor: palette.text, borderWidth: 2 }]}
                    />
                  ))}
                </View>
              </View>
            ))}
            <Pressable accessibilityRole="button" onPress={() => setColoring(false)} style={styles.colorDone} hitSlop={6}>
              <Text style={[styles.colorDoneText, { color: palette.link }]}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  intro: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingVertical: 8 },
  columns: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingTop: 4 },
  column: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 9 },
  swatch: { width: 9, height: 9, borderRadius: 4.5 },
  columnText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 13 },
  count: { marginLeft: 'auto', fontFamily: fonts.medium, fontSize: 12 },
  filters: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingTop: 10 },
  filter: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  filterText: { fontFamily: fonts.medium, fontSize: 12 },
  hint: { fontFamily: fonts.regular, fontSize: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  loading: { marginVertical: 24 },
  empty: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 32, paddingHorizontal: 32 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 2, marginHorizontal: 12, marginVertical: 4, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingRight: 4, overflow: 'hidden' },
  bar: { alignSelf: 'stretch', width: 4 },
  cardText: { flex: 1, gap: 3, paddingVertical: 10, paddingLeft: 10 },
  cardTitle: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  doneTitle: { textDecorationLine: 'line-through' },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  colorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  colorCard: { width: '100%', maxWidth: 380, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  colorTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  colorRow: { gap: 6 },
  colorLabel: { fontFamily: fonts.medium, fontSize: 14 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  colorDot: { width: 26, height: 26, borderRadius: 13 },
  colorDone: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4 },
  colorDoneText: { fontFamily: fonts.semibold, fontSize: 16 },
});
