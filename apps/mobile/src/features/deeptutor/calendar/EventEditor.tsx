import {
  addDaysKey,
  ALL_DAY_REMINDERS,
  createEvent,
  dateKey,
  describeReminder,
  describeRepeat,
  deviceTimeZone,
  eventChanges,
  fromDateKey,
  instant,
  MAX_REMINDERS,
  occurrenceInput,
  repeatEndOf,
  repeatPresetOf,
  repeatRule,
  TIMED_REMINDERS,
  updateEvent,
  type DateKey,
  type DtCalendar,
  type DtEventInput,
  type DtEventScope,
  type DtOccurrence,
  type RepeatEnd,
  type RepeatPreset,
} from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { showAlert } from '@/components/dialogs';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { DatePicker, TimePicker } from './Pickers';

export type EditorTarget = { kind: 'new'; day: DateKey } | { kind: 'edit'; occurrence: DtOccurrence };

/** The editor's working copy: days inclusive, times as minutes after midnight. */
interface Draft {
  title: string;
  allDay: boolean;
  startDay: DateKey;
  startMinutes: number;
  endDay: DateKey;
  endMinutes: number;
  repeat: RepeatPreset;
  repeatEnd: RepeatEnd;
  reminders: number[];
  calendarId: string | null;
  location: string;
  notes: string;
}

const at = (day: DateKey, minutes: number) => {
  const date = fromDateKey(day);
  date.setMinutes(minutes);
  return date;
};
const minutesOf = (date: Date) => date.getHours() * 60 + date.getMinutes();
const timeLabel = (minutes: number) => new Date(2000, 0, 1, 0, minutes).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dayLabel = (day: DateKey) => fromDateKey(day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function draftFor(target: EditorTarget, calendars: DtCalendar[]): Draft {
  if (target.kind === 'edit') {
    const { occurrence } = target;
    const start = occurrence.allDay ? fromDateKey(occurrence.start) : new Date(occurrence.start);
    const end = occurrence.allDay ? fromDateKey(addDaysKey(occurrence.end, -1)) : new Date(occurrence.end);
    return {
      title: occurrence.title,
      allDay: occurrence.allDay,
      startDay: dateKey(start),
      startMinutes: occurrence.allDay ? 9 * 60 : minutesOf(start),
      endDay: dateKey(end),
      endMinutes: occurrence.allDay ? 10 * 60 : minutesOf(end),
      repeat: repeatPresetOf(occurrence.rrule, start),
      repeatEnd: repeatEndOf(occurrence.rrule),
      reminders: occurrence.reminders,
      calendarId: occurrence.calendarId || null,
      location: occurrence.location,
      notes: occurrence.notes,
    };
  }
  // A new event starts at the next full hour today, else at 09:00, for an hour.
  const now = new Date();
  const start = target.day === dateKey(now) && now.getHours() < 23 ? (now.getHours() + 1) * 60 : 9 * 60;
  return {
    title: '',
    allDay: false,
    startDay: target.day,
    startMinutes: start,
    endDay: target.day,
    endMinutes: start + 60,
    repeat: 'none',
    repeatEnd: { kind: 'never' },
    reminders: [],
    calendarId: calendars.find((calendar) => calendar.isDefault)?.id ?? calendars[0]?.id ?? null,
    location: '',
    notes: '',
  };
}

/** The draft as DeepTutor takes it; a custom repeat it can't edit is kept as it was. */
function inputOf(draft: Draft, keptRule: string | null): DtEventInput {
  const start = at(draft.startDay, draft.allDay ? 0 : draft.startMinutes);
  return {
    calendarId: draft.calendarId,
    title: draft.title,
    notes: draft.notes,
    location: draft.location,
    allDay: draft.allDay,
    start: draft.allDay ? draft.startDay : instant(start),
    end: draft.allDay ? addDaysKey(draft.endDay, 1) : instant(at(draft.endDay, draft.endMinutes)),
    tzid: deviceTimeZone(),
    rrule: draft.repeat === 'custom' ? keptRule : repeatRule(draft.repeat, start, draft.allDay, draft.repeatEnd),
    reminders: [...draft.reminders].sort((a, b) => a - b),
  };
}

const REPEATS: RepeatPreset[] = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'monthlyWeekday', 'yearly'];

