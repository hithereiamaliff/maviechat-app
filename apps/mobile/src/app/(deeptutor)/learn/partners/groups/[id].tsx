import {
  deletePartnerGroup,
  DISCUSSION_MODES,
  DtHttpError,
  listGroupSessions,
  newGroupSessionKey,
  pinGroupMessage,
  resolveMentions,
  type DtGroupRound,
  type DtGroupSeat,
} from '@maviechat/deeptutor-protocol';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { GroupComposer, withQuote, type Quote } from '@/features/deeptutor/partners/groups/GroupComposer';
import { GroupRoundView, type RoundActions } from '@/features/deeptutor/partners/groups/GroupRoundView';
import { DiscussionsSheet, ManageGroupSheet, WhiteboardSheet } from '@/features/deeptutor/partners/groups/GroupSheets';
import { useGroupChat } from '@/features/deeptutor/partners/groups/useGroupChat';
import { PartnerFace } from '@/features/deeptutor/partners/PartnerFace';
import { useDtGroup, useDtPartners, usePartnersRefresh } from '@/features/deeptutor/partners/queries';
import { describeError } from '@/lib/errors';
import { DT_EXPIRED_NOTICE, DT_QUERY_ROOT, useDeepTutor, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

/**
 * A group discussion, as DeepTutor's group page has it: your message goes to everyone or to the
 * members you @name; each answers in its seat, its steps streaming in; a member's proposal to ask
 * another waits for you; a round can be summed up, a failed answer tried again, an answer pinned to
 * the whiteboard, quoted in a follow-up, or put to another member.
 */
export default function GroupDiscussion() {
  const palette = usePalette();
  const toast = useToast();
  const params = useLocalSearchParams<{ id: string; session?: string }>();
  const groupId = one(params.id);
  const asked = one(params.session);
  const { client, session } = useDtAuthed();
  const queryClient = useQueryClient();
  const deepTutor = useDeepTutor();
  const refresh = usePartnersRefresh();
  const group = useDtGroup(groupId);
  const partners = useDtPartners();
  // The discussion open, kept while the app runs: first the latest one, or a new one.
  const openKey = useMemo(() => [DT_QUERY_ROOT, session.baseUrl, 'group-open', groupId] as const, [session.baseUrl, groupId]);
  const opening = useQuery({ queryKey: openKey, queryFn: async () => (await listGroupSessions(client, groupId))[0]?.key ?? newGroupSessionKey(), staleTime: Infinity, enabled: !asked });
  const [chosen, setChosen] = useState<string | null>(asked || null);
  const key = chosen ?? opening.data ?? null;
  const choose = (next: string) => {
    setChosen(next);
    queryClient.setQueryData(openKey, next);
  };
  useEffect(() => {
    if (asked) queryClient.setQueryData(openKey, asked);
  }, [asked, openKey, queryClient]);

  const chat = useGroupChat(group.data, key);
  const [draft, setDraft] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [sheet, setSheet] = useState<'discussions' | 'whiteboard' | 'manage' | null>(null);
  const list = useRef<FlashListRef<DtGroupRound>>(null);
  const members = useMemo(() => group.data?.members ?? [], [group.data]);

  const expireSession = deepTutor.expireSession;
  useEffect(() => {
    if (chat.state === 'signed-out') void expireSession(DT_EXPIRED_NOTICE);
  }, [chat.state, expireSession]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const { mentions } = resolveMentions(text, members);
    if (chat.send(withQuote(text, quote), mentions)) {
      setDraft('');
      setQuote(null);
      requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true }));
    } else toast(chat.running ? 'A round is running: wait for it, or stop it.' : 'Not connected yet. Try again in a moment.');
  };

  const answeredBy = (round: DtGroupRound) => [...new Map(round.seats.filter((seat) => seat.state === 'done').map((seat) => [seat.partnerId, seat.name])).entries()];
  const actions: RoundActions = {
    onApprove: (invocation) => {
      if (!chat.approve(invocation.id)) toast('Not connected yet. Try again in a moment.');
    },
    onReject: (invocation) => {
      if (!chat.reject(invocation.id)) toast('Not connected yet. Try again in a moment.');
    },
    onFollowUp: (seat: DtGroupSeat) => setQuote({ name: seat.name, text: seat.reply.answer }),
    onAskAnother: (seat: DtGroupSeat) => {
      const others = members.filter((member) => member.id !== seat.partnerId);
      if (!others.length) return;
      ActionSheetIOS.showActionSheetWithOptions({ title: `Who should ${seat.name} ask?`, options: [...others.map((member) => member.name), 'Cancel'], cancelButtonIndex: others.length }, (index) => {
        const target = others[index];
        if (!target) return;
        const excerpt = seat.reply.answer.trim().replace(/\s+/g, ' ').slice(0, 400);
        Alert.prompt(
          `${seat.name} asks ${target.name}`,
          'Change the question if you like.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Ask',
              onPress: (question?: string) => {
                if (!question?.trim()) return;
                if (!chat.ask(seat.partnerId, target.id, question.trim().slice(0, 2000))) toast('Not connected yet. Try again in a moment.');
              },
            },
          ],
          'plain-text',
          `What do you make of this, and what would you add? “${excerpt}”`,
        );
      });
    },
    onPin: (seat: DtGroupSeat) => {
      if (!seat.message) return;
      pinGroupMessage(client, groupId, seat.message.eventId).then(
        () => {
          refresh();
          toast('Pinned to the whiteboard');
        },
        (error: unknown) => toast(`Couldn’t pin it: ${describeError(error)}`, 'error'),
      );
    },
    onRetry: (round, seat) => {
      if (!chat.retry(round.turnId, seat.partnerId)) toast('Not connected yet. Try again in a moment.');
    },
    onSummarise: (round) => {
      const who = answeredBy(round);
      ActionSheetIOS.showActionSheetWithOptions({ title: 'Who sums it up?', options: [...who.map(([, name]) => name), 'Cancel'], cancelButtonIndex: who.length }, (index) => {
        const picked = who[index];
        if (picked && !chat.summarise(round.turnId, picked[0])) toast('Not connected yet. Try again in a moment.');
      });
    },
  };

  const removeGroup = () =>
    Alert.alert(`Delete ${group.data?.name ?? 'this group'}?`, 'All its discussions and its whiteboard are deleted. The partners stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deletePartnerGroup(client, groupId).then(
            () => {
              refresh();
              router.back();
            },
            (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);
  const menu: MenuItem[] = [
    { key: 'new', label: 'New Discussion', icon: 'pencil-square', onPress: () => choose(newGroupSessionKey()) },
    { key: 'list', label: 'Discussions', icon: 'clock', onPress: () => setSheet('discussions') },
    { key: 'board', label: 'Whiteboard', icon: 'bookmark', onPress: () => setSheet('whiteboard') },
    { key: 'manage', label: 'Manage Group', icon: 'cog-6-tooth', onPress: () => setSheet('manage') },
    { key: 'delete', label: 'Delete Group', icon: 'trash', destructive: true, onPress: removeGroup },
  ];

  if (group.isError) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <DtHeader title="Group" />
        <Text style={[styles.empty, { color: palette.textMuted }]}>{group.error instanceof DtHttpError && group.error.status === 404 ? 'This group is gone.' : `Couldn’t open it: ${describeError(group.error)}`}</Text>
      </View>
    );
  }
  const mode = DISCUSSION_MODES.find((item) => item.mode === group.data?.mode);
  const note = chat.state === 'connecting' ? 'Connecting…' : chat.state === 'reconnecting' ? 'Reconnecting…' : chat.state === 'unavailable' ? 'This group can’t be reached.' : undefined;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title={group.data?.name ?? 'Group'} menu={menu} />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        {!group.data || !key || chat.loading ? (
          <ActivityIndicator style={styles.loading} color={palette.textMuted} />
        ) : chat.loadError ? (
          <Pressable accessibilityRole="button" onPress={chat.reload} style={styles.center}>
            <Text style={[styles.empty, { color: palette.textMuted }]}>{`Couldn’t load the discussion: ${describeError(chat.loadError)}. Tap to try again.`}</Text>
          </Pressable>
        ) : chat.rounds.length ? (
          <FlashList
            ref={list}
            data={chat.rounds}
            keyExtractor={(round) => round.turnId}
            contentContainerStyle={styles.list}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }}
            onLoad={() => list.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => <GroupRoundView round={item} members={members} baseUrl={session.baseUrl} busy={chat.running} actions={actions} />}
          />
        ) : (
          <View style={styles.center}>
            <View style={styles.faces}>
              {members.map((member) => (
                <PartnerFace key={member.id} face={member} size={44} />
              ))}
            </View>
            <Text style={[styles.hello, { color: palette.text }]}>{group.data.name}</Text>
            {group.data.description ? <Text style={[styles.description, { color: palette.textMuted }]}>{group.data.description}</Text> : null}
            <Text style={[styles.hint, { color: palette.textFaint }]}>{`${members.map((member) => member.name).join(', ')}. ${mode?.hint ?? ''} Ask something, or @name one of them.`}</Text>
          </View>
        )}
        {chat.error ? (
          <Pressable accessibilityRole="button" accessibilityHint="Dismisses this" onPress={chat.clearError} style={[styles.banner, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text style={[styles.bannerText, { color: palette.danger }]} numberOfLines={3}>{`This didn’t finish: ${chat.error}`}</Text>
          </Pressable>
        ) : null}
        <GroupComposer value={draft} onChange={setDraft} onSend={send} onStop={() => void chat.stop()} running={chat.running} ready={chat.state === 'open'} members={members} quote={quote} onDropQuote={() => setQuote(null)} note={note} />
      </KeyboardAvoidingView>
      <DiscussionsSheet
        visible={sheet === 'discussions'}
        groupId={groupId}
        current={key}
        onOpen={(next) => {
          setSheet(null);
          choose(next);
        }}
        onNew={() => {
          setSheet(null);
          choose(newGroupSessionKey());
        }}
        onClose={() => setSheet(null)}
      />
      <WhiteboardSheet visible={sheet === 'whiteboard'} groupId={groupId} onClose={() => setSheet(null)} />
      {group.data ? <ManageGroupSheet visible={sheet === 'manage'} group={group.data} partners={partners.data ?? []} onClose={() => setSheet(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { marginTop: 32 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  faces: { flexDirection: 'row', gap: 6 },
  hello: { fontFamily: fonts.semibold, fontSize: 20, marginTop: 6 },
  description: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 4 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  banner: { marginHorizontal: 12, marginTop: 6, padding: 10, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  bannerText: { fontFamily: fonts.regular, fontSize: 13 },
});
