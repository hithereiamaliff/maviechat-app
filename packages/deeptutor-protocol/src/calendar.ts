import { addDays, dateKey, fromDateKey, instant, type DateKey } from './calendarTime';
import type { DtClient } from './http';
import type { DtTaskCard, DtTaskColors } from './tasks';

/*
 * DeepTutor's calendar (1.7.1): the account's calendars and events, plus what the workspace has
 * scheduled ("layers": practice reviews coming due, automations DeepTutor set up in a chat, and
 * footprints of the days you studied).
 */

export interface DtCalendar {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  position: number;
  isDefault: boolean;
}

export type DtEventSource = 'user' | 'dito' | 'import';

/** One showing of an event: a single event, or one date of a repeating one. */
export interface DtOccurrence {
  /** Unique per showing. */
  id: string;
  /** The row to change or delete. */
  eventId: string;
  seriesId: string | null;
  /** Which date of a series this is (its original start); needed to change only it. */
  occurrence: string;
  recurring: boolean;
  calendarId: string;
  title: string;
  notes: string;
  location: string;
  allDay: boolean;
  /** All-day: YYYY-MM-DD (end exclusive). Timed: UTC instants. */
  start: string;
  end: string;
  tzid: string;
  rrule: string | null;
  reminders: number[];
  color: string | null;
  taskId: string | null;
  source: DtEventSource;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function calendarOf(raw: unknown): DtCalendar | null {
  const calendar = record(raw);
  if (!text(calendar.id)) return null;
  return {
    id: text(calendar.id),
    name: text(calendar.name),
    color: text(calendar.color) || '#2563eb',
    visible: calendar.visible !== false,
    position: count(calendar.position),
    isDefault: calendar.is_default === true,
  };
}

function occurrenceOf(raw: unknown): DtOccurrence | null {
  const item = record(raw);
  if (!text(item.id) || !text(item.start)) return null;
  const source = item.source === 'dito' || item.source === 'import' ? item.source : 'user';
  return {
    id: text(item.id),
    eventId: text(item.event_id) || text(item.id),
    seriesId: textOrNull(item.series_id),
    occurrence: text(item.occurrence),
    recurring: item.recurring === true,
    calendarId: text(item.calendar_id),
    title: text(item.title),
    notes: text(item.notes),
    location: text(item.location),
    allDay: item.all_day === true,
    start: text(item.start),
    end: text(item.end),
    tzid: text(item.tzid) || 'UTC',
    rrule: textOrNull(item.rrule),
    reminders: list(item.reminders).filter((value): value is number => typeof value === 'number'),
    color: textOrNull(item.color),
    taskId: textOrNull(item.task_id),
    source,
  };
}

const CALENDAR = '/api/calendar';

/** The calendars, in their order. */
export async function listCalendars(client: DtClient): Promise<DtCalendar[]> {
  const response = record(await client.get<unknown>(`${CALENDAR}/calendars`));
  return list(response.calendars)
    .flatMap((item) => calendarOf(item) ?? [])
    .sort((a, b) => a.position - b.position);
}

export async function createCalendar(client: DtClient, input: { name: string; color: string }): Promise<DtCalendar> {
  const response = record((await client.send<unknown>('POST', `${CALENDAR}/calendars`, { body: { name: input.name.trim(), color: input.color } })).data);
  const calendar = calendarOf(response.calendar);
  if (!calendar) throw new Error('DeepTutor did not return the calendar');
  return calendar;
}

export async function updateCalendar(client: DtClient, id: string, changes: Partial<Pick<DtCalendar, 'name' | 'color' | 'visible'>>): Promise<void> {
  await client.send('PATCH', `${CALENDAR}/calendars/${encodeURIComponent(id)}`, { body: changes });
}

/** Deletes a calendar and its events (not the default one). */
export async function deleteCalendar(client: DtClient, id: string): Promise<void> {
  await client.delete(`${CALENDAR}/calendars/${encodeURIComponent(id)}`);
}

/** Events showing between two moments (at most 400 days apart), repeats expanded. */
export async function listOccurrences(client: DtClient, start: Date, end: Date, timeZone: string): Promise<DtOccurrence[]> {
  const response = record(await client.get<unknown>(`${CALENDAR}/events`, { query: { start: instant(start), end: instant(end), tz: timeZone } }));
  return list(response.occurrences).flatMap((item) => occurrenceOf(item) ?? []);
}

/** A new or changed event as DeepTutor takes it. */
export interface DtEventInput {
  calendarId?: string | null;
  title: string;
  notes?: string;
  location?: string;
  allDay: boolean;
  /** All-day: YYYY-MM-DD with an exclusive end. Timed: instants (see `instant`). */
  start: string;
  end: string;
  tzid: string;
  rrule?: string | null;
  reminders?: number[];
  color?: string | null;
  taskId?: string | null;
}

function eventBody(input: Partial<DtEventInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.calendarId !== undefined && input.calendarId !== null) body.calendar_id = input.calendarId;
  if (input.title !== undefined) body.title = input.title.trim();
  if (input.notes !== undefined) body.notes = input.notes;
  if (input.location !== undefined) body.location = input.location.trim();
  if (input.allDay !== undefined) body.all_day = input.allDay;
  if (input.start !== undefined) body.start = input.start;
  if (input.end !== undefined) body.end = input.end;
  if (input.tzid !== undefined) body.tzid = input.tzid;
  // null clears a repeat, a colour or a task link.
  if (input.rrule !== undefined) body.rrule = input.rrule;
  if (input.reminders !== undefined) body.reminders = input.reminders;
  if (input.color !== undefined) body.color = input.color;
  if (input.taskId !== undefined) {
    body.task_id = input.taskId;
    body.task_workspace_id = input.taskId === null ? null : '';
  }
  return body;
}

