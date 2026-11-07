import { createWorkspaceSkill, OwuiHttpError, skillDraftFromMarkdown, skillFrontMatter, skillIdFromName, skillIdProblem, updateWorkspaceSkill, type WorkspaceSkill } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { usePalette } from '@/theme';
import { editorStyles as styles, Field, SheetHeader, SheetLoading, TagsField } from './EditorParts';
import { useWorkspaceRefresh, useWorkspaceSkill } from './queries';

/** A skill read from a Markdown file, to fill a new one. */
export type SkillDraft = ReturnType<typeof skillDraftFromMarkdown>;

/** What the skill sheet opens on: a new skill (maybe from a file), one to change (or read), or a copy of one. */
export type SkillEditorTarget = { kind: 'new'; draft?: SkillDraft } | { kind: 'edit'; id: string } | { kind: 'clone'; id: string };

/**
 * A Workspace skill, as Open WebUI's skill editor has it: name, id (new ones only, from the name
 * until you change it), description, tags and its Markdown. A file's header fills an empty name
 * and description. Saving keeps it on or off as it is, and keeps its other settings.
 */
export function SkillEditor({ target, onClose }: { target: SkillEditorTarget | null; onClose: () => void }) {
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target ? <Loader target={target} onClose={onClose} /> : null}
    </Modal>
  );
}

function Loader({ target, onClose }: { target: SkillEditorTarget; onClose: () => void }) {
  const id = target.kind === 'new' ? null : target.id;
  const skill = useWorkspaceSkill(id);
  if (id && !(skill.data && skill.isFetchedAfterMount)) return <SheetLoading error={skill.isError ? skill.error : null} onClose={onClose} />;
  return <Form target={target} skill={skill.data ?? null} onClose={onClose} />;
}

function Form({ target, skill, onClose }: { target: SkillEditorTarget; skill: WorkspaceSkill | null; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const refresh = useWorkspaceRefresh();
  const editing = target.kind === 'edit';
  const cloning = target.kind === 'clone';
  const draft = target.kind === 'new' ? target.draft : undefined;
  const readOnly = editing && skill !== null && !skill.writeAccess;
  const [name, setName] = useState(skill ? (cloning ? `${skill.name} (Clone)` : skill.name) : (draft?.name ?? ''));
  const [skillId, setSkillId] = useState(skill ? (cloning ? `${skill.id}_clone` : skill.id) : (draft?.id ?? ''));
  const [idTouched, setIdTouched] = useState(target.kind !== 'new');
  const [description, setDescription] = useState(skill?.description ?? draft?.description ?? '');
  const [tags, setTags] = useState<string[]>(skill?.tags ?? []);
  const [content, setContent] = useState(skill?.content ?? draft?.content ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const idIssue = editing ? null : skillIdProblem(skillId.trim());
  const ready = !readOnly && Boolean(name.trim()) && !idIssue && Boolean(content.trim());

  const changeContent = (value: string) => {
    setContent(value);
    if (editing) return;
    // As the web fills an empty form from a pasted file's header (once the header is closed).
    const head = skillFrontMatter(value);
    if (head.name && !name.trim()) {
      const named = skillDraftFromMarkdown(value);
      setName(named.name);
      if (!idTouched) setSkillId(named.id);
    }
    if (head.description && !description.trim()) setDescription(head.description);
  };
  const save = async () => {
    if (!ready) return setProblem(idIssue ?? 'It needs a name, an id and some text.');
    setBusy(true);
    setProblem('');
    try {
      const input = { id: skillId.trim(), name: name.trim(), description: description.trim(), content, tags };
      if (editing && skill) await updateWorkspaceSkill(client, { ...input, isActive: skill.isActive, meta: skill.meta });
      else await createWorkspaceSkill(client, { ...input, isActive: true, meta: cloning ? skill?.meta : undefined });
      refresh();
      toast(editing ? 'Skill saved' : 'Skill made (private)');
      onClose();
    } catch (error) {
      // Names are unique on the server too; a clash is a plain 400 on 0.11, a 409 on 0.12.
      setProblem(`${describeError(error)}${error instanceof OwuiHttpError && (error.status === 400 || error.status === 409) ? ' Every skill on this server needs its own name and id: another may have this one.' : ''}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={editing ? (skill?.name ?? 'Skill') : cloning ? 'Copy of a Skill' : 'New Skill'} onCancel={onClose} onSave={() => void save()} canSave={ready} busy={busy} readOnly={readOnly} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {readOnly ? <Text style={[styles.note, { color: palette.textMuted }]}>Shared with you to use: only its owner (or someone they let) can change it.</Text> : null}
        {skill && editing && !skill.isActive ? <Text style={[styles.note, { color: palette.textMuted }]}>It’s off: models and chats leave it out until it’s switched on in the list.</Text> : null}
        {problem ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{problem}</Text> : null}
        <Field label="Name">
          <TextInput
            value={name}
            onChangeText={(value) => {
              setName(value);
              if (!idTouched) setSkillId(skillIdFromName(value));
            }}
            editable={!readOnly}
            placeholder="Essay Feedback"
            placeholderTextColor={palette.textFaint}
            accessibilityLabel="Name"
            style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
        </Field>
        <Field label="Id" note={!editing && skillId && idIssue ? idIssue : editing ? 'An id can’t change.' : 'Lower-case letters, digits, dashes and underscores.'} problem={Boolean(!editing && skillId && idIssue)}>
          <TextInput
            value={skillId}
            onChangeText={(value) => {
              setIdTouched(true);
              setSkillId(value);
            }}
            editable={!editing}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            placeholder="essay-feedback"
            placeholderTextColor={palette.textFaint}
            accessibilityLabel="Id"
            style={[styles.input, styles.mono, { color: editing ? palette.textMuted : palette.text, borderColor: !editing && skillId && idIssue ? palette.danger : palette.border, backgroundColor: palette.surface }]}
          />
        </Field>
        <Field label="Description" note={readOnly ? null : 'Models see it to decide when to read the skill.'}>
          <TextInput value={description} onChangeText={setDescription} editable={!readOnly} multiline placeholder="When to use it" placeholderTextColor={palette.textFaint} accessibilityLabel="Description" style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        </Field>
        <TagsField tags={tags} setTags={setTags} readOnly={readOnly} />
        <Field label="Instructions" note={readOnly ? null : 'Markdown. A model with this skill reads it when it needs it; a message that mentions the skill gets all of it.'}>
          <TextInput
            value={content}
            onChangeText={changeContent}
            editable={!readOnly}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            placeholder={'---\nname: essay-feedback\ndescription: Marks essays\n---\n\n# Steps'}
            placeholderTextColor={palette.textFaint}
            accessibilityLabel="Instructions"
            style={[styles.input, styles.body, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
        </Field>
        <Text style={[styles.note, { color: palette.textFaint }]}>{editing ? 'Its sharing stays as it is.' : 'New skills are private: only you (and admins) can use them.'}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
