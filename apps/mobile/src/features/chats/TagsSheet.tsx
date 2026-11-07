import { addChatTag, cleanTagName, getChatTags, listTags, removeChatTag, type ChatTag } from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import type { ChatRef } from './useChatActions';

/** The chat menu's "Tags": a sheet to see, add and remove a chat's tags. Render `element` once in the screen. */
export function useTagsSheet(): { open: (chat: ChatRef) => void; element: ReactNode } {
  const [chat, setChat] = useState<ChatRef | null>(null);
  const element = (
    <Modal visible={chat !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setChat(null)}>
      {chat ? <TagsEditor chat={chat} onClose={() => setChat(null)} /> : null}
    </Modal>
  );
  return { open: setChat, element };
}

/**
 * A chat's tags, as the web's tag editor has them: each one removable, a field to add one (Return
 * adds it), and your other tags to pick from. Search finds a tag's chats with `tag:`.
 */
function TagsEditor({ chat, onClose }: { chat: ChatRef; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client } = useAuthed();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const tags = useQuery({ queryKey: ['chat-tags', chat.id], queryFn: () => getChatTags(client, chat.id) });
  const all = useQuery({ queryKey: ['tags'], queryFn: () => listTags(client) });
  const mine = tags.data ?? [];
  const wanted = input.trim().toLowerCase();
  const suggestions = (all.data ?? []).filter((tag) => !mine.some((item) => item.id === tag.id) && (!wanted || tag.name.toLowerCase().includes(wanted))).slice(0, 20);

  const change = async (run: () => Promise<ChatTag[]>) => {
    setBusy(true);
    try {
      queryClient.setQueryData(['chat-tags', chat.id], await run());
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      void queryClient.invalidateQueries({ queryKey: ['chats', 'search'] });
    } catch (error) {
      toast(`Couldn't change the tags: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const add = (raw: string) => {
    const name = cleanTagName(raw);
    if (!name) return;
    setInput('');
    void change(() => addChatTag(client, chat.id, name));
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={1} accessibilityRole="header">
          Tags
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.done, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.note, { color: palette.textMuted }]} numberOfLines={2}>{`On “${chat.title}”`}</Text>
        {tags.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {!tags.isLoading && mine.length === 0 ? <Text style={[styles.note, { color: palette.textFaint }]}>No tags yet.</Text> : null}
        <View style={styles.chips}>
          {mine.map((tag) => (
            <Pressable
              key={tag.id}
              accessibilityRole="button"
              accessibilityLabel={`Remove tag ${tag.name}`}
              disabled={busy}
              onPress={() => void change(() => removeChatTag(client, chat.id, tag.name))}
              style={[styles.chip, { backgroundColor: palette.surfaceStrong }]}>
              <Text style={[styles.chipText, { color: palette.text }]}>{tag.name}</Text>
              <Icon name="x-mark" size={13} color={palette.textMuted} strokeWidth={2} />
            </Pressable>
          ))}
        </View>
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => add(input)}
          placeholder="Add a tag"
          placeholderTextColor={palette.textFaint}
          returnKeyType="done"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          blurOnSubmit={false}
          style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          accessibilityLabel="Add a tag"
        />
        {suggestions.length ? (
          <>
            <Text style={[styles.label, { color: palette.textMuted }]}>Your tags</Text>
            <View style={styles.chips}>
              {suggestions.map((tag) => (
                <Pressable
                  key={tag.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Add tag ${tag.name}`}
                  disabled={busy}
                  onPress={() => add(tag.name)}
                  style={[styles.chip, { borderColor: palette.border, borderWidth: StyleSheet.hairlineWidth }]}>
                  <Icon name="plus" size={13} color={palette.textMuted} strokeWidth={2} />
                  <Text style={[styles.chipText, { color: palette.textMuted }]}>{tag.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.medium, fontSize: 16 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 12 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 6 },
  chipText: { fontFamily: fonts.medium, fontSize: 14 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
});
