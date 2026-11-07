import type { DtSessionSummary } from '@maviechat/deeptutor-protocol';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Modal } from '@/components/Modal';
import { fonts, usePalette } from '@/theme';
import { SessionList } from './SessionList';

/** The + menu's "DeepTutor chat": pick one of your DeepTutor chats to attach. Render only while signed in to DeepTutor. */
export function DeepTutorPicker({ visible, onPick, onClose }: { visible: boolean; onPick: (session: DtSessionSummary) => void; onClose: () => void }) {
  const palette = usePalette();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            DeepTutor chats
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={[styles.done, { color: palette.link }]}>Cancel</Text>
          </Pressable>
        </View>
        <SessionList
          rowHint="Attaches this chat to your message"
          empty="No DeepTutor chats yet."
          onOpen={(session) => {
            onClose();
            onPick(session);
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 18 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
});
