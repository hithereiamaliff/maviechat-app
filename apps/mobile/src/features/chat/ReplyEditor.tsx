import { editableTexts, type HistoryMessage } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { fonts, radius, usePalette } from '@/theme';

interface ReplyEditorProps {
  message: HistoryMessage | null;
  onClose: () => void;
  /** Resolves true once saved (the sheet then closes). */
  onSave: (texts: string[], asCopy: boolean) => Promise<boolean>;
}

/**
 * Editing a reply, as the web's editor: Save changes it in place (its earlier text is kept on
 * the server), Save As Copy keeps the edit as a new version beside it. A reply with steps between
 * its text edits each piece of text on its own; the steps stay as they were.
 */
export function ReplyEditor({ message, onClose, onSave }: ReplyEditorProps) {
  return (
    <Modal visible={message !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {message ? <EditorBody key={message.id} message={message} onClose={onClose} onSave={onSave} /> : null}
    </Modal>
  );
}

function EditorBody({ message, onClose, onSave }: { message: HistoryMessage; onClose: () => void; onSave: ReplyEditorProps['onSave'] }) {
  const palette = usePalette();
  const [{ texts: original, structured }] = useState(() => editableTexts(message));
  const [texts, setTexts] = useState(original);
  const [busy, setBusy] = useState<'save' | 'copy' | null>(null);
  const changed = texts.some((text, index) => text !== original[index]);

  const save = async (asCopy: boolean) => {
    setBusy(asCopy ? 'copy' : 'save');
    const done = await onSave(texts, asCopy);
    setBusy(null);
    if (done) onClose();
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={[styles.cancel, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Edit Reply
        </Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {structured && texts.length > 1 ? (
          <Text style={[styles.note, { color: palette.textMuted }]}>This reply has steps between its text; each part is edited on its own.</Text>
        ) : null}
        {texts.map((text, index) => (
          <View key={index} style={styles.part}>
            {texts.length > 1 ? <Text style={[styles.label, { color: palette.textMuted }]}>{`Part ${index + 1}`}</Text> : null}
            <TextInput
              value={text}
              onChangeText={(value) => setTexts((current) => current.map((item, i) => (i === index ? value : item)))}
              multiline
              autoFocus={index === 0}
              textAlignVertical="top"
              style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
              accessibilityLabel={texts.length > 1 ? `Part ${index + 1} of the reply` : 'The reply'}
            />
          </View>
        ))}
        {texts.length === 0 ? <Text style={[styles.note, { color: palette.textMuted }]}>This reply has no text to edit.</Text> : null}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        <View style={styles.button}>
          <Button label="Save As Copy" variant="secondary" onPress={() => void save(true)} loading={busy === 'copy'} disabled={busy !== null || texts.length === 0} />
        </View>
        <View style={styles.button}>
          <Button label="Save" onPress={() => void save(false)} loading={busy === 'save'} disabled={busy !== null || !changed} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  cancel: { fontFamily: fonts.medium, fontSize: 16, minWidth: 60 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  spacer: { minWidth: 60 },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 14 },
  part: { gap: 6 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { minHeight: 160, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: 12, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  button: { flex: 1 },
});
