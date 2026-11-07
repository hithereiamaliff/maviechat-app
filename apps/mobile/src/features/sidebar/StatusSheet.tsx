import { setUserStatus, userStatusOf, type SessionUser, type UserStatus } from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { EmojiPicker } from '@/components/EmojiPicker';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { emojiOfName, nameOfEmoji } from '@/lib/emoji';
import { useAuthed, useSessionUser } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

/** Your status as one line: its emoji, then its message. */
export const statusLine = (status: UserStatus): string => [status.emoji ? emojiOfName(status.emoji) : '', status.message].filter(Boolean).join(' ');

/** Saves your status (or clears it, with both empty) and shows it at once. */
export function useSetStatus() {
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const toast = useToast();
  return async (status: UserStatus): Promise<boolean> => {
    try {
      const saved = await setUserStatus(client, status);
      queryClient.setQueryData<SessionUser>(['session-user'], (user) => (user ? { ...user, status_emoji: saved.emoji, status_message: saved.message } : user));
      void queryClient.invalidateQueries({ queryKey: ['session-user'] });
      toast(status.emoji || status.message ? 'Status updated' : 'Status cleared');
      return true;
    } catch (error) {
      toast(`Couldn’t ${status.emoji || status.message ? 'update' : 'clear'} your status: ${describeError(error)}`, 'error');
      return false;
    }
  };
}

/** The web's "Set your status": an emoji and a message, shown in your user menu. */
export function useStatusSheet() {
  const [visible, setVisible] = useState(false);
  const element = (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVisible(false)}>
      {visible ? <StatusEditor onClose={() => setVisible(false)} /> : null}
    </Modal>
  );
  return { open: () => setVisible(true), element };
}

function StatusEditor({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const you = useSessionUser();
  const setStatus = useSetStatus();
  const [current] = useState(() => userStatusOf(you.data));
  // The emoji as it's saved: its short name, or itself when it has none.
  const [emoji, setEmoji] = useState(current.emoji);
  const [message, setMessage] = useState(current.message);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  // As on the web, a status needs its message.
  const ready = Boolean(message.trim()) && !saving;
  const save = async (status: UserStatus) => {
    setSaving(true);
    const done = await setStatus(status);
    setSaving(false);
    if (done) onClose();
  };

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} style={styles.side}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Set Your Status
        </Text>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready }} disabled={!ready} onPress={() => void save({ emoji, message: message.trim() })} hitSlop={10} style={[styles.side, styles.right]}>
          {saving ? <ActivityIndicator color={palette.textMuted} /> : <Text style={[styles.action, { color: ready ? palette.link : palette.textFaint }]}>Save</Text>}
        </Pressable>
      </View>
      <View style={styles.body}>
        <Text style={[styles.label, { color: palette.textMuted }]}>Status</Text>
        <View style={[styles.field, { borderColor: palette.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={emoji ? `Emoji ${emojiOfName(emoji)}, change it` : 'Choose an emoji'} onPress={() => setPicking(true)} hitSlop={6} style={styles.emojiButton}>
            {emoji ? <Text style={styles.emoji}>{emojiOfName(emoji)}</Text> : <Icon name="face-smile" size={22} color={palette.textMuted} />}
          </Pressable>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="What’s on your mind?"
            placeholderTextColor={palette.textFaint}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => (ready ? void save({ emoji, message: message.trim() }) : undefined)}
            accessibilityLabel="Status message"
            style={[styles.input, { color: palette.text }]}
          />
          <IconButton
            icon="x-mark"
            label="Clear the emoji and message"
            size={18}
            color={palette.textMuted}
            onPress={() => {
              setEmoji('');
              setMessage('');
            }}
          />
        </View>
        <Text style={[styles.hint, { color: palette.textFaint }]}>Shown in your user menu, here and on the web.</Text>
        {current.emoji || current.message ? (
          <Pressable accessibilityRole="button" disabled={saving} onPress={() => void save({ emoji: '', message: '' })} hitSlop={6} style={styles.clear}>
            <Text style={[styles.action, { color: palette.danger }]}>Clear Status</Text>
          </Pressable>
        ) : null}
      </View>
      <EmojiPicker visible={picking} selected={emoji ? emojiOfName(emoji) : undefined} onClose={() => setPicking(false)} onPick={(picked) => setEmoji(picked ? nameOfEmoji(picked) : '')} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  side: { minWidth: 64 },
  right: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.semibold, fontSize: 15 },
  body: { paddingHorizontal: 16, gap: 8 },
  label: { fontFamily: fonts.medium, fontSize: 12 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  emojiButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 22 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, paddingVertical: 12 },
  hint: { fontFamily: fonts.regular, fontSize: 12 },
  clear: { alignSelf: 'flex-start', paddingVertical: 12 },
});
