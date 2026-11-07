import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MenuButton, MenuTrigger, type MenuItem } from '@/components/Menu';
import { UserAvatar } from '@/components/UserAvatar';
import { fonts, radius, usePalette } from '@/theme';
import { useSidebar } from './SidebarContext';

/*
 * The pieces both spaces' sidebars are made of, so Open WebUI's and DeepTutor's look and behave
 * the same: the name at the top, actions, search, the chat list's rows, and you at the bottom.
 */

/** The sidebar's frame: the name at the top (tap for a new chat) and the close button, then the content. */
export function SidebarPanel({ name, onNewChat, children }: { name: string; onNewChat: () => void; children: ReactNode }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const sidebar = useSidebar();
  return (
    <View style={[styles.panel, { backgroundColor: palette.sidebar, paddingTop: insets.top + 6 }]}>
      <View style={styles.brand}>
        <Pressable onPress={onNewChat} style={styles.brandName} accessibilityRole="button" accessibilityLabel="New chat">
          <Text style={[styles.brandText, { color: palette.text }]} numberOfLines={1}>
            {name}
          </Text>
        </Pressable>
        <IconButton icon="bars-3" label="Close sidebar" onPress={sidebar.close} />
      </View>
      {children}
    </View>
  );
}

export function SidebarAction({ icon, label, hint, current = false, onPress }: { icon: IconName; label: string; hint?: string; current?: boolean; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={hint}
      accessibilityState={{ selected: current }}
      onPress={onPress}
      style={({ pressed }) => [styles.action, (pressed || current) && { backgroundColor: palette.sidebarActive }]}>
      <Icon name={icon} size={19} color={palette.text} />
      <Text style={[styles.actionText, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

/** Search: a row until tapped, then a field (null = closed). */
export function SidebarSearch({ value, onChange, placeholder }: { value: string | null; onChange: (value: string | null) => void; placeholder: string }) {
  const palette = usePalette();
  if (value === null) return <SidebarAction icon="magnifying-glass" label="Search" onPress={() => onChange('')} />;
  return (
    <View style={[styles.search, { backgroundColor: palette.background, borderColor: palette.border }]}>
      <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
      <TextInput
        autoFocus
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.textFaint}
        returnKeyType="search"
        autoCorrect={false}
        style={[styles.searchInput, { color: palette.text }]}
      />
      <IconButton icon="x-mark" label="Close search" size={16} color={palette.textMuted} onPress={() => onChange(null)} />
    </View>
  );
}

/** A section's heading in the list (Pinned, Today, …). */
/** A section's heading, with a button at its end where the section has one (Folders: New Folder). */
export function SidebarHeading({ label, action }: { label: string; action?: { icon: IconName; label: string; onPress: () => void } }) {
  const palette = usePalette();
  if (!action) return <Text style={[styles.heading, { color: palette.textFaint }]}>{label}</Text>;
  return (
    <View style={styles.headingRow}>
      <Text style={[styles.heading, styles.headingText, { color: palette.textFaint }]}>{label}</Text>
      <IconButton icon={action.icon} label={action.label} onPress={action.onPress} size={16} color={palette.textMuted} />
    </View>
  );
}

/** A line of faint text in the list (Loading…, No chats found). */
export function SidebarNote({ label, depth = 0 }: { label: string; depth?: number }) {
  const palette = usePalette();
  return <Text style={[styles.note, { color: palette.textFaint, paddingLeft: 12 + depth * 14 }]}>{label}</Text>;
}

/** A chat in the list: its title, what it's doing (replying, unread, pinned) and its menu. */
export function SidebarChatRow({
  title,
  current,
  depth = 0,
  busy = false,
  unread = false,
  pinned = false,
  mark,
  detail,
  owner,
  onOpen,
  menu,
}: {
  title: string;
  current: boolean;
  depth?: number;
  busy?: boolean;
  unread?: boolean;
  pinned?: boolean;
  /** A colour before the title (DeepTutor: the status of the task the chat is linked to). */
  mark?: string;
  /** A line under the title (a search result's matching text). */
  detail?: ReactNode;
  /** Someone else's chat (in a shared folder): their picture before the title, as on the web. */
  owner?: { id: string; name: string };
  onOpen: () => void;
  /** None: no menu (someone else's chat, to read). */
  menu: MenuItem[];
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.row, detail ? styles.rowTall : null, { paddingLeft: 12 + depth * 14 }, (current || pressed) && { backgroundColor: palette.sidebarActive }]}>
      {mark ? <View style={[styles.mark, { backgroundColor: mark }]} accessibilityLabel="Linked task status" /> : null}
      {owner ? (
        <View accessible accessibilityLabel={`${owner.name || 'Someone'}’s chat`}>
          <UserAvatar name={owner.name || '?'} picture={`/api/v1/users/${encodeURIComponent(owner.id)}/profile/image`} size={16} />
        </View>
      ) : null}
      {detail ? (
        <View style={styles.titleBlock}>
          <Text style={[styles.titleText, { color: palette.text }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.detail, { color: palette.textMuted }]} numberOfLines={2}>
            {detail}
          </Text>
        </View>
      ) : (
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
          {title}
        </Text>
      )}
      {busy ? (
        <ActivityIndicator size="small" color={palette.textMuted} />
      ) : !current && unread ? (
        <View style={[styles.dot, { backgroundColor: palette.unread }]} accessibilityLabel="Unread" />
      ) : null}
      {pinned ? <Icon name="bookmark" size={14} color={palette.textFaint} /> : null}
      {menu.length ? <MenuButton items={menu} label={`Options for ${title}`} size={18} color={palette.textMuted} /> : <View style={styles.noMenu} />}
    </Pressable>
  );
}

/** You, at the bottom: your picture (else initials) and name, opening the account menu. */
/**
 * The account row at the foot of the sidebar: your picture (with the web's green dot while
 * statuses are on), your name and your status; it opens your menu.
 */
export function SidebarUser({ name, picture, menu, status, online = false }: { name: string; picture?: string | null; menu: MenuItem[]; status?: string; online?: boolean }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.footer, { borderTopColor: palette.border, paddingBottom: insets.bottom + 6 }]}>
      <MenuTrigger label="Account" items={menu}>
        <View style={styles.user}>
          <View>
            <UserAvatar name={name} picture={picture} size={30} />
            {online ? <View style={[styles.online, { borderColor: palette.background, backgroundColor: palette.success }]} /> : null}
          </View>
          <View style={styles.userText}>
            <Text style={[styles.userName, { color: palette.text }]} numberOfLines={1}>
              {name}
            </Text>
            {status ? (
              <Text style={[styles.userStatus, { color: palette.textMuted }]} numberOfLines={1}>
                {status}
              </Text>
            ) : null}
          </View>
        </View>
      </MenuTrigger>
    </View>
  );
}

