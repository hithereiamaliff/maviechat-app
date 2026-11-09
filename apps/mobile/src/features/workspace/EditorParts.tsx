import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { describeError } from '@/lib/errors';
import { fonts, radius, usePalette } from '@/theme';

/** A Workspace sheet's top bar: Cancel (Done when read-only), the title, and Save. */
export function SheetHeader({ title, onCancel, onSave, canSave, busy, readOnly = false, saveLabel = 'Save' }: { title: string; onCancel: () => void; onSave: () => void; canSave: boolean; busy: boolean; readOnly?: boolean; saveLabel?: string }) {
  const palette = usePalette();
  return (
    <View style={editorStyles.header}>
      <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={10}>
        <Text style={[editorStyles.action, { color: palette.link }]}>{readOnly ? 'Done' : 'Cancel'}</Text>
      </Pressable>
      <Text style={[editorStyles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      {readOnly ? (
        <View style={editorStyles.placeholder} />
      ) : busy ? (
        <ActivityIndicator color={palette.textMuted} />
      ) : (
        <Pressable accessibilityRole="button" disabled={!canSave} onPress={onSave} hitSlop={10}>
          <Text style={[editorStyles.action, editorStyles.strong, { color: canSave ? palette.link : palette.textFaint }]}>{saveLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** While a sheet's item loads (or why it couldn't). */
export function SheetLoading({ error, onClose }: { error: unknown; onClose: () => void }) {
  const palette = usePalette();
  return (
    <View style={[editorStyles.sheet, editorStyles.center, { backgroundColor: palette.background }]}>
      {error ? <Text style={[editorStyles.note, { color: palette.danger }]}>{`Couldn’t open it: ${describeError(error)}`}</Text> : <ActivityIndicator color={palette.textMuted} />}
      <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
        <Text style={[editorStyles.action, { color: palette.link }]}>Close</Text>
      </Pressable>
    </View>
  );
}

/** A labelled field, with a note under it (red when it's a problem). */
export function Field({ label, note, problem = false, children }: { label: string; note?: string | null; problem?: boolean; children: ReactNode }) {
  const palette = usePalette();
  return (
    <View style={editorStyles.field}>
      <Text style={[editorStyles.label, { color: palette.text }]}>{label}</Text>
      {children}
      {note ? <Text style={[editorStyles.note, { color: problem ? palette.danger : palette.textMuted }]}>{note}</Text> : null}
    </View>
  );
}

/** Tags as chips (tap one to take it off) and a field to add another. */
export function TagsField({ tags, setTags, readOnly }: { tags: string[]; setTags: (tags: string[]) => void; readOnly: boolean }) {
  const palette = usePalette();
  const [draft, setDraft] = useState('');
  const add = () => {
    const tag = draft.trim();
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setDraft('');
  };
  return (
    <Field label="Tags">
      {tags.length ? (
        <View style={editorStyles.tags}>
          {tags.map((tag) => (
            <Pressable key={tag} accessibilityRole="button" accessibilityLabel={`Remove ${tag}`} disabled={readOnly} onPress={() => setTags(tags.filter((item) => item !== tag))} style={[editorStyles.tag, { borderColor: palette.border }]}>
              <Text style={[editorStyles.tagText, { color: palette.text }]}>{tag}</Text>
              {readOnly ? null : <Icon name="x-mark" size={11} color={palette.textMuted} />}
            </Pressable>
          ))}
        </View>
      ) : readOnly ? (
        <Text style={[editorStyles.note, { color: palette.textFaint }]}>None</Text>
      ) : null}
      {readOnly ? null : <TextInput value={draft} onChangeText={setDraft} onSubmitEditing={add} returnKeyType="done" autoCapitalize="none" autoCorrect={false} placeholder="Add a tag" placeholderTextColor={palette.textFaint} accessibilityLabel="Add a tag" style={[editorStyles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />}
    </Field>
  );
}

/** Picks a text file in Files and reads it on the phone (nothing is sent until the caller does). */
export async function pickTextFile(type: string | string[], limitBytes = 5 * 1024 * 1024): Promise<{ name: string; text: string } | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type, copyToCacheDirectory: true });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (!asset) return null;
  if ((asset.size ?? 0) > limitBytes) throw new Error('the file is too big to import on the phone');
  return { name: asset.name, text: await new File(asset.uri).text() };
}

export const plural = (count: number, one: string, many = `${one}s`): string => `${count.toLocaleString()} ${count === 1 ? one : many}`;

export const editorStyles = StyleSheet.create({
  sheet: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  placeholder: { width: 40 },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  problem: { padding: 10, borderWidth: 1, borderRadius: radius.md, fontSize: 13 },
  field: { gap: 6 },
  label: { fontFamily: fonts.medium, fontSize: 14 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  mono: { fontFamily: fonts.mono, fontSize: 13 },
  body: { minHeight: 220, fontFamily: fonts.mono, fontSize: 13, lineHeight: 19, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  tagText: { fontFamily: fonts.regular, fontSize: 13 },
});