/** A showing as an editable event (times normalised as `instant` writes them). */
export function occurrenceInput(occurrence: DtOccurrence): DtEventInput {
  return {
    calendarId: occurrence.calendarId || null,
    title: occurrence.title,
    notes: occurrence.notes,
    location: occurrence.location,
    allDay: occurrence.allDay,
    start: occurrence.allDay ? occurrence.start : instant(new Date(occurrence.start)),
    end: occurrence.allDay ? occurrence.end : instant(new Date(occurrence.end)),
    tzid: occurrence.tzid,
    rrule: occurrence.rrule,
    reminders: occurrence.reminders,
    color: occurrence.color,
    taskId: occurrence.taskId,
  };
}

/**
 * What an edit changed, so a series hears only that. Times travel together: DeepTutor moves a
 * series by how far its start moved.
 */
export function eventChanges(before: DtEventInput, after: DtEventInput): Partial<DtEventInput> {
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof DtEventInput)[]) {
    if (key === 'tzid') continue;
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) changes[key] = after[key];
  }
  if ('start' in changes || 'end' in changes || 'allDay' in changes) Object.assign(changes, { start: after.start, end: after.end, allDay: after.allDay, tzid: after.tzid });
  return changes as Partial<DtEventInput>;
}

/** Creates an event; answers with its id. */
export async function createEvent(client: DtClient, input: DtEventInput): Promise<string> {
  const response = record((await client.send<unknown>('POST', `${CALENDAR}/events`, { body: eventBody(input) })).data);
  return text(record(response.event).id);
}

/** Which dates of a repeating event a change or delete covers. */
export type DtEventScope = 'this' | 'following' | 'all';

/** Changes an event; for a repeating one, this date, this and the following, or all of them. */
export async function updateEvent(client: DtClient, eventId: string, changes: Partial<DtEventInput>, scope: DtEventScope = 'all', occurrence?: string): Promise<void> {
  await client.send('PATCH', `${CALENDAR}/events/${encodeURIComponent(eventId)}`, {
    body: { changes: eventBody(changes), scope, ...(scope !== 'all' && occurrence ? { occurrence } : {}) },
  });
}

/** Deletes an event (or some of a series); the token undoes it for 15 minutes. */
export async function deleteEvent(client: DtClient, eventId: string, scope: DtEventScope = 'all', occurrence?: string): Promise<{ undoToken: string | null }> {
  const query: Record<string, string> = { scope };
  if (scope !== 'all' && occurrence) query.occurrence = occurrence;
  const response = record(await client.delete<unknown>(`${CALENDAR}/events/${encodeURIComponent(eventId)}`, { query }));
  return { undoToken: textOrNull(response.undo_token) };
}

