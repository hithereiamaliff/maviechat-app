/*
 * Calendar days, repeats and reminders as DeepTutor's calendar (1.7.1) stores them: all-day
 * events use plain days with an exclusive end; timed ones UTC instants; repeats are RFC 5545
 * RRULE values; reminders are minutes before the start (an all-day event starts at midnight,
 * so -540 is 09:00 on the day).
 */

/** A local calendar day, `YYYY-MM-DD`. */
export type DateKey = string;

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

export function dateKey(date: Date): DateKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of the day. */
export function fromDateKey(key: DateKey): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/** Whole calendar days later (a daylight-saving change doesn't move the clock time). */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export const addDaysKey = (key: DateKey, days: number): DateKey => dateKey(addDays(fromDateKey(key), days));

/** The day the week starts on; Monday unless told otherwise (0 is Sunday). */
export function startOfWeek(date: Date, firstDay = 1): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return addDays(start, -((start.getDay() - firstDay + 7) % 7));
}

/** A month as six weeks of days, from the start of the week holding the 1st. */
export function monthWeeks(year: number, month: number, firstDay = 1): DateKey[][] {
  const first = startOfWeek(new Date(year, month, 1), firstDay);
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => dateKey(addDays(first, week * 7 + day))));
}

/** The phone's time zone, which DeepTutor stores with each timed event. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** An instant as DeepTutor takes it: ISO-8601 in UTC, to the second. */
export const instant = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export type RepeatPreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'monthlyWeekday' | 'yearly' | 'custom';
export type RepeatEnd = { kind: 'never' } | { kind: 'until'; date: DateKey } | { kind: 'count'; count: number };

/** Which of its weekday's dates in the month a day is: 1 to 4, or -1 for the last (a fifth). */
export function weekdayOrdinal(date: Date): number {
  const nth = Math.floor((date.getDate() - 1) / 7) + 1;
  return nth === 5 ? -1 : nth;
}

function untilValue(date: DateKey, allDay: boolean): string {
  if (allDay) return date.replace(/-/g, '');
  // The last second of that local day, in UTC, as RFC 5545 wants for timed events.
  const last = new Date(fromDateKey(addDaysKey(date, 1)).getTime() - 1000);
  return `${last.getUTCFullYear()}${pad(last.getUTCMonth() + 1)}${pad(last.getUTCDate())}T${pad(last.getUTCHours())}${pad(last.getUTCMinutes())}${pad(last.getUTCSeconds())}Z`;
}

/** The RRULE for a preset starting on `start`, or null for no repeat. */
export function repeatRule(preset: RepeatPreset, start: Date, allDay: boolean, end: RepeatEnd = { kind: 'never' }): string | null {
  const day = WEEKDAY_CODES[start.getDay()];
  const parts: Record<Exclude<RepeatPreset, 'none' | 'custom'>, string[]> = {
    daily: ['FREQ=DAILY'],
    weekdays: ['FREQ=WEEKLY', 'BYDAY=MO,TU,WE,TH,FR'],
    weekly: ['FREQ=WEEKLY', `BYDAY=${day}`],
    monthly: ['FREQ=MONTHLY'],
    monthlyWeekday: ['FREQ=MONTHLY', `BYDAY=${weekdayOrdinal(start)}${day}`],
    yearly: ['FREQ=YEARLY'],
  };
  if (preset === 'none' || preset === 'custom') return null;
  const rule = [...parts[preset]];
  if (end.kind === 'count') rule.push(`COUNT=${Math.max(1, Math.floor(end.count))}`);
  if (end.kind === 'until') rule.push(`UNTIL=${untilValue(end.date, allDay)}`);
  return rule.join(';');
}

function ruleParts(rrule: string | null | undefined): Map<string, string> {
  const parts = new Map<string, string>();
  for (const part of (rrule ?? '').replace(/^RRULE:/i, '').split(';')) {
    const [name, value] = part.split('=');
    if (name && value !== undefined) parts.set(name.trim().toUpperCase(), value.trim().toUpperCase());
  }
  return parts;
}

