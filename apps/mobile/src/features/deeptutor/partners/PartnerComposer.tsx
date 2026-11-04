import type { DtPartnerCommand } from '@maviechat/deeptutor-protocol';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { DtExtrasStrip, type ExtraChip } from '@/features/deeptutor/chat/DtExtrasViews';
import { useGrowingInput } from '@/lib/useGrowingInput';
import { fonts, radius, usePalette } from '@/theme';

/** The commands matching what's typed, while it's a bare `/word` (as the web's list opens). */
export function matchingCommands(text: string, commands: DtPartnerCommand[]): DtPartnerCommand[] {
  if (!/^\/[a-z_-]*$/i.test(text)) return [];
  const typed = text.toLowerCase();
  return commands.filter((row) => row.command.startsWith(typed) && row.command !== typed).slice(0, 8);
}

/**
 * The input under a partner chat: photos and files (the + menu), your message, then Send, or Stop
 * while the partner replies. Typing `/` lists the partner's commands. `note` says why it can't send yet.
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
  chips,
  attach,
  commands,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  ready: boolean;
  note?: string;
  placeholder: string;
  chips: ExtraChip[];
  attach: MenuItem[];
  commands: DtPartnerCommand[];
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const field = useGrowingInput(value, onChange);
  const canSend = ready && !running && (value.trim().length > 0 || chips.length > 0);
  const offered = matchingCommands(value, commands);
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {note ? <Text style={[styles.note, { color: palette.textMuted }]}>{note}</Text> : null}
      {offered.length ? (
        <View style={[styles.palette, { borderColor: palette.border, backgroundColor: palette.menu }]} accessibilityRole="menu">
          {offered.map((row, index) => (
            <Pressable
              key={row.command}
              accessibilityRole="menuitem"
              accessibilityLabel={`${row.command}: ${row.description}`}
              onPress={() => onChange(row.argHint ? `${row.command} ` : row.command)}
              style={({ pressed }) => [styles.command, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <Text style={[styles.commandName, { color: palette.text }]}>
                {row.command}
                {row.argHint ? <Text style={{ color: palette.textFaint }}>{` ${row.argHint}`}</Text> : null}
              </Text>
              {row.description ? (
                <Text style={[styles.commandHint, { color: palette.textMuted }]} numberOfLines={1}>
                  {row.description}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={[styles.box, { borderColor: palette.border, backgroundColor: palette.background }]}>
        <DtExtrasStrip chips={chips} />
        <View style={styles.row}>
          <MenuButton items={attach} label="Add photos or files" icon="plus" size={20} color={palette.textMuted} />
          <TextInput
            value={field.value}
            onChangeText={field.onChangeText}
            placeholder={placeholder}
            placeholderTextColor={palette.textFaint}
            multiline
            autoCapitalize="sentences"
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 6, gap: 6 },
  note: { fontFamily: fonts.regular, fontSize: 12, textAlign: 'center' },
  palette: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  command: { paddingHorizontal: 14, paddingVertical: 9, gap: 2 },
  commandName: { fontFamily: fonts.mono, fontSize: 14 },
  commandHint: { fontFamily: fonts.regular, fontSize: 12 },
  box: { borderWidth: 1, borderRadius: 26, paddingLeft: 4, paddingRight: 8, paddingVertical: 6, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, maxHeight: 160, paddingTop: 7, paddingBottom: 7 },
  send: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  stopSquare: { width: 11, height: 11, borderRadius: 2 },
});
