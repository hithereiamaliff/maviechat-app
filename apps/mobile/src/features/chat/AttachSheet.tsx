import {
  chatReferenceItem,
  fileSizeLabel,
  knowledgeAttachment,
  listChats,
  listNoteChoices,
  noteReferenceItem,
  previousFileItem,
  searchChats,
  searchFiles,
  uuidv4,
  type FileItem,
} from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useAuthed, useKnowledgeSearch } from '@/lib/server';
import { useDebounced } from '@/lib/useDebounced';
import { fonts, radius, usePalette } from '@/theme';
import { updateDraft } from './drafts';

/** The + menu's lists of what's already on the server. */
export type AttachMode = 'files' | 'notes' | 'knowledge' | 'chats';

const TITLES: Record<AttachMode, string> = { files: 'Attach Files', notes: 'Attach Notes', knowledge: 'Attach Knowledge', chats: 'Reference Chats' };
const PLACEHOLDERS: Record<AttachMode, string> = { files: 'Search your files', notes: 'Search notes', knowledge: 'Search knowledge', chats: 'Search chats' };

interface Row {
  key: string;
  icon: IconName;
  title: string;
  subtitle: string;
  item: () => FileItem;
}

/**
 * Attach Files (yours, uploaded before), Attach Notes, Attach Knowledge (bases and their files)
 * or Reference Chats (another chat for the model to read), as the web's + menu offers them. A
 * pick joins the message's attachments, once.
 */
export function AttachSheet({ mode, draftKey, chatId, onClose }: { mode: AttachMode | null; draftKey: string; chatId?: string; onClose: () => void }) {
  const palette = usePalette();
  return (
    <Modal visible={mode !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {mode ? <Picker key={mode} mode={mode} draftKey={draftKey} chatId={chatId} onClose={onClose} /> : <View style={{ backgroundColor: palette.background }} />}
    </Modal>
  );
}

function Picker({ mode, draftKey, chatId, onClose }: { mode: AttachMode; draftKey: string; chatId?: string; onClose: () => void }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const files = useQuery({ queryKey: ['attach-files', debounced], queryFn: () => searchFiles(client, debounced), enabled: mode === 'files' });
  const knowledge = useKnowledgeSearch(debounced, mode === 'knowledge');
  const notes = useQuery({ queryKey: ['attach-notes', debounced], queryFn: () => listNoteChoices(client, debounced), enabled: mode === 'notes' });
  const chats = useQuery({
    queryKey: ['attach-chats', debounced],
    queryFn: () => (debounced ? searchChats(client, debounced) : listChats(client, 1)),
    enabled: mode === 'chats',
  });

  const rows: Row[] =
    mode === 'files'
      ? (files.data ?? []).map((file) => ({
          key: file.id,
          icon: file.contentType?.startsWith('image/') ? 'photo' : 'document-text',
          title: file.filename,
          subtitle: [fileSizeLabel(file.size), new Date(file.created_at * 1000).toLocaleDateString()].filter(Boolean).join(' · '),
          item: () => previousFileItem(file, uuidv4()),
        }))
      : mode === 'notes'
        ? (notes.data ?? []).map((note) => ({
            key: note.id,
            icon: 'pencil-square' as const,
            title: note.title,
            subtitle: note.updatedAt ? new Date(note.updatedAt).toLocaleDateString() : '',
            item: () => noteReferenceItem(note, uuidv4()),
          }))
      : mode === 'knowledge'
        ? (knowledge.data ?? [])
            .filter((choice) => choice.kind !== 'folder')
            .map((choice) => ({
              key: `${choice.kind}-${choice.id}`,
              icon: choice.kind === 'collection' ? 'circle-stack' : 'document-text',
              title: choice.name,
              subtitle: choice.description || (choice.kind === 'collection' ? 'Knowledge base' : 'File'),
              item: () => ({ ...knowledgeAttachment(choice), itemId: uuidv4() }),
            }))
        : (chats.data ?? [])
            .filter((chat) => chat.id !== chatId)
            .map((chat) => ({
              key: chat.id,
              icon: 'chat-bubble-left-right' as const,
              title: chat.title || 'New Chat',
              subtitle: new Date(chat.updated_at * 1000).toLocaleDateString(),
              item: () => chatReferenceItem(chat, uuidv4()),
            }));
  const loading = { files: files.isLoading, notes: notes.isLoading, knowledge: knowledge.isLoading, chats: chats.isLoading }[mode];

  const pick = (row: Row) => {
    const item = row.item();
    updateDraft(draftKey, (draft) => (draft.files.some((file) => file.id && file.id === item.id) ? draft : { ...draft, files: [...draft.files, item] }));
    onClose();
  };

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} style={styles.side}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {TITLES[mode]}
        </Text>
        <View style={styles.side} />
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={PLACEHOLDERS[mode]}
        placeholderTextColor={palette.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        accessibilityLabel={PLACEHOLDERS[mode]}
        style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
      />
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
        {!loading && rows.length === 0 ? <Text style={[styles.empty, { color: palette.textMuted }]}>{debounced ? 'Nothing matches.' : 'Nothing here yet.'}</Text> : null}
        {rows.map((row) => (
          <Pressable key={row.key} accessibilityRole="button" onPress={() => pick(row)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.surface }]}>
            <Icon name={row.icon} size={18} color={palette.textMuted} />
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>
                {row.title}
              </Text>
              {row.subtitle ? (
                <Text style={[styles.rowSubtitle, { color: palette.textMuted }]} numberOfLines={1}>
                  {row.subtitle}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  side: { width: 60 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  search: { marginHorizontal: 16, marginBottom: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  list: { paddingHorizontal: 8, paddingBottom: 48 },
  loading: { marginVertical: 16 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginVertical: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 12, borderRadius: radius.md },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.medium, fontSize: 15 },
  rowSubtitle: { fontFamily: fonts.regular, fontSize: 12 },
});
