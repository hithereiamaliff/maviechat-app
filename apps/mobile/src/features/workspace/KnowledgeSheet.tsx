import { createWorkspaceKnowledge, updateWorkspaceKnowledge, type WorkspaceKnowledge } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { Modal, ScrollView, Text, TextInput } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { usePalette } from '@/theme';
import { editorStyles as styles, Field, SheetHeader } from './EditorParts';
import { useWorkspaceRefresh } from './queries';

/** What the sheet opens on: a new collection, or one's name and description to change. */
export type KnowledgeSheetTarget = { kind: 'new' } | { kind: 'edit'; knowledge: WorkspaceKnowledge };

/** A collection's name and description, as the web's create sheet and page header have them (both needed). */
export function KnowledgeSheet({ target, onClose, onSaved }: { target: KnowledgeSheetTarget | null; onClose: () => void; onSaved?: (knowledge: WorkspaceKnowledge) => void }) {
  // Handed on once the sheet is gone, so opening the new collection doesn't race its closing.
  const [saved, setSaved] = useState<WorkspaceKnowledge | null>(null);
  return (
    <Modal
      visible={target !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={() => {
        if (!saved) return;
        setSaved(null);
        onSaved?.(saved);
      }}>
      {target ? (
        <Form
          target={target}
          onClose={onClose}
          onSaved={(knowledge) => {
            setSaved(knowledge);
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}

function Form({ target, onClose, onSaved }: { target: KnowledgeSheetTarget; onClose: () => void; onSaved: (knowledge: WorkspaceKnowledge) => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const refresh = useWorkspaceRefresh();
  const editing = target.kind === 'edit' ? target.knowledge : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const ready = Boolean(name.trim() && description.trim());

  const save = async () => {
    if (!ready) return setProblem('It needs a name and a description.');
    if (editing && name.trim() === editing.name && description.trim() === editing.description) return onClose();
    setBusy(true);
    setProblem('');
    try {
      const saved = editing ? await updateWorkspaceKnowledge(client, editing.id, { name, description }) : await createWorkspaceKnowledge(client, { name, description });
      refresh();
      toast(editing ? 'Saved' : 'Collection made (private)');
      onSaved(saved);
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={editing ? 'Name and Description' : 'New Knowledge'} onCancel={onClose} onSave={() => void save()} canSave={ready} busy={busy} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {problem ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{problem}</Text> : null}
        <Field label="Name">
          <TextInput value={name} onChangeText={setName} placeholder="Handbook" placeholderTextColor={palette.textFaint} accessibilityLabel="Name" style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        </Field>
        <Field label="Description" note="What’s in it. Models see this to decide when to search it.">
          <TextInput value={description} onChangeText={setDescription} multiline placeholder="Our policies and how-tos" placeholderTextColor={palette.textFaint} accessibilityLabel="Description" style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        </Field>
        <Text style={[styles.note, { color: palette.textFaint }]}>{editing ? 'Its sharing stays as it is.' : 'New collections are private: only you (and admins) can use them. Add files once it’s made.'}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
