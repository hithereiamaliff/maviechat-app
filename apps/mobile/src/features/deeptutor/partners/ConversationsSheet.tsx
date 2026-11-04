import type { DtPartnerSession } from '@maviechat/deeptutor-protocol';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { describeError } from '@/lib/errors';
import { fonts, radius, usePalette } from '@/theme';
import { channelLabel, shortWhen } from './labels';
import { useDtPartnerSessions } from './queries';

/**
 * A partner's conversations, newest first, as DeepTutor's History tab lists them: the one open,
 * archived ones (to bring back), and ones held in chat apps (to read). Delete removes one for good.
 */
export function ConversationsSheet({
  partnerId,
  visible,
  current,
  onOpen,
  onDelete,
  onClose,
}: {
  partnerId: string;
  visible: boolean;
  current: string | null;
  onOpen: (session: DtPartnerSession) => void;
  onDelete: (session: DtPartnerSession) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Conversations partnerId={partnerId} current={current} onOpen={onOpen} onDelete={onDelete} onClose={onClose} /> : null}
    </Modal>
  );
}

function Conversations({ partnerId, current, onOpen, onDelete, onClose }: { partnerId: string; current: string | null; onOpen: (session: DtPartnerSession) => void; onDelete: (session: DtPartnerSession) => Promise<void>; onClose: () => void }) {
  const palette = usePalette();
  const sessions = useDtPartnerSessions(partnerId);
  const list = sessions.data ?? [];

  const remove = (session: DtPartnerSession) =>
    Alert.alert('Delete this conversation?', `“${session.title || 'New conversation'}” is deleted for good.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void onDelete(session).then(
            () => sessions.refetch(),
            (error: unknown) => Alert.alert('Couldn’t delete it', describeError(error)),
          ),
      },
    ]);

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Conversations
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.done, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {sessions.isLoading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
        {sessions.isError ? <Text style={[styles.empty, { color: palette.textMuted }]}>{`Couldn’t load them: ${describeError(sessions.error)}`}</Text> : null}
        {sessions.data && !list.length ? <Text style={[styles.empty, { color: palette.textMuted }]}>No conversations yet.</Text> : null}
        {list.length ? (
          <View style={[styles.group, { borderColor: palette.border }]}>
            {list.map((session, index) => {
              const here = session.key === current;
              const app = session.channel !== 'web';
              return (
                <Pressable
                  key={session.key}
                  accessibilityRole="button"
                  accessibilityHint={app ? 'Shows this conversation' : session.archived ? 'Brings this conversation back and opens it' : 'Opens this conversation'}
                  onPress={() => onOpen(session)}
                  style={({ pressed }) => [styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                  <Icon name={app ? 'chat-bubble-left-right' : session.archived ? 'archive-box' : 'chat-bubble-left'} size={18} color={palette.textMuted} />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>
                      {session.title || 'New conversation'}
                    </Text>
                    {session.lastMessage ? (
                      <Text style={[styles.preview, { color: palette.textMuted }]} numberOfLines={2}>
                        {session.lastMessage.replace(/[#*_`>]+/g, '').trim()}
                      </Text>
                    ) : null}
                    <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
                      {[here ? 'Open now' : null, app ? `In ${channelLabel(session.channel)}` : session.archived ? 'Archived' : null, `${session.messageCount} messages`, shortWhen(session.updatedAt)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <IconButton icon="trash" label="Delete conversation" size={17} color={palette.textMuted} onPress={() => remove(session)} />
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <Text style={[styles.note, { color: palette.textFaint }]}>A new conversation archives the one before it. Conversations held in chat apps are read here; reply in the app.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  loading: { marginTop: 24 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 24 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingLeft: 14, paddingRight: 6, paddingVertical: 10 },
  rowText: { flex: 1, gap: 3 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 15 },
  preview: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
});
