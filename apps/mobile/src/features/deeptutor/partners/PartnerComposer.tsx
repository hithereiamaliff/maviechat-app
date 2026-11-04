import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { useGrowingInput } from '@/lib/useGrowingInput';
import { fonts, usePalette } from '@/theme';

/**
 * The input under a partner chat: your message, then Send, or Stop while the partner replies.
 * `note` says why it can't send yet (connecting, or the partner can't be reached).
 */
export function PartnerComposer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  ready,
  note,
  placeholder,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  ready: boolean;
  note?: string;
  placeholder: string;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const field = useGrowingInput(value, onChange);
  const canSend = ready && !running && value.trim().length > 0;
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {note ? <Text style={[styles.note, { color: palette.textMuted }]}>{note}</Text> : null}
      <View style={[styles.box, { borderColor: palette.border, backgroundColor: palette.background }]}>
        <TextInput
          value={field.value}
          onChangeText={field.onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.textFaint}
          multiline
          style={[styles.input, { color: palette.text }, field.style]}
          accessibilityLabel="Message"
        />
        {running ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Stop the reply" onPress={onStop} style={[styles.send, { backgroundColor: palette.primary }]}>
            <View style={[styles.stopSquare, { backgroundColor: palette.onPrimary }]} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={onSend}
            style={[styles.send, { backgroundColor: canSend ? palette.primary : palette.surfaceStrong }]}>
            <Icon name="arrow-up" size={18} color={canSend ? palette.onPrimary : palette.textFaint} strokeWidth={2.2} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 6, gap: 6 },
  note: { fontFamily: fonts.regular, fontSize: 12, textAlign: 'center' },
  box: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderWidth: 1, borderRadius: 26, paddingLeft: 16, paddingRight: 8, paddingVertical: 8 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, maxHeight: 160, paddingTop: 5, paddingBottom: 5 },
  send: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 11, height: 11, borderRadius: 2 },
});
