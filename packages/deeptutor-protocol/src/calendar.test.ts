import { describe, expect, it } from 'vitest';
import { createEvent, deleteEvent, DT_ALL_LAYERS, eventChanges, itemsByDay, listCalendars, listOccurrences, occurrenceInput, updateEvent, type DtOccurrence } from './calendar';
import { DtClient } from './http';

function client(...answers: unknown[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const dt = new DtClient({
    baseUrl: 'https://learn.example.com',
    token: 'tok',
    fetch: async (url, init) => {
      calls.push({ url: url.replace('https://learn.example.com', ''), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
    },
  });
  return { dt, calls };
}

const occurrence = (over: Partial<Record<string, unknown>>) => ({
  id: 'e1:2026-11-03',
  event_id: 'e1',
  series_id: null,
  occurrence: '2026-11-03',
  recurring: false,
  calendar_id: 'cal',
  title: 'Exam',
  notes: '',
  location: '',
  all_day: true,
  start: '2026-11-03',
  end: '2026-11-05',
  tzid: 'UTC',
  rrule: null,
  reminders: [],
  color: null,
  task_id: null,
  source: 'user',
  ...over,
});

describe('calendar', () => {
  it('reads calendars in order and showings with their series', async () => {
    const { dt, calls } = client(
      { calendars: [{ id: 'b', name: 'Work', color: '#000000', visible: false, position: 2, is_default: false }, { id: 'a', name: 'Personal', color: '#ffffff', visible: true, position: 0, is_default: true }], revision: 1 },
      { occurrences: [occurrence({ recurring: true, series_id: 'e1', rrule: 'FREQ=DAILY' })], revision: 1 },
    );
    expect((await listCalendars(dt)).map((calendar) => [calendar.id, calendar.isDefault, calendar.visible])).toEqual([
      ['a', true, true],
      ['b', false, false],
    ]);
    const [first] = await listOccurrences(dt, new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2026, 11, 1)), 'Asia/Kuala_Lumpur');
    expect(first).toMatchObject({ eventId: 'e1', seriesId: 'e1', recurring: true, allDay: true, rrule: 'FREQ=DAILY' });
    expect(calls[1]!.url).toBe('/api/calendar/events?start=2026-11-01T00%3A00%3A00Z&end=2026-12-01T00%3A00%3A00Z&tz=Asia%2FKuala_Lumpur');
  });

  it('creates, changes one showing, and deletes with an undo token', async () => {
    const { dt, calls } = client({ event: { id: 'new' }, revision: 2 }, { revision: 3 }, { revision: 4, undo_token: 'u1' });
    expect(await createEvent(dt, { title: ' Study ', allDay: false, start: '2026-11-03T01:00:00Z', end: '2026-11-03T02:00:00Z', tzid: 'Asia/Kuala_Lumpur', reminders: [10], taskId: 'c1' })).toBe('new');
    await updateEvent(dt, 'e1', { title: 'Moved', rrule: null }, 'this', '2026-11-03T01:00:00Z');
    expect(await deleteEvent(dt, 'e1', 'following', '2026-11-04T01:00:00Z')).toEqual({ undoToken: 'u1' });
    expect(calls[0]!.body).toEqual({ title: 'Study', all_day: false, start: '2026-11-03T01:00:00Z', end: '2026-11-03T02:00:00Z', tzid: 'Asia/Kuala_Lumpur', reminders: [10], task_id: 'c1', task_workspace_id: '' });
    expect(calls[1]!.body).toEqual({ changes: { title: 'Moved', rrule: null }, scope: 'this', occurrence: '2026-11-03T01:00:00Z' });
    expect(calls[2]).toMatchObject({ method: 'DELETE', url: '/api/calendar/events/e1?scope=following&occurrence=2026-11-04T01%3A00%3A00Z' });
  });

  it('lays out days: all-day first, spans on each day, hidden calendars and layers left out', () => {
    const base = { calendarId: 'cal', eventId: 'x', seriesId: null, occurrence: '', recurring: false, notes: '', location: '', tzid: 'UTC', rrule: null, reminders: [] as number[], color: null, taskId: null, source: 'user' as const };
    const occurrences: DtOccurrence[] = [
      { ...base, id: 'span', title: 'Trip', allDay: true, start: '2026-11-03', end: '2026-11-05' },
      { ...base, id: 'late', title: 'Call', allDay: false, start: new Date(2026, 10, 3, 15).toISOString(), end: new Date(2026, 10, 3, 16).toISOString() },
      { ...base, id: 'early', title: 'Class', allDay: false, start: new Date(2026, 10, 3, 9).toISOString(), end: new Date(2026, 10, 3, 10).toISOString() },
      { ...base, id: 'hidden', calendarId: 'off', title: 'Secret', allDay: true, start: '2026-11-03', end: '2026-11-04' },
    ];
    const days = itemsByDay({
      occurrences,
      calendars: [
        { id: 'cal', name: 'Mine', color: '#123456', visible: true, position: 0, isDefault: true },
        { id: 'off', name: 'Off', color: '#654321', visible: false, position: 1, isDefault: false },
      ],
      cards: [{ id: 't', title: 'Essay', note: '', status: 'todo', archived: false, createdAt: '', updatedAt: '', dueDate: '2026-11-04' }],
      taskColors: { todo: '#111111', doing: '#222222', done: '#333333' },
      layers: { reviews: [{ date: '2026-11-04', mastery: 1, practice: 2 }], automations: [], footprints: [] },
      toggles: { ...DT_ALL_LAYERS, reviews: false },
      from: '2026-11-01',
      to: '2026-12-01',
    });
    expect(days.get('2026-11-03')!.map((item) => item.title)).toEqual(['Trip', 'Class', 'Call']);
    // The trip began earlier, so it leads; the hidden calendar and the reviews (switched off) are absent.
    expect(days.get('2026-11-04')!.map((item) => item.title)).toEqual(['Trip', 'Essay']);
    expect(days.get('2026-11-05')).toBeUndefined();
    expect(days.get('2026-11-03')![0]!.color).toBe('#123456');
  });

  it('sends an edit as what changed, with the times together', () => {
    const shown: DtOccurrence = { id: 'e1:k', eventId: 'e1', seriesId: 'e1', occurrence: 'k', recurring: true, calendarId: 'cal', title: 'Class', notes: '', location: '', allDay: false, start: '2026-11-03T01:00:00Z', end: '2026-11-03T02:00:00Z', tzid: 'Asia/Kuala_Lumpur', rrule: 'FREQ=WEEKLY;BYDAY=TU', reminders: [10], color: null, taskId: null, source: 'user' };
    const before = occurrenceInput(shown);
    expect(eventChanges(before, { ...before, title: 'Lab' })).toEqual({ title: 'Lab' });
    expect(eventChanges(before, { ...before, end: '2026-11-03T03:00:00Z' })).toEqual({ start: '2026-11-03T01:00:00Z', end: '2026-11-03T03:00:00Z', allDay: false, tzid: 'Asia/Kuala_Lumpur' });
    expect(eventChanges(before, { ...before })).toEqual({});
  });
});