export async function undoCalendarChange(client: DtClient, token: string): Promise<void> {
  await client.send('POST', `${CALENDAR}/undo/${encodeURIComponent(token)}`);
}

/** An event found by search, with when it next happens. */
export interface DtCalendarHit {
  id: string;
  title: string;
  location: string;
  allDay: boolean;
  start: string;
  /** The next showing's start, or null when a repeat has ended. */
  nextStart: string | null;
}

/** Events whose title, notes or place contain the words; coming ones first. */
export async function searchEvents(client: DtClient, query: string): Promise<DtCalendarHit[]> {
  const response = record(await client.get<unknown>(`${CALENDAR}/search`, { query: { q: query.trim(), limit: '50' } }));
  return list(response.events).flatMap((raw): DtCalendarHit[] => {
    const hit = record(raw);
    if (!text(hit.id)) return [];
    return [{ id: text(hit.id), title: text(hit.title), location: text(hit.location), allDay: hit.all_day === true, start: text(hit.start), nextStart: textOrNull(hit.next_start) }];
  });
}

export interface DtReviewDay {
  date: DateKey;
  mastery: number;
  practice: number;
}

export interface DtAutomationRun {
  id: string;
  jobId: string;
  name: string;
  message: string;
  /** UTC instant. */
  at: string;
  kind: 'at' | 'every' | 'cron';
  expr: string | null;
  everySeconds: number | null;
  sessionId: string | null;
}

export interface DtFootprintDay {
  date: DateKey;
  sessions: { id: string; title: string }[];
  sessionCount: number;
  practiceReviews: number;
  masteryEvidence: number;
}

export interface DtCalendarLayers {
  reviews: DtReviewDay[];
  automations: DtAutomationRun[];
  footprints: DtFootprintDay[];
}

/** What the workspace has scheduled between two moments, and the days you studied. */
export async function getCalendarLayers(client: DtClient, start: Date, end: Date, timeZone: string): Promise<DtCalendarLayers> {
  const response = record(await client.get<unknown>(`${CALENDAR}/layers`, { query: { start: instant(start), end: instant(end), tz: timeZone } }));
  return {
    reviews: list(response.reviews).flatMap((raw): DtReviewDay[] => {
      const day = record(raw);
      return text(day.date) ? [{ date: text(day.date), mastery: count(day.mastery), practice: count(day.practice) }] : [];
    }),
    automations: list(response.automations).flatMap((raw): DtAutomationRun[] => {
      const run = record(raw);
      if (!text(run.id) || !text(run.at)) return [];
      const kind = run.kind === 'every' || run.kind === 'cron' ? run.kind : 'at';
      return [
        {
          id: text(run.id),
          jobId: text(run.job_id),
          name: text(run.name),
          message: text(run.message),
          at: text(run.at),
          kind,
          expr: textOrNull(run.expr),
          everySeconds: typeof run.every_seconds === 'number' ? run.every_seconds : null,
          sessionId: textOrNull(run.session_id),
        },
      ];
    }),
    footprints: list(response.footprints).flatMap((raw): DtFootprintDay[] => {
      const day = record(raw);
      if (!text(day.date)) return [];
      return [
        {
          date: text(day.date),
          sessions: list(day.sessions).flatMap((item) => {
            const session = record(item);
            return text(session.id) ? [{ id: text(session.id), title: text(session.title) }] : [];
          }),
          sessionCount: count(day.session_count),
          practiceReviews: count(day.practice_reviews),
          masteryEvidence: count(day.mastery_evidence),
        },
      ];
    }),
  };
}

/** Stops an automation DeepTutor set up in a chat. */
export async function stopAutomation(client: DtClient, jobId: string): Promise<void> {
  await client.delete(`${CALENDAR}/automations/${encodeURIComponent(jobId)}`);
}

/** The bounds of a showing as local times: all-day ones from midnight to midnight. */
export function occurrenceBounds(occurrence: Pick<DtOccurrence, 'allDay' | 'start' | 'end'>): { start: Date; end: Date } {
  if (occurrence.allDay) return { start: fromDateKey(occurrence.start), end: fromDateKey(occurrence.end) };
  return { start: new Date(occurrence.start), end: new Date(occurrence.end) };
}

