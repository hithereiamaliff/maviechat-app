import { cleanTag, joinFrontMatter, resourceNameProblem, slugifyName, splitFrontMatter, tagProblem } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Modal } from '@/components/Modal';
import { describeError } from '@/lib/errors';
import { fonts, radius, usePalette } from '@/theme';

/** What the editor hands back: the body apart from the file's header (kept as it came). */
export interface ResourceDraft {
  name: string;
  description: string;
  tags: string[];
  header: string;
  body: string;
}

type Kind = 'persona' | 'skill';

const STARTERS: Record<Kind, string> = {
  persona: '# Voice\n\nHow it sounds: its tone, how long its answers are, what it never does.\n\n## Habits\n\n- Lead with the answer, then the reasons.\n- Ask one question back when something is unclear.\n',
  skill: '# When to use it\n\nThe situations this playbook is for.\n\n## Steps\n\n1. First…\n2. Then…\n',
};

const WORDS: Record<Kind, { noun: string; description: string; body: string }> = {
  persona: { noun: 'Persona', description: 'One line, shown when you pick a voice for a chat.', body: 'How it speaks. DeepTutor writes the file’s header (name and description) itself.' },
  skill: { noun: 'Skill', description: 'One line on when it helps: the model reads it to decide whether to open the skill.', body: 'The playbook the model reads when it opens the skill.' },
};

