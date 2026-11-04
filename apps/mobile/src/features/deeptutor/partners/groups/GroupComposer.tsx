import { resolveMentions, type DtGroupMember } from '@maviechat/deeptutor-protocol';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { useGrowingInput } from '@/lib/useGrowingInput';
import { fonts, radius, usePalette } from '@/theme';
import { PartnerFace } from '../PartnerFace';

/** The `@name` being typed at the end of the text, if any. */
export function typingMention(text: string): string | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(text);
  return match ? (match[2] ?? '') : null;
}

/** An answer quoted into the next message (as the web's Follow Up does: `> Name: words`). */
export interface Quote {
  name: string;
  text: string;
}

export function withQuote(text: string, quote: Quote | null): string {
  if (!quote) return text;
  const words = quote.text.trim().replace(/\s+/g, ' ');
  return `> ${quote.name}: ${words.length > 400 ? `${words.slice(0, 400)}…` : words}\n\n${text}`;
}

/**
 * The message box under a group discussion: `@` offers the members, a line says who'll answer,
 * a quoted answer rides along, and Send, or Stop while a round runs.
 */
export function GroupComposer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  ready,
  members,
  quote,
  onDropQuote,
  note,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  ready: boolean;
  members: DtGroupMember[];
  quote: Quote | null;
  onDropQuote: () => void;
  note?: string;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const field = useGrowingInput(value, onChange);
  const typed = typingMention(value);
  const offered = typed === null ? [] : members.filter((member) => member.name.toLowerCase().includes(typed.toLowerCase()) || member.id.includes(typed.toLowerCase()));
  const who = resolveMentions(value, members);
  const everyone = who.mentions === null || who.mentions.length === 0 || who.targets.length === members.length;
  const canSend = ready && !running && value.trim().length > 0;
  const pickMember = (member: DtGroupMember) => onChange(`${value.replace(/@[^\s@]*$/, '')}@${member.name} `);

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {note ? <Text style={[styles.note, { color: palette.textMuted }]}>{note}</Text> : null}
      {offered.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.offers} keyboardShouldPersistTaps="always">
          {[{ id: 'all', name: 'all', emoji: '👥', color: '', avatar: '', description: '', running: false } as DtGroupMember, ...offered].map((member) => (
            <Pressable
              key={member.id}
              accessibilityRole="button"
              accessibilityLabel={member.id === 'all' ? 'Everyone' : member.name}
              onPress={() => (member.id === 'all' ? onChange(`${value.replace(/@[^\s@]*$/, '')}@all `) : pickMember(member))}
              style={[styles.offer, { borderColor: palette.border, backgroundColor: palette.menu }]}>
              <PartnerFace face={member} size={20} />
              <Text style={[styles.offerText, { color: palette.text }]}>{member.id === 'all' ? 'Everyone' : member.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {quote ? (
        <View style={[styles.quote, { borderColor: palette.border, backgroundColor: palette.surface }]}>
          <Icon name="chat-bubble-left" size={13} color={palette.textMuted} />
          <Text style={[styles.quoteText, { color: palette.textMuted }]} numberOfLines={1}>{`Following up on ${quote.name}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Drop the quote" onPress={onDropQuote} hitSlop={8}>
            <Icon name="x-mark" size={14} color={palette.textMuted} />
          </Pressable>
        </View>
      ) : null}
      <View style={[styles.box, { borderColor: palette.border, backgroundColor: palette.background }]}>
        <TextInput
          value={field.value}
          onChangeText={field.onChangeText}
          placeholder="Message the group (@ to name members)"
          placeholderTextColor={palette.textFaint}
          multiline
          style={[styles.input, { color: palette.text }, field.style]}
          accessibilityLabel="Message"
        />
        {running ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Stop the round" onPress={onStop} style={[styles.send, { backgroundColor: palette.primary }]}>
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
      <Text style={[styles.who, { color: palette.textFaint }]} numberOfLines={1}>
        {[
          everyone ? 'Everyone answers' : `Talking to ${who.targets.map((id) => members.find((member) => member.id === id)?.name ?? id).join(', ')}`,
          who.unknown.length ? `not a member: ${who.unknown.join(' ')}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 6, gap: 6 },
  note: { fontFamily: fonts.regular, fontSize: 12, textAlign: 'center' },
  offers: { gap: 6, paddingHorizontal: 2 },
  offer: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 10, paddingVertical: 4, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth },
  offerText: { fontFamily: fonts.medium, fontSize: 13 },
  quote: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  quoteText: { flex: 1, fontFamily: fonts.regular, fontSize: 12 },
  box: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderWidth: 1, borderRadius: 26, paddingLeft: 16, paddingRight: 8, paddingVertical: 8 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, maxHeight: 160, paddingTop: 5, paddingBottom: 5 },
  send: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 11, height: 11, borderRadius: 2 },
  who: { fontFamily: fonts.regular, fontSize: 11, textAlign: 'center' },
});
