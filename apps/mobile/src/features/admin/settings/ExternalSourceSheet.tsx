import {
  addressHasPassword,
  createExternalSource,
  EXTERNAL_PROVIDERS,
  externalFormOf,
  externalFormProblem,
  newExternalForm,
  testExternalSource,
  updateExternalSource,
  withExternalProvider,
  type ExternalConnection,
  type ExternalForm,
  type ExternalSource,
  type ExternalTestResult,
} from '@maviechat/owui-protocol';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { editorStyles, Field, SheetHeader } from '@/features/workspace/EditorParts';
import { Chip } from '@/features/workspace/ListControls';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

/** What the sheet opens on: a new source, or a saved one with its connection. */
export type ExternalSourceTarget = { kind: 'new' } | { kind: 'edit'; source: ExternalSource; connection: ExternalConnection };

const ADDRESS_EXAMPLE: Record<ExternalForm['provider'], string> = {
  qdrant: 'Like https://your-qdrant:6333',
  milvus: 'Like http://your-milvus:19530',
  pgvector: 'Like postgresql://user:password@your-db:5432/name (it signs in with these)',
};

/**
 * Adding or changing an external knowledge source, as the web's form has it: name and what it's
 * for; the database (Qdrant, Milvus or pgvector), its address, key and timeout; the collection,
 * and where its rows keep their text, vector, details and id. A test question must find
 * something before it's saved (the server tests it again as it saves). A saved key never comes
 * back: leave the key empty to keep it.
 */
export function ExternalSourceSheet({ target, onClose, onSaved }: { target: ExternalSourceTarget | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target ? <SourceForm key={target.kind === 'edit' ? target.source.knowledge.id : 'new'} target={target} onClose={onClose} onSaved={onSaved} /> : null}
    </Modal>
  );
}

