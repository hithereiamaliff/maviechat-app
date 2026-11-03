import { addDays, fromDateKey, monthWeeks, startOfWeek, type DateKey } from '@maviechat/deeptutor-protocol';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconButton } from '@/components/IconButton';
import { fonts, usePalette } from '@/theme';

export interface MonthCursor {
  year: number;
  /** 0 to 11. */
  month: number;
}

export const monthOf = (key: DateKey): MonthCursor => {
  const date = fromDateKey(key);
  return { year: date.getFullYear(), month: date.getMonth() };
};

export const shiftMonth = ({ year, month }: MonthCursor, by: number): MonthCursor => {
  const date = new Date(year, month + by, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
};

/** Mon … Sun in the phone's language, one letter each. */
const WEEKDAYS = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(new Date(2026, 0, 5)), index).toLocaleDateString(undefined, { weekday: 'narrow' }));

interface MonthGridProps {
  cursor: MonthCursor;
  onCursor: (cursor: MonthCursor) => void;
  selected: DateKey | null;
  onSelect: (key: DateKey) => void;
  today: DateKey;
  /** Up to three colours of what's on each day. */
  marks?: Map<DateKey, string[]>;
  /** Days you studied (a footprint): a small ring under the date. */
  studied?: Set<DateKey>;
  /** Smaller, for a picker. */
  compact?: boolean;
}

/** A month: its name with ‹ ›, then six weeks from Monday; each day can carry dots of colour. */
export function MonthGrid({ cursor, onCursor, selected, onSelect, today, marks, studied, compact = false }: MonthGridProps) {
  const palette = usePalette();
  const weeks = monthWeeks(cursor.year, cursor.month);
  const title = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return (
    <View style={styles.grid}>
      <View style={styles.header}>
        <Text style={[styles.title, compact && styles.titleCompact, { color: palette.text }]} accessibilityRole="header">
          {title}
        </Text>
        <IconButton icon="chevron-left" label="Previous month" size={18} onPress={() => onCursor(shiftMonth(cursor, -1))} />
        <IconButton icon="chevron-right" label="Next month" size={18} onPress={() => onCursor(shiftMonth(cursor, 1))} />
      </View>
      <View style={styles.week}>
        {WEEKDAYS.map((label, index) => (
          <Text key={index} style={[styles.weekday, { color: palette.textFaint }]}>
            {label}
          </Text>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0]} style={styles.week}>
          {week.map((key) => {
            const date = fromDateKey(key);
            const inMonth = date.getMonth() === cursor.month;
            const isSelected = key === selected;
            const isToday = key === today;
            const dots = marks?.get(key) ?? [];
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={`${date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${dots.length ? `, ${dots.length === 1 ? 'something' : 'several things'} on` : ''}${isToday ? ', today' : ''}`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelect(key)}
                style={[styles.day, compact && styles.dayCompact]}>
                <View
                  style={[
                    styles.number,
                    compact && styles.numberCompact,
                    isSelected && { backgroundColor: palette.active },
                    !isSelected && isToday && { borderColor: palette.text, borderWidth: 1 },
                  ]}>
                  <Text style={[styles.numberText, { color: isSelected ? palette.onActive : inMonth ? palette.text : palette.textFaint }, isToday && styles.today]}>{date.getDate()}</Text>
                </View>
                {compact ? null : (
                  <View style={styles.dots}>
                    {dots.slice(0, 3).map((color, index) => (
                      <View key={index} style={[styles.dot, { backgroundColor: color, opacity: inMonth ? 1 : 0.4 }]} />
                    ))}
                    {dots.length === 0 && studied?.has(key) ? <View style={[styles.ring, { borderColor: palette.textFaint }]} /> : null}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { paddingHorizontal: 8 },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingBottom: 4 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 17 },
  titleCompact: { fontSize: 15 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontFamily: fonts.medium, fontSize: 11, paddingVertical: 4 },
  day: { flex: 1, alignItems: 'center', paddingVertical: 3, minHeight: 46 },
  dayCompact: { minHeight: 38 },
  number: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  numberCompact: { width: 30, height: 30, borderRadius: 15 },
  numberText: { fontFamily: fonts.regular, fontSize: 15 },
  today: { fontFamily: fonts.semibold },
  dots: { flexDirection: 'row', gap: 3, height: 6, marginTop: 2, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  ring: { width: 5, height: 5, borderRadius: 2.5, borderWidth: 1 },
});
