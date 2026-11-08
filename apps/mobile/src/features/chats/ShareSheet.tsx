import {
  getChat,
  getShareAccess,
  getUserInfo,
  listShareGroups,
  searchUsers,
  setShareAccess,
  shareChat,
  sharedChatUrl,
  sharedWith,
  shareVisibility,
  unshareChat,
  withShareVisibility,
  withSharedWith,
  type ShareGrant,
  type ShareVisibility,
} from '@maviechat/owui-protocol';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useServerConfig } from '@/lib/server';
import { shareLink } from '@/lib/shareLocalFile';
import { useDebounced } from '@/lib/useDebounced';
import { fonts, radius, usePalette } from '@/theme';
import type { ChatRef } from './useChatActions';

/** The chat menu's "Share": its link, and who may open it. Render `element` once in the screen. */
export function useShareSheet(): { open: (chat: ChatRef) => void; element: ReactNode } {
  const [chat, setChat] = useState<ChatRef | null>(null);
  const element = (
    <Modal visible={chat !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setChat(null)}>
      {chat ? <ShareEditor chat={chat} onClose={() => setChat(null)} /> : null}
    </Modal>
  );
  return { open: setChat, element };
}

const VISIBILITY: { key: ShareVisibility; title: string; hint: (server: string) => string }[] = [
  { key: 'private', title: 'Only people you add', hint: () => 'You, and the people and groups below.' },
  { key: 'public', title: 'Everyone on this server', hint: (server) => `Anyone signed in to ${server}.` },
  { key: 'open', title: 'Anyone with the link', hint: () => 'Even without signing in.' },
];

/**
 * Share a chat as the web does: a link to a snapshot of it (messages sent later aren't in it until
 * you update the link), who may open the link (people and groups you add, everyone on the server,
 * or anyone, as your permissions allow), and deleting the link.
 */
