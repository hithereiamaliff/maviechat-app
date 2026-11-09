import { diffBlocks, mergeText, type DiffBlock, type MergeChoice } from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { editorStyles, SheetHeader } from '@/features/workspace/EditorParts';
import { Chip } from '@/features/workspace/ListControls';
import { fonts, radius, usePalette } from '@/theme';

const CHOICES: { value: MergeChoice; label: string }[] = [
  { value: 'revision', label: 'Revision' },
  { value: 'current', label: 'Current' },
  { value: 'both', label: 'Both' },
];

/** Unchanged runs longer than this are folded. */
const FOLD = 4;

/**
 * Comparing a text with a revision you paste, and taking the parts you want (0.12's comparison
 * of a revision, in its prompt, model and skill editors and the chat's input): each change shows
 * what the current text has and what the revision has; keep the revision's (as at first), the
 * current lines, or both. Apply puts the result in place of the text; saving stays yours to do.
 */
export function RevisionMergeSheet({ current, title, applyLabel = 'Apply', onApply, onClose }: { current: string | null; title: string; applyLabel?: string; onApply: (text: string) => void; onClose: () => void }) {
  return (
    <Modal visible={current !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {current !== null ? <Merge current={current} title={title} applyLabel={applyLabel} onApply={onApply} onClose={onClose} /> : null}
    </Modal>
  );
}

function Merge({ current, title, applyLabel, onApply, onClose }: { current: string; title: string; applyLabel: string; onApply: (text: string) => void; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const [revision, setRevision] = useState('');
  const [comparing, setComparing] = useState(false);
  const [choices, setChoices] = useState<Record<number, MergeChoice>>({});
  const [unfolded, setUnfolded] = useState<number[]>([]);

  // Each block with its change's number (changes count from 0, as the merge counts them).
  const numbered: { block: DiffBlock; change: number }[] = [];
  let changes = 0;
  if (comparing) {
    for (const block of diffBlocks(current, revision)) {
      numbered.push({ block, change: block.kind === 'change' ? changes : -1 });
      if (block.kind === 'change') changes += 1;
    }
  }
  const allCurrent = Object.fromEntries(Array.from({ length: changes }, (_, index) => [index, 'current' as const]));

  const paste = () =>
    void Clipboard.getStringAsync().then(
      (text) => (text ? setRevision(text) : toast('There’s no text to paste.', 'error')),
      () => toast('Couldn’t read what you copied.', 'error'),
    );
  const apply = () => {
    onApply(mergeText(current, revision, choices));
    onClose();
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[editorStyles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={title} onCancel={onClose} onSave={apply} canSave={comparing && changes > 0} busy={false} saveLabel={applyLabel} />
      <ScrollView contentContainerStyle={editorStyles.content} keyboardShouldPersistTaps="handled">
        {!comparing ? (
          <>
            <Text style={[editorStyles.note, { color: palette.textMuted }]}>
              Paste a revision of this text, an edited copy or another draft. Then go through the changes: keep the revision’s, the current lines, or both.
            </Text>
            <View style={styles.buttons}>
              <Button label="Paste" variant="secondary" onPress={paste} />
              <Button
                label="Compare"
                disabled={!revision.trim()}
                onPress={() => {
                  setChoices({});
                  setUnfolded([]);
                  setComparing(true);
                }}
              />
            </View>
            <TextInput
              value={revision}
              onChangeText={setRevision}
              multiline
              placeholder="The revision"
              placeholderTextColor={palette.textFaint}
              accessibilityLabel="The revision"
              style={[editorStyles.input, styles.revision, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
            />
          </>
        ) : (
          <>
            <Text style={[styles.summary, { color: palette.text }]}>{changes ? `${changes} ${changes === 1 ? 'change' : 'changes'}: the revision’s are kept unless you choose otherwise.` : 'The revision is the same text.'}</Text>
            {changes > 1 ? (
              <View style={styles.buttons}>
                <Chip label="All from the Revision" on={Object.values(choices).every((choice) => choice === 'revision')} onPress={() => setChoices({})} />
                <Chip label="All Current" on={Object.keys(choices).length === changes && Object.values(choices).every((choice) => choice === 'current')} onPress={() => setChoices(allCurrent)} />
              </View>
            ) : null}
            {numbered.map(({ block, change }, index) =>
              block.kind === 'same' ? (
                <SameRun key={index} lines={block.lines} open={unfolded.includes(index) || block.lines.length <= FOLD} onOpen={() => setUnfolded([...unfolded, index])} />
              ) : (
                <View key={index} style={[styles.change, { borderColor: palette.border }]}>
                  {block.removed.map((line, at) => (
                    <Line key={`r${at}`} sign="−" text={line} color={palette.danger} faded={(choices[change] ?? 'revision') === 'revision'} />
                  ))}
                  {block.added.map((line, at) => (
                    <Line key={`a${at}`} sign="+" text={line} color={palette.success} faded={(choices[change] ?? 'revision') === 'current'} />
                  ))}
                  <View style={styles.choices}>
                    {CHOICES.map((choice) => (
                      <Chip key={choice.value} label={choice.label} on={(choices[change] ?? 'revision') === choice.value} onPress={() => setChoices({ ...choices, [change]: choice.value })} />
                    ))}
                  </View>
                </View>
              ),
            )}
            <Pressable accessibilityRole="button" onPress={() => setComparing(false)} hitSlop={6} style={styles.back}>
              <Text style={[styles.backText, { color: palette.link }]}>Change the Revision</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Lines both texts share: folded when there are many. */
function SameRun({ lines, open, onOpen }: { lines: string[]; open: boolean; onOpen: () => void }) {
  const palette = usePalette();
  if (!open) {
    return (
      <Pressable accessibilityRole="button" accessibilityHint="Shows them" onPress={onOpen} hitSlop={4} style={styles.fold}>
        <Text style={[styles.foldText, { color: palette.textFaint }]}>{`⋯ ${lines.length} lines the same ⋯`}</Text>
      </Pressable>
    );
  }
  return (
    <View>
      {lines.map((line, index) => (
        <Line key={index} sign=" " text={line} color={palette.textFaint} />
      ))}
    </View>
  );
}

/** One line: a change's sign and its colour, dimmed when the merge leaves it out. */
function Line({ sign, text, color, faded = false }: { sign: string; text: string; color: string; faded?: boolean }) {
  const palette = usePalette();
  const changed = sign !== ' ';
  return (
    <View style={[styles.line, changed && { backgroundColor: `${color}22` }, faded && styles.faded]}>
      <Text style={[styles.sign, { color }]}>{sign}</Text>
      <Text style={[styles.text, { color: changed ? palette.text : palette.textMuted }, faded && styles.struck]}>{text || ' '}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  revision: { minHeight: 220, textAlignVertical: 'top', fontSize: 14, lineHeight: 20 },
  summary: { fontFamily: fonts.medium, fontSize: 13 },
  change: { gap: 2, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  choices: { flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingTop: 6 },
  line: { flexDirection: 'row', paddingRight: 8 },
  sign: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, width: 22, textAlign: 'center' },
  text: { flex: 1, fontFamily: fonts.mono, fontSize: 12, lineHeight: 18 },
  faded: { opacity: 0.45 },
  struck: { textDecorationLine: 'line-through' },
  fold: { paddingVertical: 4 },
  foldText: { fontFamily: fonts.mono, fontSize: 12, textAlign: 'center' },
  back: { alignSelf: 'flex-start', paddingVertical: 4 },
  backText: { fontFamily: fonts.medium, fontSize: 14 },
});
