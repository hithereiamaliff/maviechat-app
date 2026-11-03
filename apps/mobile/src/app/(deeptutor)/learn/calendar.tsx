import {
  dateKey,
  DT_ALL_LAYERS,
  fromDateKey,
  itemsByDay,
  monthWeeks,
  searchEvents,
  type DateKey,
  type DtDayItem,
  type DtLayerToggles,
  type DtTaskCard,
} from '@maviechat/deeptutor-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { CalendarsSheet } from '@/features/deeptutor/calendar/CalendarsSheet';
import { EventEditor, type EditorTarget } from '@/features/deeptutor/calendar/EventEditor';
import { ItemSheet } from '@/features/deeptutor/calendar/ItemSheet';
import { monthOf, MonthGrid } from '@/features/deeptutor/calendar/MonthGrid';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { monthRange, useDtCalendarRange, useDtCalendars, useDtTaskBoard } from '@/features/deeptutor/queries';
import { openDtPage } from '@/features/deeptutor/settings/DtGeneralSettings';
import { STATUS_LABELS, TaskSheet } from '@/features/deeptutor/tasks/TaskSheet';
import { describeError } from '@/lib/errors';
import { useStoredState } from '@/lib/storedState';
import { useDebounced } from '@/lib/useDebounced';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const time = (date: Date) => date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** When an item happens on the day shown: all day, its times, or that it carries on from or into another day. */
function whenOn(item: DtDayItem, day: DateKey): string {
  if (item.kind === 'automation') return time(item.start);
  if (item.allDay) return 'All day';
  const startsToday = dateKey(item.start) === day;
  const endsToday = dateKey(new Date(item.end.getTime() - 1)) === day;
  if (startsToday && endsToday) return `${time(item.start)} – ${time(item.end)}`;
  if (startsToday) return `From ${time(item.start)}`;
  if (endsToday) return `Until ${time(item.end)}`;
  return 'All day';
}

function subtitle(item: DtDayItem): string {
  if (item.kind === 'event') return [item.occurrence.location, item.occurrence.recurring ? 'Repeats' : ''].filter(Boolean).join(' · ');
  if (item.kind === 'task') return `Task · ${STATUS_LABELS[item.card.status]}`;
  if (item.kind === 'review') return 'Practice';
  return 'Automation';
}

/**
 * DeepTutor's calendar, laid out for a phone: the month with a dot for each kind of thing on a
 * day, then the chosen day: events, tasks due, reviews due, automations and what you studied.
 */
