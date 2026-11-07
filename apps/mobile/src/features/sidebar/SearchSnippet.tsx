import { chatSearchSnippet, isAtLeast, snippetParts } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text } from 'react-native';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, usePalette } from '@/theme';

/**
 * A search result's matching text, the matching words in bold: the server's own (0.11 sends it
 * with the list), or asked for once the row shows (0.12 leaves it out of the list).
 */
export function SearchSnippet({ chatId, snippet, search }: { chatId: string; snippet?: string | null; search: string }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const ask = !snippet && isAtLeast(capabilities?.version, '0.12.0');
  const fetched = useQuery({ queryKey: ['chats', 'snippet', chatId, search], queryFn: () => chatSearchSnippet(client, chatId, search), enabled: ask, staleTime: 5 * 60_000 });
  const text = snippet || fetched.data || '';
  return snippetParts(text, search).map((part, index) =>
    part.match ? (
      <Text key={index} style={[styles.match, { color: palette.text }]}>
        {part.text}
      </Text>
    ) : (
      part.text
    ),
  );
}

const styles = StyleSheet.create({
  match: { fontFamily: fonts.semibold },
});
