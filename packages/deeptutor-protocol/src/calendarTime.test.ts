import { describe, expect, it } from 'vitest';
import { addDaysKey, dateKey, describeReminder, describeRepeat, fromDateKey, monthWeeks, repeatEndOf, repeatPresetOf, repeatRule, startOfWeek, weekdayOrdinal } from './calendarTime';

describe('calendar days', () => {
  it('works in local days', () => {
    expect(dateKey(new Date(2026, 10, 3, 23, 30))).toBe('2026-11-03');
    expect(fromDateKey('2026-11-03').getDate()).toBe(3);
    expect(addDaysKey('2026-10-31', 1)).toBe('2026-11-01');
    expect(dateKey(startOfWeek(new Date(2026, 10, 3)))).toBe('2026-11-02');
    expect(dateKey(startOfWeek(new Date(2026, 10, 3), 0))).toBe('2026-11-01');
  });

  it('lays a month out as six weeks from Monday', () => {
    const weeks = monthWeeks(2026, 10);
    expect(weeks).toHaveLength(6);
    expect(weeks[0]![0]).toBe('2026-10-26');
    expect(weeks[0]![6]).toBe('2026-11-01');
    expect(weeks[5]![6]).toBe('2026-12-06');
  });
});

describe('repeats', () => {
  const tuesday = new Date(2026, 10, 3, 9);
  it('writes and recognises each preset', () => {
    expect(repeatRule('daily', tuesday, false)).toBe('FREQ=DAILY');
    expect(repeatRule('weekdays', tuesday, false)).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(repeatRule('weekly', tuesday, false)).toBe('FREQ=WEEKLY;BYDAY=TU');
    expect(repeatRule('monthlyWeekday', tuesday, false)).toBe('FREQ=MONTHLY;BYDAY=1TU');
    expect(repeatRule('none', tuesday, false)).toBeNull();
    for (const preset of ['daily', 'weekdays', 'weekly', 'monthly', 'monthlyWeekday', 'yearly'] as const) {
      expect(repeatPresetOf(repeatRule(preset, tuesday, false), tuesday)).toBe(preset);
    }
    expect(repeatPresetOf('FREQ=WEEKLY;INTERVAL=2', tuesday)).toBe('custom');
    expect(repeatPresetOf('FREQ=WEEKLY;BYDAY=WE', tuesday)).toBe('custom');
    expect(weekdayOrdinal(new Date(2026, 10, 30))).toBe(-1);
  });

  it('ends after a count or on a day', () => {
    expect(repeatRule('daily', tuesday, true, { kind: 'count', count: 3 })).toBe('FREQ=DAILY;COUNT=3');
    expect(repeatRule('daily', tuesday, true, { kind: 'until', date: '2026-11-30' })).toBe('FREQ=DAILY;UNTIL=20261130');
    const timed = repeatRule('daily', tuesday, false, { kind: 'until', date: '2026-11-30' })!;
    expect(timed).toMatch(/^FREQ=DAILY;UNTIL=\d{8}T\d{6}Z$/);
    expect(repeatEndOf(timed)).toEqual({ kind: 'until', date: '2026-11-30' });
    expect(repeatEndOf('FREQ=DAILY;COUNT=3')).toEqual({ kind: 'count', count: 3 });
    expect(repeatEndOf('FREQ=DAILY')).toEqual({ kind: 'never' });
  });

  it('says it in words', () => {
    expect(describeRepeat(null, tuesday, 'en-GB')).toBe('Does not repeat');
    expect(describeRepeat('FREQ=WEEKLY;BYDAY=TU;COUNT=5', tuesday, 'en-GB')).toBe('Weekly on Tuesday, 5 times');
    expect(describeRepeat('FREQ=MONTHLY;BYDAY=1TU', tuesday, 'en-GB')).toBe('Monthly on the first Tuesday');
  });
});

describe('reminders', () => {
  it('words timed and all-day reminders', () => {
    expect(describeReminder(0, false)).toBe('At the start time');
    expect(describeReminder(10, false)).toBe('10 minutes before');
    expect(describeReminder(60, false)).toBe('1 hour before');
    expect(describeReminder(2880, false)).toBe('2 days before');
    expect(describeReminder(10080, false)).toBe('1 week before');
    expect(describeReminder(-540, true, 'en-GB')).toBe('On the day at 09:00');
    expect(describeReminder(900, true, 'en-GB')).toBe('The day before at 09:00');
    expect(describeReminder(2340, true, 'en-GB')).toBe('2 days before at 09:00');
  });
});
