import { linkSessionTasks, sessionLinks, setTaskStatusLink, type DtTaskBoard } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useDtTaskBoard } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';
import { dueLabel, STATUS_LABELS } from './TaskSheet';

/**
 * The tasks a DeepTutor chat is about. DeepTutor shows the model your open tasks in every chat,
 * with the linked ones first and marked as this chat's; the most recently linked one colours
 * the chat in the sidebar while its status is linked.
 */
export function TaskLinkSheet({ sessionId, visible, onClose }: { sessionId: string; visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <LinkBody sessionId={sessionId} onClose={onClose} /> : null}
    </Modal>
  );
}

function LinkBody({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const board = useDtTaskBoard();
  const [busy, setBusy] = useState<string | null>(null);
  const links = sessionLinks(board.data, sessionId);
  const linked = links?.taskIds ?? [];
  // Archived tasks can stay linked, but only open ones can be linked anew.
  const cards = (board.data?.cards ?? []).filter((card) => !card.archived || linked.includes(card.id));
  const keep = (next: DtTaskBoard) => queryClient.setQueryData([DT_QUERY_ROOT, session.baseUrl, 'task-board'], next);

  const toggle = (id: string) => {
    setBusy(id);
    const next = linked.includes(id) ? linked.filter((item) => item !== id) : [...linked, id];
    void linkSessionTasks(client, sessionId, next)
      .then(keep)
      .catch((error: unknown) => toast(`Couldn't change the links: ${describeError(error)}`, 'error'))
      .finally(() => setBusy(null));
  };
  const setStatusLink = (enabled: boolean) =>
    void setTaskStatusLink(client, sessionId, enabled)
      .then(keep)
      .catch((error: unknown) => toast(`Couldn't change it: ${describeError(error)}`, 'error'));

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Linked Tasks
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={[styles.done, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.note, { color: palette.textMuted }]}>DeepTutor shows the model your open tasks in every chat. The ones you link here come first, marked as this chat&apos;s.</Text>
        {linked.length > 0 ? (
          <View style={[styles.statusRow, { borderColor: palette.border }]}>
            <View style={styles.statusText}>
              <Text style={[styles.label, { color: palette.text }]}>Show task status</Text>
              <Text style={[styles.note, { color: palette.textFaint }]}>The most recently linked task&apos;s column colours this chat in the sidebar.</Text>
            </View>
            <Switch value={links?.statusLinkEnabled ?? true} onValueChange={setStatusLink} accessibilityLabel="Show task status on this chat" />
          </View>
        ) : null}
        {board.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {board.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't load the board: ${describeError(board.error)}`}</Text> : null}
        {!board.isLoading && cards.length === 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onClose();
              router.replace('/learn/tasks');
            }}
            style={styles.empty}>
            <Text style={[styles.note, { color: palette.textMuted }]}>No tasks yet.</Text>
            <Text style={[styles.link, { color: palette.link }]}>Open the Task Board</Text>
          </Pressable>
        ) : null}
        {cards.map((card) => {
          const on = linked.includes(card.id);
          return (
            <Pressable
              key={card.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: busy !== null }}
              disabled={busy !== null}
              onPress={() => toggle(card.id)}
              style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <View style={[styles.swatch, { backgroundColor: board.data?.colors[card.status] ?? palette.textMuted }]} />
              <View style={styles.rowText}>
                <Text style={[styles.label, { color: palette.text }]} numberOfLines={2}>
                  {card.title}
                </Text>
                <Text style={[styles.meta, { color: palette.textFaint }]}>
                  {[STATUS_LABELS[card.status], card.dueDate ? `Due ${dueLabel(card.dueDate)}` : '', card.archived ? 'Archived' : ''].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {busy === card.id ? <ActivityIndicator size="small" color={palette.textMuted} /> : on ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 6 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, marginVertical: 6 },
  statusText: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.medium, fontSize: 15 },
  empty: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  link: { fontFamily: fonts.medium, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  rowText: { flex: 1, gap: 2 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
});