export { initials } from '@/components/UserAvatar';

export const sidebarStyles = StyleSheet.create({
  list: { flex: 1, marginTop: 6 },
  listContent: { paddingBottom: 12 },
  more: { marginVertical: 12 },
});

const styles = StyleSheet.create({
  panel: { flex: 1, paddingHorizontal: 8 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 6, marginBottom: 4 },
  brandName: { flex: 1 },
  brandText: { fontFamily: fonts.semibold, fontSize: 15 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingHorizontal: 10, borderRadius: radius.md },
  actionText: { fontFamily: fonts.medium, fontSize: 15 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    marginVertical: 2,
    paddingLeft: 10,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  heading: { fontFamily: fonts.medium, fontSize: 12, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 4 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-end' },
  headingText: { flex: 1 },
  note: { fontFamily: fonts.regular, fontSize: 13, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingRight: 0, borderRadius: radius.md },
  title: { flex: 1, fontFamily: fonts.regular, fontSize: 14 },
  rowTall: { paddingVertical: 6 },
  titleBlock: { flex: 1, gap: 2 },
  titleText: { fontFamily: fonts.regular, fontSize: 14 },
  detail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  mark: { width: 8, height: 8, borderRadius: 2 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  user: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 },
  userText: { flex: 1 },
  noMenu: { width: 36 },
  userName: { fontFamily: fonts.medium, fontSize: 15 },
  userStatus: { fontFamily: fonts.regular, fontSize: 12, marginTop: 1 },
  online: { position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, borderWidth: 2 },
});
