import { dateKey, type DateKey } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, radius, usePalette } from '@/theme';
import { monthOf, MonthGrid } from './MonthGrid';

function Card({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const palette = usePalette();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.card, { backgroundColor: palette.menu, borderColor: palette.border }]}>{children}</View>
      </View>
    </Modal>
  );
}

function Action({ label, onPress, strong = false }: { label: string; onPress: () => void; strong?: boolean }) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6} style={styles.action}>
      <Text style={[strong ? styles.actionStrong : styles.actionText, { color: palette.link }]}>{label}</Text>
    </Pressable>
  );
}

/** Picks a day from a month; Clear is offered when the day is optional (a task's due date). */
export function DatePicker({ visible, value, onPick, onClose, onClear }: { visible: boolean; value: DateKey | null; onPick: (key: DateKey) => void; onClose: () => void; onClear?: () => void }) {
  return (
    <Card visible={visible} onClose={onClose}>
      {visible ? <DateBody value={value} onPick={onPick} onClose={onClose} onClear={onClear} /> : null}
    </Card>
  );
}

function DateBody({ value, onPick, onClose, onClear }: { value: DateKey | null; onPick: (key: DateKey) => void; onClose: () => void; onClear?: () => void }) {
  const today = dateKey(new Date());
  const [cursor, setCursor] = useState(() => monthOf(value ?? today));
  const pick = (key: DateKey) => {
    onPick(key);
    onClose();
  };
  return (
    <>
      <MonthGrid cursor={cursor} onCursor={setCursor} selected={value} onSelect={pick} today={today} compact />
      <View style={styles.actions}>
        {onClear ? (
          <Action
            label="Clear"
            onPress={() => {
              onClear();
              onClose();
            }}
          />
        ) : null}
        <Action label="Today" onPress={() => pick(today)} />
        <View style={styles.spacer} />
        <Action label="Cancel" onPress={onClose} />
      </View>
    </>
  );
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 12 }, (_, index) => index * 5);
const two = (value: number) => String(value).padStart(2, '0');

/** Picks a time of day: an hour, then minutes in steps of five. */
export function TimePicker({ visible, hour, minute, onPick, onClose }: { visible: boolean; hour: number; minute: number; onPick: (hour: number, minute: number) => void; onClose: () => void }) {
  return (
    <Card visible={visible} onClose={onClose}>
      {visible ? <TimeBody hour={hour} minute={minute} onPick={onPick} onClose={onClose} /> : null}
    </Card>
  );
}

function TimeBody({ hour: initialHour, minute: initialMinute, onPick, onClose }: { hour: number; minute: number; onPick: (hour: number, minute: number) => void; onClose: () => void }) {
  const palette = usePalette();
  const [hour, setHour] = useState(initialHour);
  const [minute, setMinute] = useState(initialMinute);
  // A time that isn't on the five-minute grid keeps its own minute as a choice.
  const minutes = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort((a, b) => a - b);
  const chip = (label: string, selected: boolean, onPress: () => void, accessibilityLabel: string) => (
    <Pressable
      key={accessibilityLabel}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.chip, { borderColor: palette.border }, selected && { backgroundColor: palette.active, borderColor: palette.active }]}>
      <Text style={[styles.chipText, { color: selected ? palette.onActive : palette.text }]}>{label}</Text>
    </Pressable>
  );
  return (
    <>
      <Text style={[styles.time, { color: palette.text }]} accessibilityRole="header">
        {new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </Text>
      <Text style={[styles.label, { color: palette.textMuted }]}>Hour</Text>
      <View style={styles.chips}>{HOURS.map((value) => chip(two(value), value === hour, () => setHour(value), `${value} hours`))}</View>
      <Text style={[styles.label, { color: palette.textMuted }]}>Minute</Text>
      <View style={styles.chips}>{minutes.map((value) => chip(`:${two(value)}`, value === minute, () => setMinute(value), `${value} minutes`))}</View>
      <View style={styles.actions}>
        <View style={styles.spacer} />
        <Action label="Cancel" onPress={onClose} />
        <Action
          label="Done"
          strong
          onPress={() => {
            onPick(hour, minute);
            onClose();
          }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 380, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 12, paddingHorizontal: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingTop: 8 },
  action: { paddingHorizontal: 10, paddingVertical: 8 },
  actionText: { fontFamily: fonts.medium, fontSize: 15 },
  actionStrong: { fontFamily: fonts.semibold, fontSize: 15 },
  spacer: { flex: 1 },
  time: { fontFamily: fonts.semibold, fontSize: 24, textAlign: 'center', paddingVertical: 6 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 10, marginTop: 8, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 8 },
  chip: { width: 50, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingVertical: 7 },
  chipText: { fontFamily: fonts.medium, fontSize: 14 },
});
