import { deleteGroupSession, unpinGroupMessage, updatePartnerGroup, type DtGroupSession, type DtPartner, type DtPartnerGroup } from '@maviechat/deeptutor-protocol';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { shortWhen } from '../labels';
import { useDtGroupSessions, useDtWhiteboard, usePartnersRefresh } from '../queries';
import { GroupForm, type GroupDraft } from './GroupForm';

function Sheet({ visible, title, action, onClose, children }: { visible: boolean; title: string; action?: ReactNode; onClose: () => void; children: ReactNode }) {
  const palette = usePalette();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? (
        <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
              <Text style={[styles.headerAction, { color: palette.link }]}>{action ? 'Cancel' : 'Done'}</Text>
            </Pressable>
            <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
              {title}
            </Text>
            <View style={styles.headerSide}>{action}</View>
          </View>
          {children}
        </KeyboardAvoidingView>
      ) : null}
    </Modal>
  );
}

/** A group's discussions: start a new one, open one, or delete one. */
export function DiscussionsSheet({ visible, groupId, current, onOpen, onNew, onClose }: { visible: boolean; groupId: string; current: string | null; onOpen: (key: string) => void; onNew: () => void; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const sessions = useDtGroupSessions(groupId, visible);
  const refresh = usePartnersRefresh();
  const remove = (session: DtGroupSession) =>
    Alert.alert('Delete this discussion?', `“${session.title || 'New discussion'}” is deleted for good. Answers pinned to the whiteboard stay.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteGroupSession(client, groupId, session.key).then(
            () => {
              refresh();
              if (session.key === current) onNew();
            },
            (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);
  return (
    <Sheet visible={visible} title="Discussions" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" onPress={onNew} style={({ pressed }) => [styles.row, styles.box, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
          <Text style={[styles.rowTitle, { color: palette.link }]}>New Discussion</Text>
        </Pressable>
        {sessions.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {sessions.data?.length ? (
          <View style={[styles.box, { borderColor: palette.border }]}>
            {sessions.data.map((session, index) => (
              <Pressable
                key={session.key}
                accessibilityRole="button"
                onPress={() => onOpen(session.key)}
                style={({ pressed }) => [styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>
                    {session.title || 'New discussion'}
                  </Text>
                  <Text style={[styles.meta, { color: palette.textFaint }]}>{[session.key === current ? 'Open now' : null, `${session.messageCount} messages`, shortWhen(session.updatedAt)].filter(Boolean).join(' · ')}</Text>
                </View>
                <IconButton icon="trash" label="Delete discussion" size={17} color={palette.textMuted} onPress={() => remove(session)} />
              </Pressable>
            ))}
          </View>
        ) : sessions.data ? (
          <Text style={[styles.empty, { color: palette.textFaint }]}>No discussions yet.</Text>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

/** What's pinned: every member keeps it in mind, in every discussion of the group. */
export function WhiteboardSheet({ visible, groupId, onClose }: { visible: boolean; groupId: string; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const pins = useDtWhiteboard(groupId, visible);
  return (
    <Sheet visible={visible} title="Whiteboard" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.note, { color: palette.textMuted }]}>Answers pinned here go into every member’s context, in every discussion. Pin one from its answer.</Text>
        {pins.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {pins.data && !pins.data.length ? <Text style={[styles.empty, { color: palette.textFaint }]}>Nothing pinned yet.</Text> : null}
        {(pins.data ?? []).map((pin) => (
          <View key={pin.eventId} style={[styles.pin, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <View style={styles.rowText}>
              <Text style={[styles.meta, { color: palette.textMuted }]}>{[pin.authorName, shortWhen(pin.pinnedAt)].filter(Boolean).join(' · ')}</Text>
              <Text style={[styles.pinText, { color: palette.text }]} numberOfLines={8}>
                {pin.content}
              </Text>
            </View>
            <IconButton
              icon="x-mark"
              label="Unpin"
              size={16}
              color={palette.textMuted}
              onPress={() => void unpinGroupMessage(client, groupId, pin.eventId).then(() => void pins.refetch(), (error: unknown) => toast(`Couldn’t unpin it: ${describeError(error)}`, 'error'))}
            />
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

/** A group's name, description, members and how they take turns. */
export function ManageGroupSheet({ visible, group, partners, onClose }: { visible: boolean; group: DtPartnerGroup; partners: DtPartner[]; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const refresh = usePartnersRefresh();
  const [draft, setDraft] = useState<GroupDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const shown: GroupDraft = draft ?? { name: group.name, description: group.description, emoji: group.emoji, color: group.color, memberIds: group.memberIds.filter((id) => partners.some((partner) => partner.id === id)), mode: group.mode };
  const ready = Boolean(draft) && shown.name.trim().length > 0 && shown.memberIds.length >= 2 && !busy;
  const save = async () => {
    setBusy(true);
    try {
      await updatePartnerGroup(client, group.id, { name: shown.name, description: shown.description, memberIds: shown.memberIds, mode: shown.mode });
      refresh();
      toast('Group saved');
      setDraft(null);
      onClose();
    } catch (error) {
      toast(`Couldn’t save it: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      visible={visible}
      title="Manage Group"
      onClose={() => {
        setDraft(null);
        onClose();
      }}
      action={
        busy ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : (
          <Pressable accessibilityRole="button" disabled={!ready} onPress={() => void save()} hitSlop={10}>
            <Text style={[styles.headerAction, styles.strong, { color: ready ? palette.link : palette.textFaint }]}>Save</Text>
          </Pressable>
        )
      }>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <GroupForm draft={shown} onChange={setDraft} partners={partners} isNew={false} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  headerSide: { minWidth: 56, alignItems: 'flex-end' },
  headerAction: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 14, paddingRight: 6, paddingVertical: 11 },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 15 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 16 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  pin: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  pinText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
});