/** The preset a stored rule is, or `custom` for anything the presets can't say. */
export function repeatPresetOf(rrule: string | null | undefined, start: Date): RepeatPreset {
  if (!rrule) return 'none';
  const parts = ruleParts(rrule);
  const known = new Set(['FREQ', 'BYDAY', 'COUNT', 'UNTIL', 'INTERVAL', 'WKST']);
  if ([...parts.keys()].some((name) => !known.has(name)) || (parts.get('INTERVAL') ?? '1') !== '1') return 'custom';
  const byDay = parts.get('BYDAY');
  const day = WEEKDAY_CODES[start.getDay()];
  switch (parts.get('FREQ')) {
    case 'DAILY':
      return byDay ? 'custom' : 'daily';
    case 'WEEKLY':
      if (byDay === 'MO,TU,WE,TH,FR') return 'weekdays';
      return !byDay || byDay === day ? 'weekly' : 'custom';
    case 'MONTHLY':
      if (!byDay) return 'monthly';
      return byDay === `${weekdayOrdinal(start)}${day}` ? 'monthlyWeekday' : 'custom';
    case 'YEARLY':
      return byDay ? 'custom' : 'yearly';
    default:
      return 'custom';
  }
}

/** How a stored rule ends. */
export function repeatEndOf(rrule: string | null | undefined): RepeatEnd {
  const parts = ruleParts(rrule);
  const count = Number(parts.get('COUNT'));
  if (Number.isInteger(count) && count > 0) return { kind: 'count', count };
  const until = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(parts.get('UNTIL') ?? '');
  if (!until) return { kind: 'never' };
  const [, year, month, day, hour, minute, second, utc] = until;
  if (!hour) return { kind: 'until', date: `${year}-${month}-${day}` };
  const moment = utc ? new Date(Date.UTC(+year!, +month! - 1, +day!, +hour, +minute!, +second!)) : new Date(+year!, +month! - 1, +day!, +hour, +minute!, +second!);
  return { kind: 'until', date: dateKey(moment) };
}

const ORDINALS: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' };

/** The repeat in words: "Every weekday", "Monthly on the first Tuesday, 5 times"… */
export function describeRepeat(rrule: string | null | undefined, start: Date, locale?: string): string {
  const preset = repeatPresetOf(rrule, start);
  const weekday = start.toLocaleDateString(locale, { weekday: 'long' });
  const base: Record<RepeatPreset, string> = {
    none: 'Does not repeat',
    daily: 'Every day',
    weekdays: 'Every weekday (Monday to Friday)',
    weekly: `Weekly on ${weekday}`,
    monthly: `Monthly on day ${start.getDate()}`,
    monthlyWeekday: `Monthly on the ${ORDINALS[weekdayOrdinal(start)]} ${weekday}`,
    yearly: `Every year on ${start.toLocaleDateString(locale, { day: 'numeric', month: 'long' })}`,
    custom: 'Repeats (custom)',
  };
  if (preset === 'none') return base.none;
  const end = repeatEndOf(rrule);
  if (end.kind === 'count') return `${base[preset]}, ${end.count} ${end.count === 1 ? 'time' : 'times'}`;
  if (end.kind === 'until') return `${base[preset]}, until ${fromDateKey(end.date).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return base[preset];
}

/** Reminder choices, as minutes before the start. */
export const TIMED_REMINDERS: readonly number[] = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
/** For all-day events: 09:00 on the day, 09:00 one, two and seven days before. */
export const ALL_DAY_REMINDERS: readonly number[] = [-540, 900, 2340, 9540];
export const MAX_REMINDERS = 5;

function clock(minutesAfterMidnight: number, locale?: string): string {
  return new Date(2000, 0, 1, 0, minutesAfterMidnight).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'} before`;

/** A reminder in words: "10 minutes before", "The day before at 09:00"… */
export function describeReminder(minutes: number, allDay: boolean, locale?: string): string {
  if (allDay) {
    if (minutes <= 0) return `On the day at ${clock(-minutes, locale)}`;
    const days = Math.ceil(minutes / 1440);
    const time = clock(days * 1440 - minutes, locale);
    return days === 1 ? `The day before at ${time}` : `${days} days before at ${time}`;
  }
  if (minutes === 0) return 'At the start time';
  if (minutes % 10080 === 0) return plural(minutes / 10080, 'week');
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'day');
  if (minutes % 60 === 0) return plural(minutes / 60, 'hour');
  return plural(minutes, 'minute');
}

/** "Tue 3 Nov · 09:00 – 10:00", "Tue 3 – Thu 5 Nov", or across midnight with both days. */
export function describeWhen(start: Date, end: Date, allDay: boolean, locale?: string): string {
  const day = (date: Date) => date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = (date: Date) => date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (allDay) {
    const last = addDays(end, -1);
    return dateKey(last) <= dateKey(start) ? day(start) : `${day(start)} – ${day(last)}`;
  }
  const lastMoment = new Date(Math.max(start.getTime(), end.getTime() - 1));
  if (dateKey(lastMoment) === dateKey(start)) return `${day(start)} · ${time(start)} – ${time(end)}`;
  return `${day(start)} ${time(start)} – ${day(end)} ${time(end)}`;
}
