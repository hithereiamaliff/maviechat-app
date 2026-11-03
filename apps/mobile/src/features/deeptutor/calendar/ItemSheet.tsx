import {
  deleteEvent,
  describeReminder,
  describeRepeat,
  describeWhen,
  occurrenceBounds,
  stopAutomation,
  undoCalendarChange,
  updateTask,
  type DtDayItem,
  type DtEventScope,
  type DtOccurrence,
  type DtTaskBoard,
  type DtTaskCard,
} from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { dueLabel, STATUS_LABELS } from '@/features/deeptutor/tasks/TaskSheet';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

interface ItemSheetProps {
  item: DtDayItem | null;
  onClose: () => void;
  onEditEvent: (occurrence: DtOccurrence) => void;
  onEditTask: (card: DtTaskCard) => void;
  /** A task's title, for an event that blocks out time for it. */
  taskTitle: (id: string) => string | undefined;
}

const everyLabel = (seconds: number) =>
  seconds % 86400 === 0 ? `Every ${seconds / 86400} day(s)` : seconds % 3600 === 0 ? `Every ${seconds / 3600} hour(s)` : `Every ${Math.max(1, Math.round(seconds / 60))} minute(s)`;

/** What's on the calendar, in full, with what you can do with it. */
export function ItemSheet({ item, onClose, ...rest }: ItemSheetProps) {
  return (
    <Modal visible={item !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {item ? <ItemBody item={item} onClose={onClose} {...rest} /> : null}
    </Modal>
  );
}

function ItemBody({ item, onClose, onEditEvent, onEditTask, taskTitle }: ItemSheetProps & { item: DtDayItem }) {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'calendar'] });

  const removeEvent = (occurrence: DtOccurrence) => {
    const run = (scope: DtEventScope) =>
      void deleteEvent(client, occurrence.eventId, scope, occurrence.occurrence)
        .then(({ undoToken }) => {
          invalidate();
          onClose();
          toast(
            'Event deleted',
            'info',
            undoToken
              ? {
                  label: 'Undo',
                  onPress: () =>
                    void undoCalendarChange(client, undoToken)
                      .then(invalidate)
                      .catch((error: unknown) => toast(`Couldn't undo: ${describeError(error)}`, 'error')),
                }
              : undefined,
          );
        })
        .catch((error: unknown) => toast(`Couldn't delete it: ${describeError(error)}`, 'error'));
    if (occurrence.recurring) {
      Alert.alert('Delete a repeating event', 'Which dates should go?', [
        { text: 'This Event', style: 'destructive', onPress: () => run('this') },
        { text: 'This and Following', style: 'destructive', onPress: () => run('following') },
        { text: 'All Events', style: 'destructive', onPress: () => run('all') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else {
      Alert.alert(`Delete “${occurrence.title || 'Untitled'}”?`, 'You can undo this for a little while.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => run('all') },
      ]);
    }
  };

  const action = (icon: IconName, label: string, onPress: () => void, destructive = false) => (
    <Pressable key={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.action, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
      <Icon name={icon} size={18} color={destructive ? palette.danger : palette.text} />
      <Text style={[styles.actionText, { color: destructive ? palette.danger : palette.text }]}>{label}</Text>
    </Pressable>
  );
  const line = (icon: IconName, value: string) =>
    value ? (
      <View key={`${icon}:${value}`} style={styles.line}>
        <Icon name={icon} size={16} color={palette.textMuted} />
        <Text style={[styles.lineText, { color: palette.text }]}>{value}</Text>
      </View>
    ) : null;

  let kind = '';
  let body: React.ReactNode = null;
  let actions: React.ReactNode[] = [];
  if (item.kind === 'event') {
    const { occurrence, calendar } = item;
    const { start, end } = occurrenceBounds(occurrence);
    const blockFor = occurrence.taskId ? taskTitle(occurrence.taskId) : undefined;
    kind = occurrence.source === 'dito' ? 'Set up by DeepTutor' : 'Event';
    body = (
      <>
        {line('clock', describeWhen(start, end, occurrence.allDay))}
        {occurrence.rrule ? line('arrow-path', describeRepeat(occurrence.rrule, start)) : null}
        {calendar ? line('calendar', calendar.name) : null}
        {line('map', occurrence.location)}
        {occurrence.taskId ? line('view-columns', blockFor ? `Time set aside for “${blockFor}”` : 'Time set aside for a task') : null}
        {occurrence.reminders.map((minutes) => line('information-circle', describeReminder(minutes, occurrence.allDay)))}
        {occurrence.notes ? <Text style={[styles.notes, { color: palette.text }]}>{occurrence.notes}</Text> : null}
      </>
    );
    actions = [action('pencil', 'Edit', () => onEditEvent(occurrence)), action('trash', 'Delete', () => removeEvent(occurrence), true)];
  } else if (item.kind === 'task') {
    const { card } = item;
    kind = 'Task';
    body = (
      <>
        {line('view-columns', STATUS_LABELS[card.status])}
        {card.dueDate ? line('calendar', `Due ${dueLabel(card.dueDate)}`) : null}
        {card.note ? <Text style={[styles.notes, { color: palette.text }]}>{card.note}</Text> : null}
      </>
    );
    actions = [
      action(card.status === 'done' ? 'arrow-path' : 'check', card.status === 'done' ? 'Reopen' : 'Mark Done', () =>
        void updateTask(client, card.id, { status: card.status === 'done' ? 'todo' : 'done' })
          .then((board: DtTaskBoard) => {
            queryClient.setQueryData([DT_QUERY_ROOT, session.baseUrl, 'task-board'], board);
            onClose();
          })
          .catch((error: unknown) => toast(`Couldn't change it: ${describeError(error)}`, 'error')),
      ),
      action('pencil', 'Edit Task', () => onEditTask(card)),
      action('view-columns', 'Open Task Board', () => {
        onClose();
        router.replace('/learn/tasks');
      }),
    ];
  } else if (item.kind === 'review') {
    const { review } = item;
    kind = 'Reviews due';
    body = (
      <>
        {review.practice ? line('question-mark-circle', `${review.practice} from your question bank`) : null}
        {review.mastery ? line('academic-cap', `${review.mastery} in your learning paths`) : null}
        <Text style={[styles.hint, { color: palette.textMuted }]}>DeepTutor brings questions back on a schedule so you remember them.</Text>
      </>
    );
    actions = [
      action('arrow-path', 'Practise Now', () => {
        onClose();
        router.replace('/learn/practice');
      }),
    ];
  } else {
    const { run } = item;
    kind = 'Automation';
    body = (
      <>
        {line('clock', new Date(run.at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}
        {line('arrow-path', run.kind === 'every' && run.everySeconds ? everyLabel(run.everySeconds) : run.kind === 'cron' && run.expr ? `On the schedule ${run.expr}` : 'Once')}
        {run.message && run.message !== run.name ? <Text style={[styles.notes, { color: palette.text }]}>{run.message}</Text> : null}
        <Text style={[styles.hint, { color: palette.textMuted }]}>DeepTutor set this up in a chat and runs it at that time.</Text>
      </>
    );
    actions = [
      ...(run.sessionId
        ? [
            action('chat-bubble-left', 'Open Chat', () => {
              onClose();
              router.replace({ pathname: '/learn/[id]', params: { id: run.sessionId as string } });
            }),
          ]
        : []),
      action(
        'stop-circle',
        'Stop Automation',
        () =>
          Alert.alert('Stop this automation?', 'It stops for good; DeepTutor can set it up again in a chat.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Stop',
              style: 'destructive',
              onPress: () =>
                void stopAutomation(client, run.jobId)
                  .then(() => {
                    invalidate();
                    onClose();
                  })
                  .catch((error: unknown) => toast(`Couldn't stop it: ${describeError(error)}`, 'error')),
            },
          ]),
        true,
      ),
    ];
  }

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <View style={[styles.swatch, { backgroundColor: item.color }]} />
        <Text style={[styles.kind, { color: palette.textMuted }]}>{kind}</Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={[styles.done, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {item.title || 'Untitled'}
        </Text>
        {body}
        <View style={styles.actions}>{actions}</View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  kind: { flex: 1, fontFamily: fonts.medium, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 10 },
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, marginBottom: 4 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  lineText: { flex: 1, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  notes: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, marginTop: 6 },
  hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginTop: 4 },
  actions: { gap: 8, marginTop: 16 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12 },
  actionText: { fontFamily: fonts.medium, fontSize: 15 },
});