/** A new event, or changes to one (for a repeating one, asked which dates). */
export function EventEditor({ target, calendars, onClose }: { target: EditorTarget | null; calendars: DtCalendar[]; onClose: () => void }) {
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target ? <EditorBody target={target} calendars={calendars} onClose={onClose} /> : null}
    </Modal>
  );
}

function EditorBody({ target, calendars, onClose }: { target: EditorTarget; calendars: DtCalendar[]; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const [draft, setDraft] = useState(() => draftFor(target, calendars));
  const [picker, setPicker] = useState<'startDay' | 'endDay' | 'startTime' | 'endTime' | 'until' | null>(null);
  const [addingReminder, setAddingReminder] = useState(false);
  const [busy, setBusy] = useState(false);
  const editing = target.kind === 'edit' ? target.occurrence : null;
  const keptRule = editing?.rrule ?? null;
  const change = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const startDate = at(draft.startDay, draft.allDay ? 0 : draft.startMinutes);
  const endDate = draft.allDay ? at(addDaysKey(draft.endDay, 1), 0) : at(draft.endDay, draft.endMinutes);
  const problem = endDate <= startDate ? 'The end must be after the start.' : null;

  // Moving the start keeps the length; the end can then be moved on its own.
  const moveStart = (day: DateKey, minutes: number) => {
    const length = endDate.getTime() - startDate.getTime();
    const start = at(day, draft.allDay ? 0 : minutes);
    const end = new Date(start.getTime() + length);
    change(draft.allDay ? { startDay: day, endDay: dateKey(new Date(end.getTime() - 1)) } : { startDay: day, startMinutes: minutes, endDay: dateKey(end), endMinutes: minutesOf(end) });
  };

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'calendar'] });

  const save = async (scope: DtEventScope = 'all') => {
    setBusy(true);
    try {
      const input = inputOf(draft, keptRule);
      if (editing) {
        const changes = eventChanges(occurrenceInput(editing), input);
        if (Object.keys(changes).length) await updateEvent(client, editing.eventId, changes, scope, editing.occurrence);
      } else {
        await createEvent(client, input);
      }
      invalidate();
      onClose();
    } catch (error) {
      toast(`Couldn't save the event: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (problem) return;
    if (editing && Object.keys(eventChanges(occurrenceInput(editing), inputOf(draft, keptRule))).length === 0) return onClose();
    if (!editing?.recurring) return void save('all');
    // A repeat that changed can't apply to one date alone.
    const repeatChanged = eventChanges(occurrenceInput(editing), inputOf(draft, keptRule)).rrule !== undefined;
    showAlert('Change a repeating event', 'Which dates should change?', [
      ...(repeatChanged ? [] : [{ text: 'This Event', onPress: () => void save('this') }]),
      { text: 'This and Following', onPress: () => void save('following') },
      { text: 'All Events', onPress: () => void save('all') },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const repeatLabel = (preset: RepeatPreset) => (preset === 'none' ? 'Does not repeat' : describeRepeat(repeatRule(preset, startDate, draft.allDay), startDate));
  const reminderChoices = (draft.allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS).filter((minutes) => !draft.reminders.includes(minutes));
  const input = [styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];
  const chip = (key: string, label: string, selected: boolean, onPress: () => void, dot?: string) => (
    <Pressable
      key={key}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.chip, { borderColor: palette.border }, selected && { backgroundColor: palette.active, borderColor: palette.active }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      <Text style={[styles.chipText, { color: selected ? palette.onActive : palette.text }]}>{label}</Text>
    </Pressable>
  );
  const field = (label: string, value: string, onPress: () => void, accessibilityLabel: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${accessibilityLabel}: ${value}`} onPress={onPress} style={({ pressed }) => [styles.field, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
      <Text style={[styles.fieldText, { color: palette.text }]}>{value}</Text>
      {label ? <Text style={[styles.fieldHint, { color: palette.textFaint }]}>{label}</Text> : null}
    </Pressable>
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={[styles.link, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {editing ? 'Edit Event' : 'New Event'}
        </Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          value={draft.title}
          onChangeText={(title) => change({ title })}
          placeholder="Add a title"
          placeholderTextColor={palette.textFaint}
          maxLength={200}
          autoFocus={!editing}
          style={[input, styles.titleInput]}
          accessibilityLabel="Event title"
        />
        <View style={styles.switchRow}>
          <Text style={[styles.rowLabel, { color: palette.text }]}>All day</Text>
          <Switch
            value={draft.allDay}
            onValueChange={(allDay) => change(allDay ? { allDay, endDay: draft.endDay < draft.startDay ? draft.startDay : draft.endDay } : { allDay, endDay: draft.startDay, startMinutes: 9 * 60, endMinutes: 10 * 60 })}
            accessibilityLabel="All day"
          />
        </View>
        <Text style={[styles.label, { color: palette.textMuted }]}>Starts</Text>
        <View style={styles.pair}>
          {field('', dayLabel(draft.startDay), () => setPicker('startDay'), 'Start day')}
          {draft.allDay ? null : field('', timeLabel(draft.startMinutes), () => setPicker('startTime'), 'Start time')}
        </View>
        <Text style={[styles.label, { color: palette.textMuted }]}>Ends</Text>
        <View style={styles.pair}>
          {field('', dayLabel(draft.endDay), () => setPicker('endDay'), 'End day')}
          {draft.allDay ? null : field('', timeLabel(draft.endMinutes), () => setPicker('endTime'), 'End time')}
        </View>
        {problem ? <Text style={[styles.note, { color: palette.danger }]}>{problem}</Text> : null}

        <Text style={[styles.label, { color: palette.textMuted }]}>Repeat</Text>
        <View style={styles.chips}>
          {REPEATS.map((preset) => chip(preset, repeatLabel(preset), draft.repeat === preset, () => change({ repeat: preset })))}
          {draft.repeat === 'custom' ? chip('custom', `${describeRepeat(keptRule, startDate)} (kept)`, true, () => undefined) : null}
        </View>
        {draft.repeat !== 'none' && draft.repeat !== 'custom' ? (
          <>
            <Text style={[styles.label, { color: palette.textMuted }]}>Repeat ends</Text>
            <View style={styles.chips}>
              {chip('never', 'Never', draft.repeatEnd.kind === 'never', () => change({ repeatEnd: { kind: 'never' } }))}
              {chip('until', draft.repeatEnd.kind === 'until' ? `On ${dayLabel(draft.repeatEnd.date)}` : 'On a date', draft.repeatEnd.kind === 'until', () => setPicker('until'))}
              {chip('count', draft.repeatEnd.kind === 'count' ? `After ${draft.repeatEnd.count} times` : 'After some times', draft.repeatEnd.kind === 'count', () =>
                change({ repeatEnd: { kind: 'count', count: draft.repeatEnd.kind === 'count' ? draft.repeatEnd.count : 10 } }),
              )}
            </View>
            {draft.repeatEnd.kind === 'count' ? (
              <View style={styles.counter}>
                <IconButton icon="minus" label="Fewer times" size={18} disabled={draft.repeatEnd.count <= 1} onPress={() => change({ repeatEnd: { kind: 'count', count: Math.max(1, (draft.repeatEnd as { count: number }).count - 1) } })} />
                <Text style={[styles.counterText, { color: palette.text }]}>{`${draft.repeatEnd.count} times`}</Text>
                <IconButton icon="plus" label="More times" size={18} onPress={() => change({ repeatEnd: { kind: 'count', count: (draft.repeatEnd as { count: number }).count + 1 } })} />
              </View>
            ) : null}
          </>
        ) : null}

        <Text style={[styles.label, { color: palette.textMuted }]}>Reminders</Text>
        {draft.reminders.map((minutes) => (
          <View key={minutes} style={[styles.reminder, { borderColor: palette.border }]}>
            <Icon name="clock" size={16} color={palette.textMuted} />
            <Text style={[styles.reminderText, { color: palette.text }]}>{describeReminder(minutes, draft.allDay)}</Text>
            <IconButton icon="x-mark" label="Remove reminder" size={16} color={palette.textMuted} onPress={() => change({ reminders: draft.reminders.filter((item) => item !== minutes) })} />
          </View>
        ))}
        {addingReminder ? (
          <View style={styles.chips}>
            {reminderChoices.map((minutes) =>
              chip(String(minutes), describeReminder(minutes, draft.allDay), false, () => {
                change({ reminders: [...draft.reminders, minutes] });
                setAddingReminder(false);
              }),
            )}
          </View>
        ) : draft.reminders.length < MAX_REMINDERS ? (
          <Pressable accessibilityRole="button" onPress={() => setAddingReminder(true)} style={styles.addReminder} hitSlop={4}>
            <Icon name="plus" size={16} color={palette.link} />
            <Text style={[styles.addReminderText, { color: palette.link }]}>Add reminder</Text>
          </Pressable>
        ) : null}
        <Text style={[styles.note, { color: palette.textFaint }]}>DeepTutor&apos;s web app shows reminders; the phone doesn&apos;t notify yet.</Text>

        {calendars.length > 1 ? (
          <>
            <Text style={[styles.label, { color: palette.textMuted }]}>Calendar</Text>
            <View style={styles.chips}>{calendars.map((calendar) => chip(calendar.id, calendar.name, draft.calendarId === calendar.id, () => change({ calendarId: calendar.id }), calendar.color))}</View>
          </>
        ) : null}

        <Text style={[styles.label, { color: palette.textMuted }]}>Location</Text>
        <TextInput value={draft.location} onChangeText={(location) => change({ location })} placeholder="Add a place" placeholderTextColor={palette.textFaint} maxLength={300} style={input} accessibilityLabel="Location" />
        <Text style={[styles.label, { color: palette.textMuted }]}>Notes</Text>
        <TextInput
          value={draft.notes}
          onChangeText={(notes) => change({ notes })}
          placeholder="Add notes"
          placeholderTextColor={palette.textFaint}
          maxLength={5000}
          multiline
          textAlignVertical="top"
          style={[input, styles.notes]}
          accessibilityLabel="Notes"
        />
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        <Button label={editing ? 'Save' : 'Add Event'} onPress={confirm} loading={busy} disabled={busy || problem !== null} />
      </View>
      <DatePicker
        visible={picker === 'startDay' || picker === 'endDay' || picker === 'until'}
        value={picker === 'endDay' ? draft.endDay : picker === 'until' ? (draft.repeatEnd.kind === 'until' ? draft.repeatEnd.date : draft.startDay) : draft.startDay}
        onPick={(day) => {
          if (picker === 'startDay') moveStart(day, draft.startMinutes);
          else if (picker === 'endDay') change({ endDay: day });
          else change({ repeatEnd: { kind: 'until', date: day } });
        }}
        onClose={() => setPicker(null)}
      />
      <TimePicker
        visible={picker === 'startTime' || picker === 'endTime'}
        hour={Math.floor((picker === 'endTime' ? draft.endMinutes : draft.startMinutes) / 60)}
        minute={(picker === 'endTime' ? draft.endMinutes : draft.startMinutes) % 60}
        onPick={(hour, minute) => (picker === 'endTime' ? change({ endMinutes: hour * 60 + minute }) : moveStart(draft.startDay, hour * 60 + minute))}
        onClose={() => setPicker(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  link: { fontFamily: fonts.medium, fontSize: 16, minWidth: 60 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  spacer: { minWidth: 60 },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 8 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  titleInput: { fontFamily: fonts.medium, fontSize: 16 },
  notes: { minHeight: 90 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 15 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 8 },
  pair: { flexDirection: 'row', gap: 8 },
  field: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11 },
  fieldText: { fontFamily: fonts.regular, fontSize: 15 },
  fieldHint: { fontFamily: fonts.regular, fontSize: 11 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 6 },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  counterText: { fontFamily: fonts.medium, fontSize: 14, minWidth: 80, textAlign: 'center' },
  reminder: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingLeft: 10 },
  reminderText: { flex: 1, fontFamily: fonts.regular, fontSize: 14 },
  addReminder: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  addReminderText: { fontFamily: fonts.medium, fontSize: 14 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
});
