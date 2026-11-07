import { StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { fonts, usePalette } from '@/theme';

interface FullScreenInputProps {
  visible: boolean;
  value: string;
  placeholder: string;
  onChange: (text: string) => void;
  onClose: () => void;
  /** After the sheet has gone (the input bar can take focus again). */
  onDismiss?: () => void;
}

/** The web's "Input" drawer: the message being written, in an editor as tall as the screen. */
export function FullScreenInput({ visible, value, placeholder, onChange, onClose, onDismiss }: FullScreenInputProps) {
  const palette = usePalette();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onDismiss}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            Input
          </Text>
          <IconButton icon="x-mark" label="Close" onPress={onClose} />
        </View>
        <KeyboardAvoidingView behavior="padding" style={styles.body}>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={palette.textFaint}
            multiline
            autoFocus
            scrollEnabled
            textAlignVertical="top"
            accessibilityLabel="Message"
            style={[styles.input, { color: palette.text }]}
          />
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingTop: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 10, paddingVertical: 4 },
  title: { fontFamily: fonts.semibold, fontSize: 18 },
  body: { flex: 1 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
});