export default function CalendarScreen() {
  const palette = usePalette();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const today = dateKey(new Date());
  const [selected, setSelected] = useState(today);
  const [cursor, setCursor] = useState(() => monthOf(today));
  const [layers, setLayers] = useStoredState<DtLayerToggles>('dt-calendar.layers', DT_ALL_LAYERS);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [item, setItem] = useState<DtDayItem | null>(null);
  const [task, setTask] = useState<DtTaskCard | null>(null);
  const [calendarsOpen, setCalendarsOpen] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [showStudied, setShowStudied] = useState(false);
  const query = useDebounced(search?.trim() ?? '', 300);
  const calendars = useDtCalendars();
  const board = useDtTaskBoard();
  const firstShown = monthWeeks(cursor.year, cursor.month)[0]![0]!;
  const { from, to } = monthRange(firstShown);
  const range = useDtCalendarRange(from, to);
  const hits = useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'calendar', 'search', query],
    queryFn: () => searchEvents(client, query),
    enabled: search !== null && query.length > 0,
  });

  const days = useMemo(
    () =>
      itemsByDay({
        occurrences: range.occurrences.data ?? [],
        calendars: calendars.data ?? [],
        cards: board.data?.cards ?? [],
        taskColors: board.data?.colors ?? { todo: '#2563eb', doing: '#a16207', done: '#15803d' },
        layers: range.layers.data ?? null,
        toggles: layers,
        from,
        to,
      }),
    [range.occurrences.data, range.layers.data, calendars.data, board.data, layers, from, to],
  );
  const marks = useMemo(() => new Map([...days].map(([key, items]) => [key, [...new Set(items.map((entry) => entry.color))]])), [days]);
  const footprints = layers.footprints ? (range.layers.data?.footprints ?? []).filter((day) => day.sessionCount || day.practiceReviews || day.masteryEvidence) : [];
  const studied = new Set(footprints.map((day) => day.date));
  const dayItems = days.get(selected) ?? [];
  const footprint = footprints.find((day) => day.date === selected);
  const loading = range.occurrences.isLoading || calendars.isLoading;
  const error = range.occurrences.error ?? calendars.error;

  const select = (key: DateKey) => {
    setSelected(key);
    setShowStudied(false);
    const month = monthOf(key);
    if (month.year !== cursor.year || month.month !== cursor.month) setCursor(month);
  };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'calendar'] });
    void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'task-board'] });
  };
  const taskTitle = (id: string) => board.data?.cards.find((card) => card.id === id)?.title;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader
        title="Calendar"
        accessory={
          <>
            <IconButton icon="magnifying-glass" label="Search the calendar" onPress={() => setSearch(search === null ? '' : null)} />
            <IconButton icon="plus" label="New event" onPress={() => setEditor({ kind: 'new', day: selected })} />
          </>
        }
        menu={[
          { key: 'today', label: 'Today', icon: 'calendar', onPress: () => select(today) },
          { key: 'calendars', label: 'Calendars and What Shows', icon: 'adjustments-horizontal', onPress: () => setCalendarsOpen(true) },
          { key: 'tasks', label: 'Open Task Board', icon: 'view-columns', onPress: () => router.replace('/learn/tasks') },
          { key: 'web', label: 'More on the Web', icon: 'arrow-top-right-on-square', onPress: () => openDtPage('/calendar', 'Calendar') },
        ]}
        menuLabel="Calendar options"
      />
      {search !== null ? (
        <View style={styles.search}>
          <View style={[styles.searchBox, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search events"
              placeholderTextColor={palette.textFaint}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              style={[styles.searchInput, { color: palette.text }]}
              accessibilityLabel="Search events"
            />
            <IconButton icon="x-mark" label="Close search" size={16} color={palette.textMuted} onPress={() => setSearch(null)} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.hits}>
            {hits.isFetching ? <ActivityIndicator color={palette.textMuted} /> : null}
            {query && hits.data?.length === 0 ? <Text style={[styles.empty, { color: palette.textMuted }]}>No events match.</Text> : null}
            {hits.isError ? <Text style={[styles.empty, { color: palette.danger }]}>{`Couldn't search: ${describeError(hits.error)}`}</Text> : null}
            {(hits.data ?? []).map((hit) => {
              const when = hit.nextStart ?? hit.start;
              const day = hit.allDay ? when : dateKey(new Date(when));
              return (
                <Pressable
                  key={hit.id}
                  accessibilityRole="button"
                  accessibilityHint="Shows that day"
                  onPress={() => {
                    setSearch(null);
                    select(day);
                  }}
                  style={({ pressed }) => [styles.hit, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                  <Text style={[styles.itemTitle, { color: palette.text }]} numberOfLines={1}>
                    {hit.title || 'Untitled'}
                  </Text>
                  <Text style={[styles.itemSub, { color: palette.textMuted }]} numberOfLines={1}>
                    {[
                      hit.nextStart ? '' : 'Past · ',
                      fromDateKey(day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
                      hit.allDay ? '' : ` · ${time(new Date(when))}`,
                      hit.location ? ` · ${hit.location}` : '',
                    ].join('')}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
          <MonthGrid cursor={cursor} onCursor={setCursor} selected={selected} onSelect={select} today={today} marks={marks} studied={studied} />
          <View style={[styles.dayHeader, { borderTopColor: palette.border }]}>
            <Text style={[styles.dayTitle, { color: palette.text }]} accessibilityRole="header">
              {fromDateKey(selected).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
            {selected !== today ? (
              <Pressable accessibilityRole="button" onPress={() => select(today)} style={[styles.todayButton, { borderColor: palette.border }]}>
                <Text style={[styles.todayText, { color: palette.text }]}>Today</Text>
              </Pressable>
            ) : null}
          </View>
          {loading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
          {error ? <Text style={[styles.empty, { color: palette.danger }]}>{`Couldn't load the calendar: ${describeError(error)}`}</Text> : null}
          {!loading && !error && dayItems.length === 0 && !footprint ? (
            <Pressable accessibilityRole="button" onPress={() => setEditor({ kind: 'new', day: selected })} style={styles.nothing}>
              <Text style={[styles.empty, { color: palette.textMuted }]}>Nothing on this day.</Text>
              <Text style={[styles.addLink, { color: palette.link }]}>Add an event</Text>
            </Pressable>
          ) : null}
          {dayItems.map((entry) => (
            <Pressable
              key={entry.key}
              accessibilityRole="button"
              accessibilityHint="Shows it in full"
              onPress={() => setItem(entry)}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: palette.surface }]}>
              <View style={[styles.bar, { backgroundColor: entry.color }]} />
              <Text style={[styles.when, { color: palette.textMuted }]}>{whenOn(entry, selected)}</Text>
              <View style={styles.itemText}>
                <Text style={[styles.itemTitle, { color: palette.text }, entry.kind === 'task' && entry.card.status === 'done' && styles.done]} numberOfLines={2}>
                  {entry.title || 'Untitled'}
                </Text>
                {subtitle(entry) ? (
                  <Text style={[styles.itemSub, { color: palette.textMuted }]} numberOfLines={1}>
                    {subtitle(entry)}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
          {footprint ? (
            <View style={[styles.studied, { borderColor: palette.border }]}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: showStudied }} onPress={() => setShowStudied(!showStudied)} style={styles.studiedHeader}>
                <Icon name="academic-cap" size={18} color={palette.textMuted} />
                <Text style={[styles.studiedText, { color: palette.text }]}>
                  {[
                    footprint.sessionCount ? `${footprint.sessionCount} ${footprint.sessionCount === 1 ? 'chat' : 'chats'}` : '',
                    footprint.practiceReviews ? `${footprint.practiceReviews} practice ${footprint.practiceReviews === 1 ? 'review' : 'reviews'}` : '',
                    footprint.masteryEvidence ? `${footprint.masteryEvidence} learning ${footprint.masteryEvidence === 1 ? 'step' : 'steps'}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {footprint.sessions.length ? <Icon name={showStudied ? 'chevron-up' : 'chevron-down'} size={14} color={palette.textFaint} /> : null}
              </Pressable>
              {showStudied
                ? footprint.sessions.map((chat) => (
                    <Pressable
                      key={chat.id}
                      accessibilityRole="button"
                      onPress={() => router.replace({ pathname: '/learn/[id]', params: { id: chat.id } })}
                      style={({ pressed }) => [styles.studiedChat, pressed && { backgroundColor: palette.surface }]}>
                      <Icon name="chat-bubble-left" size={16} color={palette.textMuted} />
                      <Text style={[styles.itemSub, { color: palette.text }]} numberOfLines={1}>
                        {chat.title || 'Untitled chat'}
                      </Text>
                    </Pressable>
                  ))
                : null}
            </View>
          ) : null}
        </ScrollView>
      )}
      <EventEditor target={editor} calendars={calendars.data ?? []} onClose={() => setEditor(null)} />
      <ItemSheet
        item={item}
        onClose={() => setItem(null)}
        onEditEvent={(occurrence) => {
          setItem(null);
          // The details sheet closes first, then the editor opens.
          setTimeout(() => setEditor({ kind: 'edit', occurrence }), 450);
        }}
        onEditTask={(card) => {
          setItem(null);
          setTimeout(() => setTask(card), 450);
        }}
        taskTitle={taskTitle}
      />
      <TaskSheet task={task} onClose={() => setTask(null)} colors={board.data?.colors} />
      <CalendarsSheet visible={calendarsOpen} onClose={() => setCalendarsOpen(false)} calendars={calendars.data ?? []} layers={layers} onLayers={setLayers} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 48 },
  dayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  dayTitle: { fontFamily: fonts.semibold, fontSize: 16 },
  todayButton: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 },
  todayText: { fontFamily: fonts.medium, fontSize: 13 },
  loading: { marginVertical: 20 },
  nothing: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  addLink: { fontFamily: fonts.medium, fontSize: 14 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  when: { width: 92, fontFamily: fonts.regular, fontSize: 12 },
  itemText: { flex: 1, gap: 2 },
  itemTitle: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  itemSub: { fontFamily: fonts.regular, fontSize: 13 },
  done: { textDecorationLine: 'line-through' },
  studied: { marginHorizontal: 16, marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  studiedHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  studiedText: { flex: 1, fontFamily: fonts.regular, fontSize: 14 },
  studiedChat: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  search: { flex: 1 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingLeft: 10 },
  searchInput: { flex: 1, height: 40, fontFamily: fonts.regular, fontSize: 15 },
  hits: { paddingBottom: 40 },
  hit: { paddingHorizontal: 16, paddingVertical: 12, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
});
