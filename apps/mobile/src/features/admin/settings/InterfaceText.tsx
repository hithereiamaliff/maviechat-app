import { dictionaryOf, getAdminConfig, interfaceTextOf, interfaceTextProblem, languageName, saveInterfaceText, WEB_LANGUAGES, type InterfaceTextRow } from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { ActionRow, Group, SectionTitle } from '@/features/settings/rows';
import { editorStyles, SheetHeader } from '@/features/workspace/EditorParts';
import { Chip } from '@/features/workspace/ListControls';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

const TEXT_KEY = ['admin', 'interface-text'];

type Row = InterfaceTextRow & { key: number };

/** The same dictionary, whatever order its languages and texts were added in. */
const sameText = (a: InterfaceTextRow[], b: InterfaceTextRow[]) => {
  const canonical = (rows: InterfaceTextRow[]) =>
    JSON.stringify(
      Object.entries(dictionaryOf(rows))
        .map(([language, texts]) => [language, Object.entries(texts).sort()] as const)
        .sort(),
    );
  return canonical(a) === canonical(b);
};

/**
 * Interface Text (Open WebUI 0.12, the web's Admin → General, its interface part): the web's own
 * wording replaced, language by language. Shown only where the server has it; edited in a sheet
 * and saved over the admin config as it is then. The app's own words don't change.
 */
export function InterfaceText() {
  const { client } = useAuthed();
  const text = useQuery({ queryKey: TEXT_KEY, queryFn: async () => interfaceTextOf(await getAdminConfig(client)), staleTime: 0 });
  const [open, setOpen] = useState(false);
  if (text.data === null) return null;
  const rows = text.data ?? [];
  const languages = new Set(rows.flatMap((row) => Object.keys(row.replacements)));
  return (
    <View style={styles.wrap}>
      <SectionTitle title="Interface Text" />
      <Group>
        <ActionRow
          label="The web’s own words"
          hint="Changed or translated, language by language (the web only; this app’s words are its own)."
          value={text.isPending ? '…' : text.error ? 'Couldn’t load' : rows.length ? `${rows.length} in ${languages.size} ${languages.size === 1 ? 'language' : 'languages'}` : 'None'}
          onPress={() => setOpen(true)}
        />
      </Group>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        {open ? <Editor onClose={() => setOpen(false)} /> : null}
      </Modal>
    </View>
  );
}

function Editor({ onClose }: { onClose: () => void }) {
  const { client } = useAuthed();
  // Read again as the sheet opens, so the save goes over what's saved now.
  const saved = useQuery({ queryKey: TEXT_KEY, queryFn: async () => interfaceTextOf(await getAdminConfig(client)), staleTime: 0, gcTime: 0 });
  const palette = usePalette();
  if (saved.data === undefined) {
    return (
      <View style={[editorStyles.sheet, editorStyles.center, { backgroundColor: palette.background }]}>
        {saved.isError ? <Text style={[editorStyles.note, { color: palette.danger }]}>{`Couldn’t load it: ${describeError(saved.error)}`}</Text> : <ActivityIndicator color={palette.textMuted} />}
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[editorStyles.action, { color: palette.link }]}>Close</Text>
        </Pressable>
      </View>
    );
  }
  return <Form initial={saved.data ?? []} onClose={onClose} />;
}

