import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import {
  DEFAULT_SELECTION_ACTIONS,
  newSelectionAction,
  savedSelectionActions,
  selectionActionsSetting,
  wantsInput,
  type SelectionAction,
} from '@/features/chat/selectionActions';
import { useUserSettings } from '@/lib/server';
import { useSaveUiSettings } from '@/lib/uiSettings';
import { fonts, radius, usePalette } from '@/theme';
import { Group, Note, rowStyles, SwitchRow } from './rows';

/**
 * The web's Quick Actions editor: Ask and Explain, or your own list of actions for text you
 * select in a reply, each a label and a prompt. Saved with your account, so the web uses it too.
 */
export function QuickActionsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const palette = usePalette();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Editor onClose={onClose} /> : <View style={{ backgroundColor: palette.background }} />}
    </Modal>
  );
}

function Editor({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const settings = useUserSettings();
  const save = useSaveUiSettings();
  // null: the web's Ask and Explain.
  const [list, setList] = useState<SelectionAction[] | null>(() => savedSelectionActions(settings.data?.ui));
  const [busy, setBusy] = useState(false);

  const change = (index: number, edit: Partial<Pick<SelectionAction, 'label' | 'prompt'>>) =>
    setList((current) => current?.map((action, at) => (at === index ? { ...action, ...edit, input: wantsInput(edit.prompt ?? action.prompt) } : action)) ?? null);

  const done = async () => {
    if (list?.some((action) => !action.label.trim() || !action.prompt.trim())) {
      toast('Each action needs a label and a prompt.', 'error');
      return;
    }
    setBusy(true);
    const saved = await save({ floatingActionButtons: selectionActionsSetting(list) });
    setBusy(false);
    if (saved) onClose();
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} style={styles.side}>
          <Text style={[styles.headerAction, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Quick Actions
        </Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void done()} hitSlop={10} style={[styles.side, styles.end]}>
          <Text style={[styles.headerAction, styles.save, { color: busy ? palette.textFaint : palette.link }]}>Save</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={rowStyles.content} keyboardShouldPersistTaps="handled">
        <Group>
          <SwitchRow
            label="Ask and Explain"
            hint="The web’s two actions. Off, you make your own list."
            value={list === null}
            onChange={(on) => setList(on ? null : DEFAULT_SELECTION_ACTIONS.map((action) => ({ ...action })))}
          />
        </Group>
        {list?.map((action, index) => (
          <View key={`${index}-${action.id}`} style={[styles.card, { borderColor: palette.border }]}>
            <View style={styles.cardHeader}>
              <TextInput
                value={action.label}
                onChangeText={(label) => change(index, { label })}
                placeholder="Label"
                placeholderTextColor={palette.textFaint}
                accessibilityLabel="Action label"
                style={[styles.label, { color: palette.text }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${action.label || 'this action'}`}
                hitSlop={10}
                onPress={() => setList((current) => current?.filter((_, at) => at !== index) ?? null)}>
                <Icon name="minus" size={18} color={palette.danger} strokeWidth={2} />
              </Pressable>
            </View>
            <TextInput
              value={action.prompt}
              onChangeText={(prompt) => change(index, { prompt })}
              placeholder="Prompt"
              placeholderTextColor={palette.textFaint}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Action prompt"
              style={[styles.prompt, { color: palette.text, backgroundColor: palette.surface }]}
            />
            <Text style={[styles.hint, { color: palette.textMuted }]}>{action.input ? 'Asks you for {{INPUT_CONTENT}} first.' : 'Fills the message box at once.'}</Text>
          </View>
        ))}
        {list ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setList((current) => [...(current ?? []), newSelectionAction(current ?? [])])}
            style={({ pressed }) => [styles.add, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <Icon name="plus" size={16} color={palette.text} strokeWidth={2} />
            <Text style={[styles.addText, { color: palette.text }]}>Add Action</Text>
          </Pressable>
        ) : null}
        <Note>
          In a prompt, {'{{SELECTED_CONTENT}}'} is the selected text quoted, {'{{CONTENT}}'} the text as it is, and {'{{INPUT_CONTENT}}'} what you type after tapping
          the action (you’re asked only when the prompt has it). An action fills the message box; you send it. Find them in a reply’s Select Text.
        </Note>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  side: { width: 64 },
  end: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  headerAction: { fontFamily: fonts.regular, fontSize: 16 },
  save: { fontFamily: fonts.semibold },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 12, gap: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flex: 1, fontFamily: fonts.medium, fontSize: 16, paddingVertical: 4 },
  prompt: { minHeight: 64, borderRadius: radius.md, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8, fontFamily: fonts.mono, fontSize: 13, lineHeight: 19, textAlignVertical: 'top' },
  hint: { fontFamily: fonts.regular, fontSize: 12 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingVertical: 12 },
  addText: { fontFamily: fonts.medium, fontSize: 15 },
});
