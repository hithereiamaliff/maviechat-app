import { cleanTag, createSkillTag, deleteSkillTag, renameSkillTag, tagProblem } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/** The library's tags: how many skills have each; add, rename or delete one (renaming and deleting reach every skill that has it). */
export function SkillTagsSheet({ visible, tags, counts, onChanged, onClose }: { visible: boolean; tags: string[]; counts: Record<string, number>; onChanged: () => void; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');

  const add = async () => {
    const tag = cleanTag(draft);
    const issue = tagProblem(tag);
    if (issue) return setNote(issue);
    try {
      await createSkillTag(client, tag);
      setDraft('');
      setNote('');
      onChanged();
    } catch (error) {
      setNote(describeError(error));
    }
  };
  const rename = (tag: string) =>
    Alert.prompt(
      `Rename “${tag}”`,
      counts[tag] ? `The ${counts[tag] === 1 ? 'skill' : `${counts[tag]} skills`} with it change too.` : undefined,
      (value) => {
        const next = cleanTag(value ?? '');
        if (!next || next === tag) return;
        const issue = tagProblem(next);
        if (issue) return toast(issue, 'error');
        void renameSkillTag(client, tag, next).then(onChanged, (error: unknown) => toast(`Couldn’t rename it: ${describeError(error)}`, 'error'));
      },
      'plain-text',
      tag,
    );
  const remove = (tag: string) =>
    Alert.alert(`Delete “${tag}”?`, counts[tag] ? `It comes off the ${counts[tag] === 1 ? 'skill' : `${counts[tag]} skills`} that have it.` : undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteSkillTag(client, tag).then(onChanged, (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error')) },
    ]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <View style={styles.placeholder} />
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            Tags
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={[styles.action, styles.strong, { color: palette.link }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => void add()}
            returnKeyType="done"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="New tag"
            placeholderTextColor={palette.textFaint}
            accessibilityLabel="New tag"
            style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
          {note ? <Text style={[styles.note, { color: palette.danger }]}>{note}</Text> : null}
          {!tags.length ? <Text style={[styles.note, { color: palette.textMuted }]}>No tags yet.</Text> : null}
          <View style={[styles.group, { borderColor: palette.border }]}>
            {tags.map((tag, index) => (
              <View key={tag} style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }]}>
                <Icon name="tag" size={14} color={palette.textMuted} />
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                  {tag}
                </Text>
                <Text style={[styles.count, { color: palette.textMuted }]}>{counts[tag] ?? 0}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${tag}`} onPress={() => rename(tag)} hitSlop={8}>
                  <Icon name="pencil" size={16} color={palette.textMuted} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${tag}`} onPress={() => remove(tag)} hitSlop={8}>
                  <Icon name="trash" size={16} color={palette.danger} />
                </Pressable>
              </View>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  placeholder: { width: 40 },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  name: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  count: { fontFamily: fonts.regular, fontSize: 13 },
});
