import { createUser, passwordProblem, usernameProblem, type DtPreset } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const PRESETS: { value: DtPreset; label: string; note: string }[] = [
  { value: 'standard', label: 'Standard', note: 'Their own workspace with DeepTutor’s usual pages; you choose their models and more on the web.' },
  { value: 'learner', label: 'Learner', note: 'Chat and reading only, in a teacher’s voice, without tools or uploads until you give them.' },
  { value: 'custom', label: 'Custom', note: 'Starts with nothing given: you set everything on the web.' },
];

/** A new account: username, a first password (they're asked to change it), and what kind of account. */
export function AddUserSheet({ visible, onClose, onAdded }: { visible: boolean; onClose: () => void; onAdded: () => void }) {
  const palette = usePalette();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Form onClose={onClose} onAdded={onAdded} /> : <View style={{ backgroundColor: palette.background }} />}
    </Modal>
  );
}

function Form({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [preset, setPreset] = useState<DtPreset>('standard');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const nameIssue = usernameProblem(username);
  const passwordIssue = passwordProblem(password);
  const ready = !nameIssue && !passwordIssue;

  const add = async () => {
    if (!ready) return setProblem(nameIssue ?? passwordIssue ?? '');
    setBusy(true);
    setProblem('');
    try {
      const made = await createUser(client, { username, password, preset });
      toast(`${made.username} added`);
      onAdded();
      onClose();
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Add a User
        </Text>
        {busy ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : (
          <Pressable accessibilityRole="button" disabled={!ready} onPress={() => void add()} hitSlop={10}>
            <Text style={[styles.action, styles.strong, { color: ready ? palette.link : palette.textFaint }]}>Add</Text>
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {problem ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{problem}</Text> : null}
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>Username or email</Text>
          <TextInput value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} textContentType="username" accessibilityLabel="Username or email" style={[styles.input, { color: palette.text, borderColor: username && nameIssue ? palette.danger : palette.border, backgroundColor: palette.surface }]} />
          {username && nameIssue ? <Text style={[styles.note, { color: palette.danger }]}>{nameIssue}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>First password</Text>
          <View style={[styles.input, styles.row, { borderColor: password && passwordIssue ? palette.danger : palette.border, backgroundColor: palette.surface }]}>
            <TextInput value={password} onChangeText={setPassword} secureTextEntry={!shown} autoCapitalize="none" autoCorrect={false} textContentType="newPassword" accessibilityLabel="First password" style={[styles.flex, styles.value, { color: palette.text }]} />
            <Pressable accessibilityRole="button" accessibilityLabel={shown ? 'Hide password' : 'Show password'} onPress={() => setShown(!shown)} hitSlop={8}>
              <Icon name={shown ? 'eye-slash' : 'eye'} size={16} color={palette.textMuted} />
            </Pressable>
          </View>
          <Text style={[styles.note, { color: password && passwordIssue ? palette.danger : palette.textMuted }]}>At least 8 characters. They’re asked to change it when they first sign in.</Text>
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>Kind of account</Text>
          {PRESETS.map((option) => {
            const on = preset === option.value;
            return (
              <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setPreset(option.value)} style={[styles.choice, { borderColor: on ? palette.active : palette.border }]}>
                <Icon name={on ? 'check' : 'minus'} size={16} color={on ? palette.active : palette.textFaint} />
                <View style={styles.flex}>
                  <Text style={[styles.label, { color: palette.text }]}>{option.label}</Text>
                  <Text style={[styles.note, { color: palette.textMuted }]}>{option.note}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  field: { gap: 6 },
  label: { fontFamily: fonts.medium, fontSize: 14 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  problem: { padding: 10, borderWidth: 1, borderRadius: radius.md, fontSize: 13 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 0, minHeight: 42 },
  value: { fontFamily: fonts.regular, fontSize: 15 },
  flex: { flex: 1 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: 1, borderRadius: radius.md },
});
