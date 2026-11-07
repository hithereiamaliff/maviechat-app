import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useUserSettings } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import { selectionActions, selectionPrompt, type SelectionAction } from './selectionActions';

/**
 * A reply's text to select from, with the web's actions for a selection: Ask and Explain (or your
 * own, from the web's settings). Each puts its prompt in the message box, as 0.11.3 does; with
 * nothing selected, it uses the whole reply.
 */
export function SelectTextSheet({ text, visible, onClose, onPrompt }: { text: string; visible: boolean; onClose: () => void; onPrompt: (prompt: string) => void }) {
  const palette = usePalette();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Sheet text={text} onClose={onClose} onPrompt={onPrompt} /> : <View style={{ backgroundColor: palette.background }} />}
    </Modal>
  );
}

function Sheet({ text, onClose, onPrompt }: { text: string; onClose: () => void; onPrompt: (prompt: string) => void }) {
  const palette = usePalette();
  const toast = useToast();
  const settings = useUserSettings();
  const actions = selectionActions(settings.data?.ui);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [asking, setAsking] = useState<SelectionAction | null>(null);
  const [question, setQuestion] = useState('');
  const selected = selection.end > selection.start ? text.slice(selection.start, selection.end) : '';

  const run = (action: SelectionAction, input = '') => {
    onPrompt(selectionPrompt(action, selected || text, input));
    onClose();
  };
  const copy = async () => {
    await Clipboard.setStringAsync(selected || text);
    toast('Copied to clipboard');
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} style={styles.side}>
          <Text style={[styles.action, { color: palette.link }]}>Done</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Select Text
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={selected ? 'Copy the selection' : 'Copy the reply'} onPress={() => void copy()} hitSlop={10} style={[styles.side, styles.end]}>
          <Icon name="clipboard-document" size={20} color={palette.text} />
        </Pressable>
      </View>
      <Text style={[styles.hint, { color: palette.textMuted }]}>{selected ? `${selected.length} characters selected` : 'Select part of the reply, or use all of it.'}</Text>
      <TextInput
        value={text}
        multiline
        // iOS selects in a read-only view; Android needs the field focusable, with no keyboard.
        editable={Platform.OS === 'android'}
        showSoftInputOnFocus={false}
        onChangeText={() => undefined}
        onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
        accessibilityLabel="The reply's text"
        textAlignVertical="top"
        style={[styles.text, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
      />
      {asking ? (
        <View style={styles.askRow}>
          <TextInput
            value={question}
            onChangeText={setQuestion}
            placeholder="Ask a question"
            placeholderTextColor={palette.textFaint}
            autoFocus
            returnKeyType="send"
            onSubmitEditing={() => (question.trim() ? run(asking, question.trim()) : undefined)}
            accessibilityLabel="Ask a question"
            style={[styles.question, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Submit question"
            disabled={!question.trim()}
            onPress={() => run(asking, question.trim())}
            hitSlop={8}
            style={[styles.send, { backgroundColor: question.trim() ? palette.primary : palette.surfaceStrong }]}>
            <Icon name="arrow-up" size={18} color={question.trim() ? palette.onPrimary : palette.textFaint} strokeWidth={2} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.buttons}>
          {actions.map((action) => (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              onPress={() => (action.input ? setAsking(action) : run(action))}
              style={({ pressed }) => [styles.button, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <Text style={[styles.buttonText, { color: palette.text }]}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  side: { width: 60 },
  end: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  hint: { fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 20, paddingBottom: 8 },
  text: {
    flex: 1,
    marginHorizontal: 16,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  button: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth },
  buttonText: { fontFamily: fonts.medium, fontSize: 15 },
  askRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  question: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
