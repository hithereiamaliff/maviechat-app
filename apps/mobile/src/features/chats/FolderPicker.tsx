import { folderTree, listFolders, type FolderNode } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import { useChatActions, type ChatRef } from './useChatActions';

function flatten(nodes: FolderNode[], depth = 0): { folder: FolderNode; depth: number }[] {
  return nodes.flatMap((folder) => [{ folder, depth }, ...flatten(folder.children, depth + 1)]);
}

/** The chat menu's "Move": a sheet of your folders (and "No folder"). Render `element` once in the screen. */
export function useFolderPicker(): { open: (chat: ChatRef) => void; element: ReactNode } {
  const [chat, setChat] = useState<ChatRef | null>(null);
  const actions = useChatActions();
  const element = (
    <FolderSheet
      chat={chat}
      onClose={() => setChat(null)}
      onPick={(folder) => {
        const target = chat;
        setChat(null);
        if (target) void actions.move(target, folder);
      }}
    />
  );
  return { open: setChat, element };
}

function FolderSheet({
  chat,
  onClose,
  onPick,
}: {
  chat: ChatRef | null;
  onClose: () => void;
  onPick: (folder: { id: string; name: string } | null) => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { client } = useAuthed();
  const folders = useQuery({ queryKey: ['folders'], queryFn: () => listFolders(client), enabled: chat !== null });
  const rows = flatten(folderTree(folders.data ?? []));

  return (
    <Modal visible={chat !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: palette.menu, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
            Move “{chat?.title ?? ''}”
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={[styles.done, { color: palette.link }]}>Cancel</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.list}>
          <Row icon="x-mark" label="No folder" depth={0} onPress={() => onPick(null)} />
          {rows.map(({ folder, depth }) => (
            <Row key={folder.id} icon="folder" label={folder.name} depth={depth} onPress={() => onPick({ id: folder.id, name: folder.name })} />
          ))}
          {folders.isLoading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
          {!folders.isLoading && rows.length === 0 ? (
            <Text style={[styles.empty, { color: palette.textMuted }]}>No folders yet. Create one on the web for now.</Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Row({ icon, label, depth, onPress }: { icon: 'folder' | 'x-mark'; label: string; depth: number; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { paddingLeft: 12 + depth * 18 }, pressed && { backgroundColor: palette.surfaceStrong }]}>
      <Icon name={icon} size={18} color={palette.textMuted} />
      <Text style={[styles.label, { color: palette.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '70%',
    borderTopLeftRadius: radius.lg * 1.5,
    borderTopRightRadius: radius.lg * 1.5,
    paddingTop: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  list: { paddingHorizontal: 8, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingRight: 12, borderRadius: radius.md },
  label: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  loading: { marginVertical: 16 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginVertical: 16, paddingHorizontal: 16 },
});
