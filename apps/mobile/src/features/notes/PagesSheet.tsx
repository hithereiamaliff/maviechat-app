import { newPageTitle, pageParents, pageStep, type NotePage, type PageOperation } from '@maviechat/owui-protocol';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showActionSheet, showAlert, showPrompt } from '@/components/dialogs';
import { Icon } from '@/components/Icon';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { Modal } from '@/components/Modal';
import { fonts, radius, usePalette } from '@/theme';

/** A page's name as listed: the first page shows the note's title until it's renamed. */
export const pageName = (page: NotePage, noteTitle: string): string => (page.inheritsTitle ? noteTitle : page.title) || 'Untitled';

/**
 * 0.12's pages of a note, as the web's Pages panel: each opens on its own; in a note you may
 * change, pages are added (and subpages), renamed, moved up, down or under another page, and
 * deleted (a deleted page's subpages move up a level). The first page stays first.
 */
export function PagesSheet({
  visible,
  onClose,
  pages,
  activeId,
  noteTitle,
  writable,
  onOpen,
  onChange,
  onCopyLink,
}: {
  visible: boolean;
  onClose: () => void;
  pages: NotePage[];
  activeId: string;
  noteTitle: string;
  writable: boolean;
  onOpen: (pageId: string) => void;
  onChange: (operation: PageOperation) => void;
  onCopyLink: (pageId: string) => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const add = (parentId: string | null) => onChange({ action: 'create', title: newPageTitle(pages), parentId });
  const rename = (page: NotePage) =>
    showPrompt('Rename Page', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Save', onPress: (value?: string) => (value?.trim() && value.trim() !== page.title ? onChange({ action: 'rename', pageId: page.id, title: value.trim() }) : undefined) },
    ], 'plain-text', pageName(page, noteTitle));
  const moveTo = (page: NotePage) => {
    const parents = pageParents(pages, page.id);
    const options = ['Top Level', ...parents.map((parent) => `${'  '.repeat(parent.depth)}${pageName(parent, noteTitle)}`), 'Cancel'];
    showActionSheet({ title: 'Move Under', message: 'Its subpages move with it.', options, cancelButtonIndex: options.length - 1 }, (index) => {
      if (index === options.length - 1) return;
      const parentId = index === 0 ? null : (parents[index - 1]?.id ?? null);
      if (parentId !== page.parentId) onChange({ action: 'move', pageId: page.id, parentId, beforeId: null });
    });
  };
  const remove = (page: NotePage) =>
    showAlert(`Delete “${pageName(page, noteTitle)}”?`, pages.some((item) => item.parentId === page.id) ? 'This can’t be undone. Its subpages are kept and move up a level.' : 'This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onChange({ action: 'delete', pageId: page.id }) },
    ]);
  const menu = (page: NotePage): MenuItem[] => {
    const up = pageStep(pages, page.id, -1);
    const down = pageStep(pages, page.id, 1);
    return [
      ...(writable
        ? [
            { key: 'sub', label: 'Add Subpage', icon: 'plus' as const, onPress: () => add(page.id) },
            { key: 'rename', label: 'Rename…', icon: 'pencil' as const, onPress: () => rename(page) },
            ...(up ? [{ key: 'up', label: 'Move Up', icon: 'chevron-up' as const, onPress: () => onChange(up) }] : []),
            ...(down ? [{ key: 'down', label: 'Move Down', icon: 'chevron-down' as const, onPress: () => onChange(down) }] : []),
            ...(page.id !== 'main' ? [{ key: 'move', label: 'Move Under…', icon: 'arrows-right-left' as const, onPress: () => moveTo(page) }] : []),
          ]
        : []),
      { key: 'link', label: 'Copy Page Link', icon: 'link', onPress: () => onCopyLink(page.id) },
      ...(writable && page.id !== 'main' && pages.length > 1 ? [{ key: 'delete', label: 'Delete Page', icon: 'trash' as const, destructive: true, onPress: () => remove(page) }] : []),
    ];
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            Pages
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={[styles.action, { color: palette.link }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {pages.map((page) => {
            const active = page.id === activeId;
            return (
              <View key={page.id} style={[styles.row, { paddingLeft: 16 + page.depth * 20 }, active && { backgroundColor: palette.surface }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    onOpen(page.id);
                    onClose();
                  }}
                  style={styles.open}>
                  <Icon name="document-text" size={18} color={palette.textMuted} />
                  <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                    {pageName(page, noteTitle)}
                  </Text>
                  {active ? <Icon name="check" size={16} color={palette.text} /> : null}
                </Pressable>
                <MenuButton items={menu(page)} label={`${pageName(page, noteTitle)} options`} size={18} color={palette.textMuted} />
              </View>
            );
          })}
          {writable ? (
            <Pressable accessibilityRole="button" onPress={() => add(null)} style={({ pressed }) => [styles.add, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <Icon name="plus" size={16} color={palette.text} />
              <Text style={[styles.name, { color: palette.text }]}>Add Page</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.semibold, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  open: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  name: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 15 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
});
