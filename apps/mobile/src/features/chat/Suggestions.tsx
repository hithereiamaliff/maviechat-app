import type { PromptSuggestion } from '@maviechat/owui-protocol';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { fonts, radius, usePalette } from '@/theme';
import { filterSuggestions, shuffled } from './search';

/** Room for about three and a half rows, so it's clear the list scrolls. The space stays while you type. */
const LIST_HEIGHT = 170;

interface SuggestionsProps {
  suggestions: PromptSuggestion[];
  /** What's typed in the input; the list narrows to match it. */
  input: string;
  /** The user's "insert suggestion prompt" setting: tapping fills the input instead of sending. */
  inserts: boolean;
  onSelect: (content: string) => void;
}

/** The web's "Suggested" list under the new-chat input: in a fresh order each visit, narrowed as you type. */
export function Suggestions({ suggestions, input, inserts, onSelect }: SuggestionsProps) {
  const palette = usePalette();
  const [seed] = useState(() => Math.random());
  const ordered = useMemo(() => shuffled(suggestions, seed, (item) => item.content), [suggestions, seed]);
  const shown = useMemo(() => filterSuggestions(ordered, input), [ordered, input]);

  if (suggestions.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        {shown.length > 0 ? (
          <>
            <Icon name="bolt" size={14} color={palette.textFaint} />
            <Text style={[styles.label, { color: palette.textFaint }]}>Suggested</Text>
          </>
        ) : null}
      </View>
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        {shown.map((item, index) => {
          const titled = Boolean(item.title?.[0]);
          return (
            <Pressable
              key={`${index}:${item.content}`}
              accessibilityRole="button"
              accessibilityHint={inserts ? 'Puts this prompt in the input' : 'Sends this prompt'}
              onPress={() => onSelect(item.content)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.surface }]}>
              <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                {titled ? item.title?.[0] : item.content}
              </Text>
              <Text style={[styles.subtitle, { color: palette.textMuted }]} numberOfLines={1}>
                {titled ? (item.title?.[1] ?? '') : 'Prompt'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 2, marginBottom: 2 },
  label: { fontFamily: fonts.regular, fontSize: 13 },
  list: { height: LIST_HEIGHT },
  row: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.md },
  title: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