function ShareEditor({ chat, onClose }: { chat: ChatRef; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useAuthed();
  const capabilities = useCapabilities();
  const config = useServerConfig();
  const [working, setWorking] = useState<'link' | 'delete' | null>(null);
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim(), 300);
  const record = useQuery({ queryKey: ['chat-share', chat.id], queryFn: () => getChat(client, chat.id), staleTime: 0 });
  const shareId = record.data?.share_id ?? null;
  const access = useQuery({ queryKey: ['chat-share-access', chat.id], queryFn: () => getShareAccess(client, chat.id), enabled: Boolean(shareId) });
  const grants = access.data ?? [];
  const visibility = shareVisibility(grants);
  const added = sharedWith(grants);
  const canPeople = capabilities?.can('access_grants.allow_users', true) ?? false;
  const groups = useQuery({ queryKey: ['share-groups'], queryFn: () => listShareGroups(client), enabled: Boolean(shareId), staleTime: 60_000 });
  const people = useQueries({
    queries: added.users.map((id) => ({ queryKey: ['user-info', id], queryFn: () => getUserInfo(client, id), staleTime: 5 * 60_000 })),
  });
  const found = useQuery({ queryKey: ['user-search', query], queryFn: () => searchUsers(client, query), enabled: Boolean(shareId) && canPeople && query.length > 0 });
  const link = shareId ? sharedChatUrl(session.baseUrl, shareId) : null;
  const server = config.data?.name ?? 'this server';
  const allowed = (key: ShareVisibility) =>
    key === 'private' || key === visibility || (key === 'public' ? (capabilities?.can('sharing.public_chats') ?? false) : (capabilities?.can('sharing.open_chats') ?? false));

  const makeLink = async () => {
    setWorking('link');
    try {
      const shared = await shareChat(client, chat.id);
      queryClient.setQueryData(['chat-share', chat.id], shared);
      void queryClient.invalidateQueries({ queryKey: ['chat', chat.id] });
      if (shared.share_id) {
        await Clipboard.setStringAsync(sharedChatUrl(session.baseUrl, shared.share_id));
        toast(shareId ? 'Link updated and copied' : 'Link copied', 'success');
      }
    } catch (error) {
      toast(`Couldn't share the chat: ${describeError(error)}`, 'error');
    } finally {
      setWorking(null);
    }
  };

  const deleteLink = () =>
    Alert.alert('Delete the link?', 'Nobody can open it any more. Sharing again makes a new link.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete Link',
        style: 'destructive',
        onPress: () => {
          setWorking('delete');
          unshareChat(client, chat.id)
            .then(() => {
              queryClient.setQueryData(['chat-share-access', chat.id], []);
              return record.refetch();
            })
            .catch((error: unknown) => toast(`Couldn't delete the link: ${describeError(error)}`, 'error'))
            .finally(() => setWorking(null));
        },
      },
    ]);

  // Each change is saved at once, as on the web; the server drops what your permissions don't allow.
  const saveGrants = (next: ShareGrant[]) => {
    queryClient.setQueryData(['chat-share-access', chat.id], next);
    setShareAccess(client, chat.id, next)
      .catch((error: unknown) => toast(`Couldn't change who can open it: ${describeError(error)}`, 'error'))
      .finally(() => void access.refetch());
  };

  const nameOf = (id: string) => people[added.users.indexOf(id)]?.data?.name || 'Someone';
  const groupName = (id: string) => groups.data?.find((group) => group.id === id)?.name ?? 'A group';
  const results = (found.data ?? []).filter((user) => user.id !== session.user.id && !added.users.includes(user.id)).slice(0, 12);

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Share Chat
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.done, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.note, { color: palette.textMuted }]} numberOfLines={2}>{`“${chat.title}”`}</Text>
        {record.isLoading ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : record.isError ? (
          <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't load the chat: ${describeError(record.error)}`}</Text>
        ) : !link ? (
          <>
            <Text style={[styles.body, { color: palette.text }]}>
              Makes a link to this chat as it is now. Messages you send after that aren&apos;t in it until you update the link.
            </Text>
            <Text style={[styles.note, { color: palette.textMuted }]}>At first only you can open it; then choose who else may.</Text>
            <Button label="Create Link" onPress={() => void makeLink()} loading={working === 'link'} disabled={working !== null} />
          </>
        ) : (
          <>
            <View style={[styles.link, { borderColor: palette.border, backgroundColor: palette.surface }]}>
              <Icon name="link" size={16} color={palette.textMuted} />
              <Text style={[styles.linkText, { color: palette.text }]} numberOfLines={1} selectable>
                {link}
              </Text>
              <IconButton
                icon="clipboard-document"
                label="Copy link"
                size={18}
                color={palette.textMuted}
                onPress={() => void Clipboard.setStringAsync(link).then(() => toast('Link copied'))}
              />
              <IconButton icon="arrow-up-on-square" label="Share link" size={18} color={palette.textMuted} onPress={() => void shareLink(link)} />
            </View>
            <Text style={[styles.note, { color: palette.textMuted }]}>The link shows the chat as it was when you shared it.</Text>
            <View style={styles.buttons}>
              <View style={styles.grow}>
                <Button label="Update Link" variant="secondary" onPress={() => void makeLink()} loading={working === 'link'} disabled={working !== null} />
              </View>
              <View style={styles.grow}>
                <Button label="Delete Link" variant="secondary" onPress={deleteLink} loading={working === 'delete'} disabled={working !== null} />
              </View>
            </View>

            <Text style={[styles.label, { color: palette.textMuted }]}>Who can open it</Text>
            {access.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
            {VISIBILITY.filter((option) => allowed(option.key)).map((option) => {
              const on = visibility === option.key;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => (on ? undefined : saveGrants(withShareVisibility(grants, option.key)))}
                  style={[styles.option, { borderColor: on ? palette.text : palette.border }]}>
                  <View style={styles.grow}>
                    <Text style={[styles.optionTitle, { color: palette.text }]}>{option.title}</Text>
                    <Text style={[styles.note, { color: palette.textMuted }]}>{option.hint(server)}</Text>
                  </View>
                  {on ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
                </Pressable>
              );
            })}

            {visibility === 'private' ? (
              <>
                {added.users.length || added.groups.length ? <Text style={[styles.label, { color: palette.textMuted }]}>Shared with</Text> : null}
                {added.users.map((id) => (
                  <View key={`u-${id}`} style={[styles.row, { borderBottomColor: palette.border }]}>
                    <Icon name="user-circle" size={18} color={palette.textMuted} />
                    <Text style={[styles.rowText, { color: palette.text }]} numberOfLines={1}>
                      {nameOf(id)}
                    </Text>
                    <IconButton icon="x-mark" label={`Remove ${nameOf(id)}`} size={16} color={palette.textMuted} onPress={() => saveGrants(withSharedWith(grants, 'user', id, false))} />
                  </View>
                ))}
                {added.groups.map((id) => (
                  <View key={`g-${id}`} style={[styles.row, { borderBottomColor: palette.border }]}>
                    <Icon name="user-group" size={18} color={palette.textMuted} />
                    <Text style={[styles.rowText, { color: palette.text }]} numberOfLines={1}>
                      {groupName(id)}
                    </Text>
                    <IconButton icon="x-mark" label={`Remove ${groupName(id)}`} size={16} color={palette.textMuted} onPress={() => saveGrants(withSharedWith(grants, 'group', id, false))} />
                  </View>
                ))}

                {canPeople ? (
                  <>
                    <Text style={[styles.label, { color: palette.textMuted }]}>Add people</Text>
                    <TextInput
                      value={search}
                      onChangeText={setSearch}
                      placeholder="Name or email"
                      placeholderTextColor={palette.textFaint}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
                      accessibilityLabel="Find people to share with"
                    />
                    {found.isFetching ? <ActivityIndicator color={palette.textMuted} /> : null}
                    {query && !found.isFetching && results.length === 0 ? <Text style={[styles.note, { color: palette.textFaint }]}>Nobody found.</Text> : null}
                    {results.map((user) => (
                      <Pressable
                        key={user.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Share with ${user.name}`}
                        onPress={() => {
                          saveGrants(withSharedWith(grants, 'user', user.id, true));
                          queryClient.setQueryData(['user-info', user.id], user);
                          setSearch('');
                        }}
                        style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                        <Icon name="plus" size={16} color={palette.textMuted} />
                        <View style={styles.grow}>
                          <Text style={[styles.rowText, { color: palette.text }]} numberOfLines={1}>
                            {user.name}
                          </Text>
                          {user.email && user.email !== user.name ? (
                            <Text style={[styles.note, { color: palette.textMuted }]} numberOfLines={1}>
                              {user.email}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                    ))}
                  </>
                ) : null}

                {(groups.data ?? []).some((group) => !added.groups.includes(group.id)) ? (
                  <>
                    <Text style={[styles.label, { color: palette.textMuted }]}>Add a group</Text>
                    {(groups.data ?? [])
                      .filter((group) => !added.groups.includes(group.id))
                      .map((group) => (
                        <Pressable
                          key={group.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Share with ${group.name}`}
                          onPress={() => saveGrants(withSharedWith(grants, 'group', group.id, true))}
                          style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                          <Icon name="plus" size={16} color={palette.textMuted} />
                          <Text style={[styles.rowText, { color: palette.text }]} numberOfLines={1}>
                            {group.members !== null ? `${group.name} · ${group.members} ${group.members === 1 ? 'member' : 'members'}` : group.name}
                          </Text>
                        </Pressable>
                      ))}
                  </>
                ) : null}
              </>
            ) : null}
          </>
        )}
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
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 8 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingLeft: 12 },
  linkText: { flex: 1, fontFamily: fonts.mono, fontSize: 13 },
  buttons: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1, gap: 2 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, padding: 12 },
  optionTitle: { fontFamily: fonts.medium, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, fontFamily: fonts.medium, fontSize: 15 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
});
