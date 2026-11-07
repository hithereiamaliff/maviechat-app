import { useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type KeyboardTypeOptions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { closeDialog, currentDialog, subscribeDialogs, type PromptButton, type PromptRequest, type SheetRequest } from '@/lib/dialogQueue';
import { fonts, radius, usePalette } from '@/theme';
import { Modal } from './Modal';

/**
 * Android's text prompts and action sheets (`components/dialogs.ts`), one at a time. Mounted on
 * Android only: on iPhone, iOS shows its own.
 */
export function DialogHost() {
  const request = useSyncExternalStore(subscribeDialogs, currentDialog);
  if (!request) return null;
  return request.kind === 'prompt' ? <PromptDialog key={request.id} request={request} /> : <ActionSheet key={request.id} request={request} />;
}

function PromptDialog({ request }: { request: PromptRequest & { id: number } }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [value, setValue] = useState(request.defaultValue);

  // Closes first, so a dialog the button opens comes next.
  const press = (button: PromptButton | null) => {
    closeDialog(request.id);
    button?.onPress?.(value);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => press(request.cancel)}>
      {/* High on the screen, so the keyboard doesn't cover it. */}
      <View style={[styles.promptFrame, { paddingTop: Math.max(insets.top + 24, height * 0.14) }]}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} onPress={() => press(request.cancel)} accessibilityLabel="Cancel" />
        <View style={[styles.card, { backgroundColor: palette.menu, borderColor: palette.border, shadowColor: '#000' }]}>
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            {request.title}
          </Text>
          {request.message ? <Text style={[styles.message, { color: palette.textMuted }]}>{request.message}</Text> : null}
          <TextInput
            autoFocus
            value={value}
            onChangeText={setValue}
            secureTextEntry={request.secure}
            autoCapitalize={request.secure ? 'none' : 'sentences'}
            keyboardType={(request.keyboardType ?? 'default') as KeyboardTypeOptions}
            returnKeyType="done"
            onSubmitEditing={() => press(request.submit)}
            selectionColor={palette.link}
            style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
          <View style={styles.buttons}>
            {request.buttons.map((button, index) => (
              <Pressable
                key={`${index}:${button.text}`}
                accessibilityRole="button"
                onPress={() => press(button)}
                style={({ pressed }) => [styles.button, pressed && { backgroundColor: palette.surfaceStrong }]}>
                <Text style={[styles.buttonText, { color: button.style === 'destructive' ? palette.danger : button.style === 'cancel' ? palette.textMuted : palette.link }]}>
                  {button.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ActionSheet({ request }: { request: SheetRequest & { id: number } }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  // Closes first, so a dialog the choice opens comes next. Going back or tapping outside picks
  // the cancel option, as iOS reports it.
  const pick = (index: number | null) => {
    closeDialog(request.id);
    if (index !== null) request.onPick(index);
  };
  const cancel = () => pick(request.cancel ? request.cancel.index : null);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={cancel}>
      <View style={styles.sheetFrame}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} onPress={cancel} accessibilityLabel="Cancel" />
        <View style={[styles.sheet, { backgroundColor: palette.menu, paddingBottom: insets.bottom + 8, maxHeight: height * 0.85 }]}>
          {request.title || request.message ? (
            <View style={[styles.sheetHeader, { borderBottomColor: palette.border }]}>
              {request.title ? (
                <Text style={[styles.sheetTitle, { color: palette.textMuted }]} numberOfLines={3}>
                  {request.title}
                </Text>
              ) : null}
              {request.message ? (
                <Text style={[styles.sheetMessage, { color: palette.textFaint }]} numberOfLines={4}>
                  {request.message}
                </Text>
              ) : null}
            </View>
          ) : null}
          <ScrollView>
            {request.rows.map((row) => (
              <Pressable
                key={row.index}
                accessibilityRole="button"
                accessibilityState={{ disabled: row.disabled }}
                disabled={row.disabled}
                onPress={() => pick(row.index)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.surfaceStrong }]}>
                <Text style={[styles.rowText, { color: row.destructive ? palette.danger : palette.text }, row.disabled && styles.disabled]} numberOfLines={2}>
                  {row.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {request.cancel ? (
            <Pressable
              accessibilityRole="button"
              onPress={cancel}
              style={({ pressed }) => [styles.row, styles.cancelRow, { borderTopColor: palette.border }, pressed && { backgroundColor: palette.surfaceStrong }]}>
              <Text style={[styles.rowText, styles.cancelText, { color: palette.textMuted }]}>{request.cancel.label}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  promptFrame: { flex: 1, alignItems: 'center', paddingHorizontal: 24 },
  card: {
    width: '100%',
    maxWidth: 420,
    padding: 20,
    gap: 12,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  message: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  input: {
    fontFamily: fonts.regular,
    fontSize: 16,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4 },
  button: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md },
  buttonText: { fontFamily: fonts.semibold, fontSize: 15 },
  sheetFrame: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: 8 },
  sheetHeader: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  sheetMessage: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  row: { minHeight: 52, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  rowText: { fontFamily: fonts.regular, fontSize: 16 },
  disabled: { opacity: 0.4 },
  cancelRow: { marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  cancelText: { fontFamily: fonts.medium },
});
