import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { fonts, usePalette } from '@/theme';

interface ComposerProps {
  modelLabel: string;
  onPickModel: () => void;
  /** Resolves true when the message was sent (the field is then cleared). */
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  streaming: boolean;
  /** Floating in the middle of the new-chat screen rather than docked at the bottom. */
  floating?: boolean;
  autoFocus?: boolean;
}

/** The web app's phone input bar: text, then +, model, and send/stop. Enter inserts a new line, as on the web. */
export function Composer({ modelLabel, onPickModel, onSend, onStop, streaming, floating = false, autoFocus = false }: ComposerProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const canSend = text.trim().length > 0 && !sending && !streaming;

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    const sent = await onSend(text);
    setSending(false);
    if (sent) setText('');
  };

  return (
    <View style={[styles.wrap, !floating && { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={[styles.box, { borderColor: palette.border, backgroundColor: palette.background }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Send a Message"
          placeholderTextColor={palette.textFaint}
          multiline
          autoFocus={autoFocus}
          style={[styles.input, { color: palette.text }]}
          accessibilityLabel="Message"
        />
        <View style={styles.row}>
          <View style={[styles.round, { borderColor: palette.border, opacity: 0.45 }]} accessibilityLabel="Attachments arrive in a later update">
            <Icon name="plus" size={18} color={palette.textMuted} />
          </View>
          <View style={styles.spacer} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Model: ${modelLabel}. Change model`}
            onPress={onPickModel}
            hitSlop={6}
            style={styles.model}>
            <Text style={[styles.modelText, { color: palette.textMuted }]} numberOfLines={1}>
              {modelLabel}
            </Text>
            <Icon name="chevron-down" size={14} color={palette.textMuted} strokeWidth={2} />
          </Pressable>
          {streaming ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop generating"
              onPress={onStop}
              style={[styles.send, { backgroundColor: palette.primary }]}>
              <View style={[styles.stopSquare, { backgroundColor: palette.onPrimary }]} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: !canSend, busy: sending }}
              disabled={!canSend}
              onPress={() => void submit()}
              style={[styles.send, { backgroundColor: canSend ? palette.primary : palette.surfaceStrong }]}>
              {sending ? (
                <ActivityIndicator size="small" color={palette.onPrimary} />
              ) : (
                <Icon name="arrow-up" size={18} color={canSend ? palette.onPrimary : palette.textFaint} strokeWidth={2.2} />
              )}
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 6 },
  box: { borderWidth: 1, borderRadius: 26, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: 6 },
  input: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, maxHeight: 160, paddingTop: 2, paddingBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  round: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  spacer: { flex: 1 },
  model: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, maxWidth: '55%' },
  modelText: { fontFamily: fonts.medium, fontSize: 13, flexShrink: 1 },
  send: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 11, height: 11, borderRadius: 2 },
});