const sameTags = (a: string[], b: string[]) => [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * A new or changed persona or skill: its name (made into one DeepTutor accepts as you type), a
 * description, for skills its tags, and its Markdown. A skill's header (its settings) is kept as
 * it came unless you choose to edit the whole file.
 */
export function ResourceEditor({
  kind,
  open,
  initial,
  loading = false,
  error,
  vocabulary = [],
  onSave,
  onClose,
}: {
  kind: Kind;
  open: boolean;
  /** null for a new one. */
  initial: ResourceDraft | null;
  /** The file is still loading. */
  loading?: boolean;
  /** The file couldn't be read. */
  error?: unknown;
  vocabulary?: string[];
  /** Saves; resolves to what went wrong, or null. */
  onSave: (draft: ResourceDraft) => Promise<string | null>;
  onClose: () => void;
}) {
  const palette = usePalette();
  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {open && error ? (
        <View style={[styles.sheet, styles.center, { backgroundColor: palette.background }]}>
          <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t open it: ${describeError(error)}`}</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={[styles.action, { color: palette.link }]}>Close</Text>
          </Pressable>
        </View>
      ) : open && loading ? (
        <View style={[styles.sheet, styles.center, { backgroundColor: palette.background }]}>
          <ActivityIndicator color={palette.textMuted} />
        </View>
      ) : open ? (
        <Editor kind={kind} initial={initial} vocabulary={vocabulary} onSave={onSave} onClose={onClose} />
      ) : null}
    </Modal>
  );
}

function Editor({ kind, initial, vocabulary, onSave, onClose }: { kind: Kind; initial: ResourceDraft | null; vocabulary: string[]; onSave: (draft: ResourceDraft) => Promise<string | null>; onClose: () => void }) {
  const palette = usePalette();
  const words = WORDS[kind];
  const start: ResourceDraft = initial ?? { name: '', description: '', tags: [], header: '', body: STARTERS[kind] };
  const [name, setName] = useState(start.name);
  const [description, setDescription] = useState(start.description);
  const [tags, setTags] = useState(start.tags);
  const [header, setHeader] = useState(start.header);
  const [body, setBody] = useState(start.body);
  // The whole file in one box (a skill's header too), or null.
  const [whole, setWhole] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');
  const [tagNote, setTagNote] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const current = whole === null ? { header, body } : splitFrontMatter(whole);
  const nameIssue = resourceNameProblem(name);
  const dirty = !initial || name !== initial.name || description !== initial.description || !sameTags(tags, initial.tags) || current.header !== initial.header || current.body !== initial.body;
  const choices = [...new Set([...vocabulary, ...tags])].sort();

  const toggleWhole = (on: boolean) => {
    if (on) setWhole(joinFrontMatter({ header, body }));
    else if (whole !== null) {
      const split = splitFrontMatter(whole);
      setHeader(split.header);
      setBody(split.body);
      setWhole(null);
    }
  };
  const addTag = () => {
    const tag = cleanTag(newTag);
    const issue = tagProblem(tag);
    if (issue) return setTagNote(issue);
    setTagNote('');
    setNewTag('');
    if (!tags.includes(tag)) setTags([...tags, tag]);
  };
  const save = async () => {
    if (nameIssue) return setProblem(nameIssue);
    setBusy(true);
    setProblem('');
    const refused = await onSave({ name, description: description.trim(), tags, header: current.header, body: current.body });
    setBusy(false);
    if (refused) setProblem(refused);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
          {initial ? initial.name : `New ${words.noun}`}
        </Text>
        {busy ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : (
          <Pressable accessibilityRole="button" disabled={!dirty || Boolean(nameIssue)} onPress={() => void save()} hitSlop={10}>
            <Text style={[styles.action, styles.strong, { color: dirty && !nameIssue ? palette.link : palette.textFaint }]}>Save</Text>
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {problem ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{problem}</Text> : null}
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>Name</Text>
          <TextInput
            value={name}
            onChangeText={(text) => setName(slugifyName(text))}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={kind === 'persona' ? 'patient-tutor' : 'essay-feedback'}
            placeholderTextColor={palette.textFaint}
            accessibilityLabel="Name"
            style={[styles.input, { color: palette.text, borderColor: name && nameIssue ? palette.danger : palette.border, backgroundColor: palette.surface }]}
          />
          <Text style={[styles.note, { color: name && nameIssue ? palette.danger : palette.textMuted }]}>Lowercase letters, digits and dashes, starting with a letter or digit.</Text>
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>Description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            accessibilityLabel="Description"
            style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
          <Text style={[styles.note, { color: palette.textMuted }]}>{words.description}</Text>
        </View>
        {kind === 'skill' ? (
          <View style={styles.field}>
            <Text style={[styles.label, { color: palette.text }]}>Tags</Text>
            {choices.length ? (
              <View style={styles.chips}>
                {choices.map((tag) => {
                  const on = tags.includes(tag);
                  return (
                    <Pressable
                      key={tag}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: on }}
                      onPress={() => setTags(on ? tags.filter((item) => item !== tag) : [...tags, tag])}
                      style={[styles.chip, { borderColor: palette.border }, on && { backgroundColor: palette.active, borderColor: palette.active }]}>
                      <Text style={[styles.chipText, { color: on ? palette.onActive : palette.textMuted }]}>{tag}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <TextInput
              value={newTag}
              onChangeText={setNewTag}
              onSubmitEditing={addTag}
              returnKeyType="done"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Add a tag"
              placeholderTextColor={palette.textFaint}
              accessibilityLabel="Add a tag"
              style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
            />
            {tagNote ? <Text style={[styles.note, { color: palette.danger }]}>{tagNote}</Text> : null}
          </View>
        ) : null}
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>{kind === 'persona' ? 'How it speaks' : 'Playbook'}</Text>
          <Text style={[styles.note, { color: palette.textMuted }]}>{words.body}</Text>
          {kind === 'skill' && (header || whole !== null) ? (
            <View style={styles.switchRow}>
              <Text style={[styles.note, styles.flex, { color: palette.textMuted }]}>Edit the whole file, its header (settings such as always and requires) too</Text>
              <Switch accessibilityLabel="Edit the whole file" value={whole !== null} onValueChange={toggleWhole} />
            </View>
          ) : null}
          <TextInput
            value={whole ?? body}
            onChangeText={whole === null ? setBody : setWhole}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            accessibilityLabel={kind === 'persona' ? 'How it speaks' : 'Playbook'}
            style={[styles.input, styles.body, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
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
  body: { minHeight: 280, fontFamily: fonts.mono, fontSize: 13, lineHeight: 19, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 30, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
});
