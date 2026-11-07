import { createCalendar, deleteCalendar, updateCalendar, type DtCalendar, type DtLayerId, type DtLayerToggles } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { MenuButton } from '@/components/Menu';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { showPrompt } from '@/components/dialogs';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

const LAYERS: { id: DtLayerId; label: string; hint: string }[] = [
  { id: 'tasks', label: 'Tasks due', hint: 'From the Task Board' },
  { id: 'reviews', label: 'Reviews due', hint: 'Practice questions coming back' },
  { id: 'automations', label: 'Automations', hint: 'What DeepTutor runs on a schedule' },
  { id: 'footprints', label: 'Study footprints', hint: 'Days you chatted or practised' },
];
/** Colours a new calendar takes, in turn. */
const NEW_COLORS = ['#0891b2', '#16a34a', '#ea580c', '#db2777', '#7c3aed', '#ca8a04', '#475569'];

interface CalendarsSheetProps {
  visible: boolean;
  onClose: () => void;
  calendars: DtCalendar[];
  layers: DtLayerToggles;
  onLayers: (layers: DtLayerToggles) => void;
}

/** Which calendars show, adding and renaming them, and what else the calendar shows. */
export function CalendarsSheet({ visible, onClose, calendars, layers, onLayers }: CalendarsSheetProps) {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'calendar'] });
  const fail = (what: string) => (error: unknown) => toast(`Couldn't ${what}: ${describeError(error)}`, 'error');

  const add = () =>
    showPrompt('New Calendar', 'A name for it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Add',
        onPress: (value?: string) => {
          const name = value?.trim();
          if (!name) return;
          void createCalendar(client, { name: name.slice(0, 80), color: NEW_COLORS[calendars.length % NEW_COLORS.length]! })
            .then(refresh)
            .catch(fail('add it'));
        },
      },
    ]);
  const rename = (calendar: DtCalendar) =>
    showPrompt(
      'Rename Calendar',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: (value?: string) => {
            const name = value?.trim();
            if (name && name !== calendar.name) void updateCalendar(client, calendar.id, { name: name.slice(0, 80) }).then(refresh).catch(fail('rename it'));
          },
        },
      ],
      'plain-text',
      calendar.name,
    );
  const remove = (calendar: DtCalendar) =>
    Alert.alert(`Delete “${calendar.name}”?`, 'Its events are deleted with it. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteCalendar(client, calendar.id).then(refresh).catch(fail('delete it')) },
    ]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            Calendars
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
            <Text style={[styles.done, { color: palette.link }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {calendars.map((calendar) => (
            <View key={calendar.id} style={[styles.row, { borderBottomColor: palette.border }]}>
              <View style={[styles.swatch, { backgroundColor: calendar.color }]} />
              <View style={styles.rowText}>
                <Text style={[styles.label, { color: palette.text }]} numberOfLines={1}>
                  {calendar.name}
                </Text>
                {calendar.isDefault ? <Text style={[styles.hint, { color: palette.textFaint }]}>Default: new events go here</Text> : null}
              </View>
              <Switch
                value={calendar.visible}
                onValueChange={(visibleNow) => void updateCalendar(client, calendar.id, { visible: visibleNow }).then(refresh).catch(fail('change it'))}
                accessibilityLabel={`Show ${calendar.name}`}
              />
              <MenuButton
                label={`Options for ${calendar.name}`}
                size={18}
                color={palette.textMuted}
                items={[
                  { key: 'rename', label: 'Rename', icon: 'pencil', onPress: () => rename(calendar) },
                  ...(calendar.isDefault ? [] : [{ key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => remove(calendar) }]),
                ]}
              />
            </View>
          ))}
          <Pressable accessibilityRole="button" onPress={add} style={styles.add} hitSlop={4}>
            <Icon name="plus" size={16} color={palette.link} />
            <Text style={[styles.addText, { color: palette.link }]}>New Calendar</Text>
          </Pressable>

          <Text style={[styles.section, { color: palette.textMuted }]}>Also show</Text>
          {LAYERS.map((layer) => (
            <View key={layer.id} style={[styles.row, { borderBottomColor: palette.border }]}>
              <View style={styles.rowText}>
                <Text style={[styles.label, { color: palette.text }]}>{layer.label}</Text>
                <Text style={[styles.hint, { color: palette.textFaint }]}>{layer.hint}</Text>
              </View>
              <Switch value={layers[layer.id]} onValueChange={(on) => onLayers({ ...layers, [layer.id]: on })} accessibilityLabel={`Show ${layer.label}`} />
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  swatch: { width: 14, height: 14, borderRadius: 7 },
  rowText: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.medium, fontSize: 15 },
  hint: { fontFamily: fonts.regular, fontSize: 12 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 14 },
  addText: { fontFamily: fonts.medium, fontSize: 15 },
  section: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 20, marginBottom: 4 },
});