function SourceForm({ target, onClose, onSaved }: { target: ExternalSourceTarget; onClose: () => void; onSaved: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const saved = target.kind === 'edit' ? target.connection : null;
  const [initial] = useState(() => (target.kind === 'edit' ? externalFormOf(target.source, target.connection) : newExternalForm()));
  const [form, setForm] = useState(initial);
  const [question, setQuestion] = useState('');
  const [tested, setTested] = useState<{ key: string; result: ExternalTestResult } | null>(null);
  const [testError, setTestError] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAddress, setShowAddress] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const set = (key: keyof ExternalForm) => (value: string) => setForm({ ...form, [key]: value });
  const changed = JSON.stringify(form) !== JSON.stringify(initial);
  // A test counts for the form and question it was run with.
  const current = JSON.stringify({ form, question });
  const testedNow = tested?.key === current ? tested.result : null;
  // The server won't ask a switched-off source anything (it answers with an error).
  const off = saved !== null && !saved.enabled;
  const testProblem = off ? 'It’s switched off: switch it on in the list to test or change it.' : externalFormProblem(form, question);
  const saveProblem = externalFormProblem(form, question, true);
  // Stricter than the server, which takes rows whose text field is empty: one passage must have text.
  const withText = testedNow?.passages.some((passage) => passage.text.trim()) ?? false;
  const canSave = !saving && !saveProblem && (target.kind === 'new' || changed) && withText;
  const secretAddress = form.provider === 'pgvector' || addressHasPassword(form.endpoint);
  const input = [editorStyles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];

  const close = () => {
    if (!changed) return onClose();
    Alert.alert('Discard your changes?', undefined, [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };
  const test = async () => {
    setTesting(true);
    setTestError('');
    try {
      setTested({ key: current, result: await testExternalSource(client, form, question, saved) });
    } catch (error) {
      setTested(null);
      setTestError(`The test failed (${describeError(error)}): check the address, the key and the collection.`);
    } finally {
      setTesting(false);
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      if (target.kind === 'edit') await updateExternalSource(client, target.source.knowledge.id, form, question, target.connection);
      else await createExternalSource(client, form, question);
      onSaved();
      toast(target.kind === 'edit' ? 'Source saved' : 'Source added (private: share it with Share…)');
      onClose();
    } catch (error) {
      toast(`Couldn’t save it: ${describeError(error)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const text = (key: keyof ExternalForm, label: string, note?: string, placeholder?: string) => (
    <Field label={label} note={note}>
      <TextInput value={form[key]} onChangeText={set(key)} autoCapitalize="none" autoCorrect={false} placeholder={placeholder} placeholderTextColor={palette.textFaint} accessibilityLabel={label} style={input} />
    </Field>
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={[editorStyles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={target.kind === 'edit' ? target.source.knowledge.name : 'New Source'} onCancel={close} onSave={() => void save()} canSave={canSave} busy={saving} />
      <ScrollView contentContainerStyle={editorStyles.content} keyboardShouldPersistTaps="handled">
        <Field label="Name" note="As it shows in Workspace → Knowledge and to models.">
          <TextInput value={form.name} onChangeText={set('name')} autoCapitalize="sentences" accessibilityLabel="Name" style={input} />
        </Field>
        <Field label="Description">
          <TextInput value={form.description} onChangeText={set('description')} multiline accessibilityLabel="Description" style={[input, styles.multiline]} />
        </Field>

        <Field label="Database">
          <View style={styles.chips}>
            {EXTERNAL_PROVIDERS.map((provider) => (
              <Chip key={provider.value} label={provider.label} on={form.provider === provider.value} onPress={() => provider.value !== form.provider && setForm(withExternalProvider(form, provider.value))} />
            ))}
          </View>
        </Field>
        <Field label="Address" note={ADDRESS_EXAMPLE[form.provider]}>
          <View style={styles.inputRow}>
            <TextInput value={form.endpoint} onChangeText={set('endpoint')} autoCapitalize="none" autoCorrect={false} keyboardType="url" secureTextEntry={secretAddress && !showAddress} accessibilityLabel="Address" style={[input, styles.flex]} />
            {secretAddress ? (
              <Pressable accessibilityRole="button" accessibilityLabel={showAddress ? 'Hide the address' : 'Show the address'} onPress={() => setShowAddress(!showAddress)} hitSlop={8}>
                <Icon name={showAddress ? 'eye-slash' : 'eye'} size={18} color={palette.textMuted} />
              </Pressable>
            ) : null}
          </View>
        </Field>
        {form.provider !== 'pgvector' ? (
          <Field label="Key" note={saved?.keySaved ? 'A key is saved: leave this empty to keep it.' : 'If the database asks for one.'}>
            <View style={styles.inputRow}>
              <TextInput value={form.key} onChangeText={set('key')} autoCapitalize="none" autoCorrect={false} secureTextEntry={!showKey} placeholder={saved?.keySaved ? 'Saved' : undefined} placeholderTextColor={palette.textFaint} accessibilityLabel="Key" style={[input, styles.flex]} />
              <Pressable accessibilityRole="button" accessibilityLabel={showKey ? 'Hide the key' : 'Show the key'} onPress={() => setShowKey(!showKey)} hitSlop={8}>
                <Icon name={showKey ? 'eye-slash' : 'eye'} size={18} color={palette.textMuted} />
              </Pressable>
            </View>
          </Field>
        ) : null}
        <Field label="Timeout" note="Seconds to wait for an answer.">
          <TextInput value={form.timeout} onChangeText={set('timeout')} keyboardType="number-pad" accessibilityLabel="Timeout in seconds" style={input} />
        </Field>
        {form.provider === 'milvus' ? text('database', 'Milvus Database', 'Empty for its default database.') : null}

        {text('collection', 'Collection', form.provider === 'pgvector' ? 'The collection field’s value for this source’s rows.' : 'Its name in the database.')}
        {form.provider === 'pgvector' ? (
          <>
            {text('table', 'Table')}
            {text('collectionField', 'Collection Field', 'The column that names each row’s collection.')}
          </>
        ) : null}
        {text('contentField', 'Text Field', 'Where each row keeps its text.')}
        {text('vectorField', 'Vector Field', form.provider === 'qdrant' ? 'Empty for the collection’s default vector.' : undefined)}
        {text('metadataField', 'Details Field', 'Where each row keeps its source, page and other details.')}
        {text('documentIdField', 'Id Field')}

        <Field label="Test Question" note="It’s saved only after a test finds something; the server tests it again as it saves.">
          <TextInput value={question} onChangeText={setQuestion} accessibilityLabel="Test question" style={input} />
        </Field>
        <View style={styles.start}>
          <Button label={testing ? 'Testing…' : 'Test It'} variant="secondary" disabled={testing || Boolean(testProblem)} onPress={() => void test()} />
        </View>
        {testProblem ? <Text style={[editorStyles.note, { color: palette.textMuted }]}>{testProblem}</Text> : null}
        {testError ? <Text style={[editorStyles.note, { color: palette.danger }]}>{testError}</Text> : null}
        {tested && !testedNow && !testError ? <Text style={[editorStyles.note, { color: palette.textMuted }]}>Changed since the test: test it again.</Text> : null}
        {testedNow && !testedNow.passages.length ? <Text style={[editorStyles.note, { color: palette.danger }]}>It answered, but found nothing: check the collection and the fields.</Text> : null}
        {testedNow?.passages.length && !withText ? <Text style={[editorStyles.note, { color: palette.danger }]}>It found rows, but none had text where the Text Field says: check that field.</Text> : null}
        {testedNow?.passages.length ? (
          <View style={styles.results}>
            <Text style={[styles.found, { color: palette.success }]}>{`Found ${testedNow.passages.length} ${testedNow.passages.length === 1 ? 'passage' : 'passages'}`}</Text>
            {testedNow.passages.map((passage, index) => (
              <View key={index} style={[styles.passage, { borderColor: palette.border, backgroundColor: palette.surface }]}>
                <Text style={[styles.passageText, { color: palette.text }]} numberOfLines={4}>
                  {passage.text || '(no text in the text field)'}
                </Text>
                {passage.distance !== null ? <Text style={[editorStyles.note, { color: palette.textFaint }]}>{`Distance ${passage.distance.toFixed(3)}`}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
        {target.kind === 'new' ? <Text style={[editorStyles.note, { color: palette.textMuted }]}>New sources are private. Share one from its … here, or in Workspace → Knowledge.</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  start: { alignSelf: 'flex-start' },
  results: { gap: 8 },
  found: { fontFamily: fonts.medium, fontSize: 13 },
  passage: { gap: 4, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  passageText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