export type DtDayItem =
  | { kind: 'event'; key: string; title: string; color: string; allDay: boolean; start: Date; end: Date; occurrence: DtOccurrence; calendar?: DtCalendar }
  | { kind: 'task'; key: string; title: string; color: string; allDay: true; start: Date; end: Date; card: DtTaskCard }
  | { kind: 'review'; key: string; title: string; color: string; allDay: true; start: Date; end: Date; review: DtReviewDay }
  | { kind: 'automation'; key: string; title: string; color: string; allDay: false; start: Date; end: Date; run: DtAutomationRun };

export type DtLayerId = 'tasks' | 'reviews' | 'automations' | 'footprints';
export type DtLayerToggles = Record<DtLayerId, boolean>;
export const DT_ALL_LAYERS: DtLayerToggles = { tasks: true, reviews: true, automations: true, footprints: true };

/** Our colours for what DeepTutor schedules itself. */
export const DT_LAYER_COLORS = { review: '#0d9488', automation: '#7c3aed', event: '#2563eb' } as const;

/**
 * Everything to show day by day between `from` and `to` (exclusive): events of visible
 * calendars, tasks due, reviews coming due and automations. All-day items come first, then
 * the rest by time; something spanning days shows on each of them.
 */
export function itemsByDay(input: {
  occurrences: DtOccurrence[];
  calendars: DtCalendar[];
  cards: DtTaskCard[];
  taskColors: DtTaskColors;
  layers: DtCalendarLayers | null;
  toggles: DtLayerToggles;
  from: DateKey;
  to: DateKey;
}): Map<DateKey, DtDayItem[]> {
  const byId = new Map(input.calendars.map((calendar) => [calendar.id, calendar]));
  const items: DtDayItem[] = [];
  for (const occurrence of input.occurrences) {
    const calendar = byId.get(occurrence.calendarId);
    if (calendar && !calendar.visible) continue;
    const { start, end } = occurrenceBounds(occurrence);
    items.push({ kind: 'event', key: `event:${occurrence.id}`, title: occurrence.title, color: occurrence.color ?? calendar?.color ?? DT_LAYER_COLORS.event, allDay: occurrence.allDay, start, end, occurrence, calendar });
  }
  if (input.toggles.tasks) {
    for (const card of input.cards) {
      if (card.archived || !card.dueDate) continue;
      const start = fromDateKey(card.dueDate);
      items.push({ kind: 'task', key: `task:${card.id}`, title: card.title, color: input.taskColors[card.status], allDay: true, start, end: addDays(start, 1), card });
    }
  }
  if (input.layers && input.toggles.reviews) {
    for (const review of input.layers.reviews) {
      const total = review.mastery + review.practice;
      if (!total) continue;
      const start = fromDateKey(review.date);
      items.push({ kind: 'review', key: `review:${review.date}`, title: `${total} ${total === 1 ? 'review' : 'reviews'} due`, color: DT_LAYER_COLORS.review, allDay: true, start, end: addDays(start, 1), review });
    }
  }
  if (input.layers && input.toggles.automations) {
    for (const run of input.layers.automations) {
      const start = new Date(run.at);
      items.push({ kind: 'automation', key: `automation:${run.id}`, title: run.name || run.message, color: DT_LAYER_COLORS.automation, allDay: false, start, end: new Date(start.getTime() + 30 * 60_000), run });
    }
  }

  const days = new Map<DateKey, DtDayItem[]>();
  for (const item of items) {
    // The days it touches: an all-day end is exclusive; a timed one counts its last moment.
    const last = item.allDay ? addDays(item.end, -1) : new Date(Math.max(item.start.getTime(), item.end.getTime() - 1));
    const first = dateKey(item.start) < input.from ? input.from : dateKey(item.start);
    for (let day = first; day <= dateKey(last) && day < input.to; day = dateKey(addDays(fromDateKey(day), 1))) {
      const list = days.get(day) ?? [];
      list.push(item);
      days.set(day, list);
    }
  }
  for (const list of days.values()) {
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title));
  }
  return days;
}
