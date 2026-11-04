import {
  archivePartnerSession,
  currentWebSession,
  deletePartner,
  deletePartnerSession,
  DtHttpError,
  listPartnerSessions,
  newPartnerSessionKey,
  recordReply,
  resumePartnerSession,
  sessionChannel,
  type DtPartnerSession,
} from '@maviechat/deeptutor-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import type { DtListItem } from '@/features/deeptutor/chat/DtMessageList';
import { DtMessageList } from '@/features/deeptutor/chat/DtMessageList';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { ConversationsSheet } from '@/features/deeptutor/partners/ConversationsSheet';
import { channelLabel } from '@/features/deeptutor/partners/labels';
import { PartnerComposer } from '@/features/deeptutor/partners/PartnerComposer';
import { PartnerFace } from '@/features/deeptutor/partners/PartnerFace';
import { useDtPartner, usePartnersRefresh } from '@/features/deeptutor/partners/queries';
import { usePartnerChat } from '@/features/deeptutor/partners/usePartnerChat';
import { describeError } from '@/lib/errors';
import { DT_EXPIRED_NOTICE, DT_QUERY_ROOT, useDeepTutor, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

/**
 * A chat with a partner: its replies stream in as in DeepTutor's own chat (reasoning, tools and
 * sources folded away), you can stop one, and a reply that kept going while the app was away is
 * picked up again. New Conversation archives this one; Conversations lists them all.
 */
export default function PartnerChat() {
  const palette = usePalette();
  const toast = useToast();
  const params = useLocalSearchParams<{ id: string; session?: string }>();
  const partnerId = one(params.id);
  const asked = one(params.session);
  const { client, session } = useDtAuthed();
  const queryClient = useQueryClient();
  const deepTutor = useDeepTutor();
  const refresh = usePartnersRefresh();
  const partner = useDtPartner(partnerId);
  // The conversation open with this partner, kept while the app runs (DeepTutor's web keeps it
  // per browser): first the latest one here, or a new one.
  const openKey = useMemo(() => [DT_QUERY_ROOT, session.baseUrl, 'partner-open', partnerId] as const, [session.baseUrl, partnerId]);
  const opening = useQuery({
    queryKey: openKey,
    queryFn: async () => currentWebSession(await listPartnerSessions(client, partnerId))?.key ?? newPartnerSessionKey(),
    staleTime: Infinity,
    enabled: !asked,
  });
  const [chosen, setChosen] = useState<string | null>(asked || null);
  const key = chosen ?? opening.data ?? null;
  const choose = (next: string) => {
    setChosen(next);
    queryClient.setQueryData(openKey, next);
  };
  useEffect(() => {
    if (asked) queryClient.setQueryData(openKey, asked);
  }, [asked, openKey, queryClient]);
  const [draft, setDraft] = useState('');
  const [listing, setListing] = useState(false);

  const chat = usePartnerChat(partnerId, key, {
    onRefused: (prompt, message) => {
      setDraft((current) => current || prompt);
      toast(message || 'The partner didn’t take the message.', 'error');
    },
    onProactive: (content) => toast(content.length > 160 ? `${content.slice(0, 160)}…` : content),
  });

  const signOut = deepTutor.signOut;
  const refetchPartner = partner.refetch;
  useEffect(() => {
    if (chat.state === 'signed-out') void signOut({ notice: DT_EXPIRED_NOTICE });
    // Its running dot changes once the socket has started it.
    if (chat.state === 'ready') void refetchPartner();
  }, [chat.state, signOut, refetchPartner]);

  const name = partner.data?.name ?? 'Partner';
  const face = useMemo(() => partner.data ?? { name: 'Partner' }, [partner.data]);
  const app = key ? sessionChannel(key) : 'web';
  const readOnly = app !== 'web';
  const speaker = useMemo(() => ({ name, face: <PartnerFace face={face} size={22} /> }), [name, face]);

  const items = useMemo<DtListItem[]>(() => {
    const out: DtListItem[] = chat.records.map((record) =>
      record.role === 'user'
        ? { key: `h${record.index}`, kind: 'user', text: record.content, references: record.attachments.map((file, at) => ({ key: `${record.index}-${at}`, icon: 'paper-clip' as const, label: file })) }
        : { key: `h${record.index}`, kind: 'reply', reply: { ...recordReply(record), turnId: `p-${record.index}` }, last: false },
    );
    const turn = chat.turn;
    if (turn) {
      const lastUser = [...chat.records].reverse().find((record) => record.role === 'user');
      // Following a reply again repeats your message, which the conversation already holds.
      const repeated = turn.accepted && lastUser?.content === turn.prompt && chat.records[chat.records.length - 1]?.role === 'user';
      if (turn.prompt !== null && !repeated) out.push({ key: 'live-user', kind: 'user', text: turn.prompt });
      out.push({ key: 'live-reply', kind: 'reply', reply: turn.reply, last: true });
    } else {
      const lastReply = out.map((item) => item.kind).lastIndexOf('reply');
      if (lastReply >= 0) out[lastReply] = { ...(out[lastReply] as Extract<DtListItem, { kind: 'reply' }>), last: true };
    }
    return out;
  }, [chat.records, chat.turn]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (chat.send(text)) setDraft('');
    else toast(chat.running ? 'Wait for the reply to finish.' : 'Not connected yet. Try again in a moment.');
  };

  const newConversation = async () => {
    if (chat.running) return toast('Wait for the reply to finish, or stop it.');
    if (key && chat.records.length && !readOnly) {
      try {
        await archivePartnerSession(client, partnerId, key);
      } catch (error) {
        return toast(error instanceof DtHttpError && error.status === 409 ? 'This conversation is still replying.' : `Couldn’t start a new one: ${describeError(error)}`, 'error');
      }
    }
    choose(newPartnerSessionKey());
    setDraft('');
    refresh();
  };

  const openSession = async (picked: DtPartnerSession) => {
    setListing(false);
    if (picked.key === key) return;
    if (picked.archived && picked.channel === 'web') {
      try {
        await resumePartnerSession(client, partnerId, picked.key);
      } catch (error) {
        return toast(`Couldn’t bring it back: ${describeError(error)}`, 'error');
      }
    }
    choose(picked.key);
    refresh();
  };

  const removeSession = async (picked: DtPartnerSession) => {
    await deletePartnerSession(client, partnerId, picked.key);
    if (picked.key === key) choose(newPartnerSessionKey());
    refresh();
  };

  const removePartner = () =>
    Alert.alert(`Delete ${name}?`, 'Its conversations, library and chat-app links are deleted too. This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deletePartner(client, partnerId).then(
            () => {
              refresh();
              toast(`${name} deleted`);
              router.back();
            },
            (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);

  const menu: MenuItem[] = [
    { key: 'new', label: 'New Conversation', icon: 'pencil-square', onPress: () => void newConversation() },
    { key: 'list', label: 'Conversations', icon: 'clock', onPress: () => setListing(true) },
    { key: 'web', label: 'Set Up on the Web', icon: 'arrow-top-right-on-square', onPress: () => router.push({ pathname: '/learn/web', params: { path: `/partners/${encodeURIComponent(partnerId)}`, title: name } }) },
    ...(partner.data?.canManage ? [{ key: 'delete', label: 'Delete Partner', icon: 'trash' as const, destructive: true, onPress: removePartner }] : []),
  ];

  const note =
    readOnly
      ? `This conversation is in ${channelLabel(app)}: reply there, or start a new one here.`
      : chat.state === 'connecting'
        ? `Waking ${name}…`
        : chat.state === 'reconnecting'
          ? 'Reconnecting…'
          : chat.state === 'unavailable'
            ? `${name} can’t be reached${chat.detail ? `: ${chat.detail}` : '.'}`
            : undefined;

  if (partner.isError) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <DtHeader title="Partner" />
        <Text style={[styles.empty, { color: palette.textMuted }]}>
          {partner.error instanceof DtHttpError && partner.error.status === 404 ? 'This partner is gone, or isn’t shared with you any more.' : `Couldn’t open it: ${describeError(partner.error)}`}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title={name} menu={menu} />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        {chat.loading || !key ? (
          <ActivityIndicator style={styles.loading} color={palette.textMuted} />
        ) : chat.error ? (
          <View style={styles.center}>
            <Text style={[styles.empty, { color: palette.textMuted }]}>{`Couldn’t load the conversation: ${describeError(chat.error)}`}</Text>
            <Pressable accessibilityRole="button" onPress={chat.reload} hitSlop={8}>
              <Text style={[styles.link, { color: palette.link }]}>Try Again</Text>
            </Pressable>
          </View>
        ) : items.length ? (
          <DtMessageList
            items={items}
            baseUrl={session.baseUrl}
            actions={{ speaker }}
            pinToBottomKey={chat.turn?.prompt ?? undefined}
            header={
              chat.olderAvailable ? (
                <Pressable accessibilityRole="button" onPress={chat.loadOlder} style={styles.older} hitSlop={6}>
                  {chat.loadingOlder ? <ActivityIndicator size="small" color={palette.textMuted} /> : <Text style={[styles.link, { color: palette.link }]}>Earlier Messages</Text>}
                </Pressable>
              ) : null
            }
          />
        ) : (
          <View style={styles.center}>
            <PartnerFace face={face} size={72} running={partner.data?.running} />
            <Text style={[styles.hello, { color: palette.text }]}>{name}</Text>
            {partner.data?.description ? <Text style={[styles.description, { color: palette.textMuted }]}>{partner.data.description}</Text> : null}
            <Text style={[styles.hint, { color: palette.textFaint }]}>Say hello. Chat apps are optional: you can talk to {name} right here.</Text>
          </View>
        )}
        {readOnly ? (
          <Text style={[styles.readOnly, { color: palette.textMuted }]}>{note}</Text>
        ) : (
          <PartnerComposer
            value={draft}
            onChange={setDraft}
            onSend={send}
            onStop={chat.stop}
            running={chat.running}
            ready={chat.state === 'ready'}
            note={note}
            placeholder={`Message ${name}`}
          />
        )}
      </KeyboardAvoidingView>
      <ConversationsSheet partnerId={partnerId} visible={listing} current={key} onOpen={(picked) => void openSession(picked)} onDelete={removeSession} onClose={() => setListing(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { marginTop: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  hello: { fontFamily: fonts.semibold, fontSize: 20, marginTop: 4 },
  description: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 4 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  link: { fontFamily: fonts.medium, fontSize: 14 },
  older: { alignSelf: 'center', paddingVertical: 12 },
  readOnly: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'center', paddingHorizontal: 24, paddingTop: 10, paddingBottom: 28 },
});
