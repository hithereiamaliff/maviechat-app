import { createTask, DT_TASK_NOTE_MAX, DT_TASK_STATUSES, DT_TASK_TITLE_MAX, fromDateKey, updateTask, type DtTaskBoard, type DtTaskCard, type DtTaskStatus } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { DatePicker } from '@/features/deeptutor/calendar/Pickers';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

export const STATUS_LABELS: Record<DtTaskStatus, string> = { todo: 'To do', doing: 'In progress', done: 'Done' };

export const dueLabel = (key: string) => fromDateKey(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

interface TaskSheetProps {
  /** A card to edit, `'new'` for a new one (optionally due on a day), or null when closed. */
  task: DtTaskCard | { new: true; dueDate?: string | null } | null;
  onClose: () => void;
  colors?: DtTaskBoard['colors'];
  linkedChats?: number;
}

/** A task: its title, note and due day, and (for one that exists) its column; saved together. */
export function TaskSheet({ task, onClose, colors, linkedChats = 0 }: TaskSheetProps) {
  return (
    <Modal visible={task !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {task ? <TaskBody key={'id' in task ? task.id : 'new'} task={task} onClose={onClose} colors={colors} linkedChats={linkedChats} /> : null}
    </Modal>
  );
}

function TaskBody({ task, onClose, colors, linkedChats }: { task: DtTaskCard | { new: true; dueDate?: string | null }; onClose: () => void; colors?: DtTaskBoard['colors']; linkedChats: number }) {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const existing = 'id' in task ? task : null;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [dueDate, setDueDate] = useState<string | null>(existing ? existing.dueDate : (task as { dueDate?: string | null }).dueDate ?? null);
  const [status, setStatus] = useState<DtTaskStatus>(existing?.status ?? 'todo');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<'save' | 'archive' | null>(null);
  const keep = (board: DtTaskBoard) => queryClient.setQueryData([DT_QUERY_ROOT, session.baseUrl, 'task-board'], board);

  const save = async () => {
    if (!title.trim()) return;
    setBusy('save');
    try {
      if (existing) {
        const changes: Parameters<typeof updateTask>[2] = {};
        if (title.trim() !== existing.title) changes.title = title;
        if (note !== existing.note) changes.note = note;
        if (dueDate !== existing.dueDate) changes.dueDate = dueDate;
        if (status !== existing.status) changes.status = status;
        if (Object.keys(changes).length) keep(await updateTask(client, existing.id, changes));
      } else {
        keep(await createTask(client, { title, note, dueDate }));
      }
      onClose();
    } catch (error) {
      toast(`Couldn't save the task: ${describeError(error)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const archive = async () => {
    if (!existing) return;
    setBusy('archive');
    try {
      keep(await updateTask(client, existing.id, { archived: !existing.archived }));
      toast(existing.archived ? 'Restored to the board' : 'Archived. Show Archived lists it.', 'success');
      onClose();
    } catch (error) {
      toast(`Couldn't ${existing.archived ? 'restore' : 'archive'} it: ${describeError(error)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const input = [styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={[styles.link, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {existing ? 'Task' : 'New Task'}
        </Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Task title"
          placeholderTextColor={palette.textFaint}
          maxLength={DT_TASK_TITLE_MAX}
          autoFocus={!existing}
          style={[input, styles.titleInput]}
          accessibilityLabel="Task title"
        />
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Short note (optional)"
          placeholderTextColor={palette.textFaint}
          maxLength={DT_TASK_NOTE_MAX}
          multiline
          textAlignVertical="top"
          style={[input, styles.note]}
          accessibilityLabel="Task note"
        />
        <Text style={[styles.label, { color: palette.textMuted }]}>Due</Text>
        <Pressable accessibilityRole="button" onPress={() => setPicking(true)} style={({ pressed }) => [styles.row, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
          <Icon name="calendar" size={18} color={palette.textMuted} />
          <Text style={[styles.rowText, { color: dueDate ? palette.text : palette.textMuted }]}>{dueDate ? dueLabel(dueDate) : 'No due date'}</Text>
          {dueDate ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Remove due date" hitSlop={8} onPress={() => setDueDate(null)}>
              <Icon name="x-mark" size={16} color={palette.textMuted} />
            </Pressable>
          ) : null}
        </Pressable>
        {existing ? (
          <>
            <Text style={[styles.label, { color: palette.textMuted }]}>Column</Text>
            <View style={styles.statuses}>
              {DT_TASK_STATUSES.map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: value === status }}
                  onPress={() => setStatus(value)}
                  style={[styles.status, { borderColor: value === status ? palette.text : palette.border }]}>
                  <View style={[styles.swatch, { backgroundColor: colors?.[value] ?? palette.textMuted }]} />
                  <Text style={[styles.statusText, { color: palette.text }]}>{STATUS_LABELS[value]}</Text>
                </Pressable>
              ))}
            </View>
            {linkedChats > 0 ? (
              <Text style={[styles.meta, { color: palette.textFaint }]}>{`Linked to ${linkedChats} ${linkedChats === 1 ? 'chat' : 'chats'}.`}</Text>
            ) : null}
            <Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => void archive()} style={styles.archive}>
              <Icon name={existing.archived ? 'archive-box-arrow-down' : 'archive-box'} size={18} color={existing.archived ? palette.link : palette.danger} />
              <Text style={[styles.archiveText, { color: existing.archived ? palette.link : palette.danger }]}>{existing.archived ? 'Restore to the Board' : 'Archive Task'}</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        <Button label={existing ? 'Save' : 'Add Task'} onPress={() => void save()} loading={busy === 'save'} disabled={!title.trim() || busy !== null} />
      </View>
      <DatePicker visible={picking} value={dueDate} onPick={setDueDate} onClose={() => setPicking(false)} onClear={() => setDueDate(null)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  link: { fontFamily: fonts.medium, fontSize: 16, minWidth: 60 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  spacer: { minWidth: 60 },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  titleInput: { fontFamily: fonts.medium, fontSize: 16 },
  note: { minHeight: 90 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, height: 46 },
  rowText: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  statuses: { flexDirection: 'row', gap: 8 },
  status: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 10 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontFamily: fonts.medium, fontSize: 13 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  archive: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, marginTop: 8 },
  archiveText: { fontFamily: fonts.medium, fontSize: 15 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
});
