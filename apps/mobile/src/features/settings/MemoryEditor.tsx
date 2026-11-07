import { addMemory, cleanMemoryPath, deleteMemory, updateMemory, type Memory, type MemoryType } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = { user: 'About you', context: 'Context' };

const TYPE_HINTS: Record<MemoryType, string> = {
  user: 'A fact, preference or instruction about you.',
  context: 'Background a model should keep in mind in future chats.',
};

/** Adds a memory (`'new'`) or edits one, in a sheet: its type, its words and an optional path. */
export function MemoryEditor({ memory, onClose, onSaved }: { memory: Memory | 'new' | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal visible={memory !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {memory !== null ? <Editor key={memory === 'new' ? 'new' : memory.id} memory={memory} onClose={onClose} onSaved={onSaved} /> : null}
    </Modal>
  );
}

function Editor({ memory, onClose, onSaved }: { memory: Memory | 'new'; onClose: () => void; onSaved: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const existing = memory === 'new' ? null : memory;
  const [type, setType] = useState<MemoryType>(existing?.type ?? 'user');
  const [content, setContent] = useState(existing?.content ?? '');
  const [path, setPath] = useState(existing?.path ?? '');
  const [busy, setBusy] = useState(false);
  const cleaned = cleanMemoryPath(path);
  const ready = content.trim().length > 0 && !cleaned.error && !busy;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const input = { content, type, path: cleaned.path ?? '' };
      if (existing) await updateMemory(client, existing.id, input);
      else await addMemory(client, input);
      onSaved();
      toast(existing ? 'Memory saved' : 'Memory added');
      onClose();
    } catch (error) {
      toast(`Couldn’t save it: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = (target: Memory) =>
    Alert.alert('Delete this memory?', 'Models won’t know it any more.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          deleteMemory(client, target.id).then(
            () => {
              onSaved();
              toast('Memory deleted');
              onClose();
            },
            (error: unknown) => {
              setBusy(false);
              toast(`Couldn’t delete it: ${describeError(error)}`, 'error');
            },
          );
        },
      },
    ]);

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {existing ? 'Edit Memory' : 'Add Memory'}
        </Text>
        {busy ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : (
          <Pressable accessibilityRole="button" onPress={() => void save()} disabled={!ready} hitSlop={10}>
            <Text style={[styles.action, styles.strong, { color: ready ? palette.link : palette.textFaint }]}>{existing ? 'Save' : 'Add'}</Text>
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.segments, { backgroundColor: palette.surfaceStrong }]} accessibilityRole="radiogroup">
          {(['user', 'context'] as const).map((option) => {
            const selected = option === type;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setType(option)}
                style={[styles.segment, selected && { backgroundColor: palette.background }]}>
                <Text style={[styles.segmentText, { color: selected ? palette.text : palette.textMuted }]}>{MEMORY_TYPE_LABELS[option]}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.hint, { color: palette.textMuted }]}>{TYPE_HINTS[type]}</Text>
        <TextInput
          value={content}
          onChangeText={setContent}
          placeholder={type === 'user' ? 'I prefer short answers with examples.' : 'I’m planning a trip to Penang in December.'}
          placeholderTextColor={palette.textFaint}
          multiline
          autoFocus={!existing}
          textAlignVertical="top"
          accessibilityLabel="Memory"
          style={[styles.input, styles.multiline, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
        />
        <Text style={[styles.label, { color: palette.textMuted }]}>Path (optional)</Text>
        <TextInput
          value={path}
          onChangeText={setPath}
          placeholder="work/projects"
          placeholderTextColor={palette.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Path"
          style={[styles.input, { color: palette.text, borderColor: cleaned.error ? palette.danger : palette.border, backgroundColor: palette.surface }]}
        />
        <Text style={[styles.hint, { color: cleaned.error ? palette.danger : palette.textFaint }]}>{cleaned.error ?? 'Groups related memories, with / between levels.'}</Text>
        {existing ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => remove(existing)}
            disabled={busy}
            style={styles.delete}>
            <Text style={[styles.deleteText, { color: palette.danger }]}>Delete Memory</Text>
          </Pressable>
        ) : null}
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
  content: { padding: 16, gap: 8, paddingBottom: 48 },
  segments: { flexDirection: 'row', padding: 2, borderRadius: radius.md },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: radius.md - 2 },
  segmentText: { fontFamily: fonts.medium, fontSize: 14 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginHorizontal: 4 },
  label: { fontFamily: fonts.medium, fontSize: 13, marginTop: 8, marginLeft: 4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  multiline: { minHeight: 140, lineHeight: 21, marginTop: 4 },
  delete: { alignSelf: 'center', marginTop: 24, padding: 8 },
  deleteText: { fontFamily: fonts.medium, fontSize: 15 },
});