function Form({ initial, onClose }: { initial: InterfaceTextRow[]; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => initial.map((row, index) => ({ ...row, key: index })));
  const nextKey = useRef(initial.length);
  const used = [...new Set(rows.flatMap((row) => Object.keys(row.replacements)))];
  const [language, setLanguage] = useState(used[0] ?? 'en-US');
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const problem = interfaceTextProblem(rows);
  const changed = !sameText(rows, initial);
  const chips = used.includes(language) ? used : [...used, language];

  const update = (key: number, change: (row: Row) => Row) => setRows(rows.map((row) => (row.key === key ? change(row) : row)));
  const add = () => {
    const key = nextKey.current;
    nextKey.current += 1;
    setRows([...rows, { key, original: '', replacements: {} }]);
  };
  // As on the web: the replacement in this language goes; a row with none left goes too.
  const remove = (row: Row) => {
    const replacements = Object.fromEntries(Object.entries(row.replacements).filter(([code]) => code !== language));
    setRows(Object.values(replacements).some((text) => text.trim()) ? rows.map((item) => (item.key === row.key ? { ...item, replacements } : item)) : rows.filter((item) => item.key !== row.key));
  };
  const close = () => {
    if (!changed) return onClose();
    Alert.alert('Discard your changes?', undefined, [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };
  const save = () => {
    if (problem || !changed || busy) return;
    const dictionary = dictionaryOf(rows);
    const texts = new Set(Object.values(dictionary).flatMap((item) => Object.keys(item))).size;
    Alert.alert('Save the interface text?', `${texts} ${texts === 1 ? 'text' : 'texts'} in ${Object.keys(dictionary).length} ${Object.keys(dictionary).length === 1 ? 'language' : 'languages'}. Browsers get them the next time the web loads.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: () =>
          void (async () => {
            setBusy(true);
            try {
              queryClient.setQueryData(TEXT_KEY, await saveInterfaceText(client, rows));
              toast('Interface text saved');
              onClose();
            } catch (error) {
              toast(`Couldn’t save it: ${describeError(error)}`, 'error');
            } finally {
              setBusy(false);
            }
          })(),
      },
    ]);
  };
  const input = [editorStyles.input, styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];

  return (
    <KeyboardAvoidingView behavior="padding" style={[editorStyles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title="Interface Text" onCancel={close} onSave={save} canSave={changed && !problem} busy={busy} />
      <ScrollView contentContainerStyle={editorStyles.content} keyboardShouldPersistTaps="handled">
        <Text style={[editorStyles.note, { color: palette.textMuted }]}>
          {'Write a text of the web’s exactly as it is (its English words, or its key), then what to show instead in this language. Placeholders such as {{name}} must stay. Only the web’s words change.'}
        </Text>
        <View style={styles.chips}>
          {chips.map((code) => (
            <Chip key={code} label={languageName(code)} on={code === language} onPress={() => setLanguage(code)} />
          ))}
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: choosing }} onPress={() => setChoosing(!choosing)} hitSlop={6} style={styles.another}>
            <Text style={[styles.anotherText, { color: palette.link }]}>{choosing ? 'Done' : 'Another Language…'}</Text>
          </Pressable>
        </View>
        {choosing ? (
          <View style={[styles.languages, { borderColor: palette.border }]}>
            {WEB_LANGUAGES.map((code) => (
              <Pressable
                key={code}
                accessibilityRole="button"
                accessibilityState={{ selected: code === language }}
                onPress={() => {
                  setLanguage(code);
                  setChoosing(false);
                }}
                style={({ pressed }) => [styles.language, pressed && { backgroundColor: palette.surface }]}>
                <Text style={[styles.languageText, { color: palette.text }]}>{languageName(code)}</Text>
                {code === language ? <Icon name="check" size={14} color={palette.link} /> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
        {rows.length ? null : <Text style={[editorStyles.note, { color: palette.textFaint }]}>No texts changed yet.</Text>}
        {rows.map((row) => (
          <View key={row.key} style={[styles.row, { borderColor: palette.border }]}>
            <View style={styles.fields}>
              <TextInput
                value={row.original}
                onChangeText={(original) => update(row.key, (item) => ({ ...item, original }))}
                placeholder="The web’s text"
                placeholderTextColor={palette.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                accessibilityLabel="The web’s text"
                style={[input, { color: palette.textMuted }]}
              />
              <TextInput
                value={row.replacements[language] ?? ''}
                onChangeText={(text) => update(row.key, (item) => ({ ...item, replacements: { ...item.replacements, [language]: text } }))}
                placeholder={`Instead, in ${languageName(language)}`}
                placeholderTextColor={palette.textFaint}
                multiline
                accessibilityLabel={`What to show instead, in ${languageName(language)}`}
                style={input}
              />
            </View>
            <IconButton icon="x-mark" label={`Remove this text’s ${languageName(language)} replacement`} size={16} color={palette.textMuted} onPress={() => remove(row)} />
          </View>
        ))}
        <Pressable accessibilityRole="button" onPress={add} hitSlop={6} style={styles.add}>
          <Icon name="plus" size={15} color={palette.link} />
          <Text style={[styles.anotherText, { color: palette.link }]}>Add Text</Text>
        </Pressable>
        {problem ? <Text style={[editorStyles.note, { color: palette.danger }]}>{problem}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  another: { paddingVertical: 4, paddingHorizontal: 2 },
  anotherText: { fontFamily: fonts.medium, fontSize: 14 },
  languages: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  language: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
  languageText: { fontFamily: fonts.regular, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  fields: { flex: 1, gap: 6 },
  input: { paddingVertical: 8, fontSize: 14 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4 },
});
