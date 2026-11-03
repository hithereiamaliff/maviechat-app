import {
  DT_RECALL_TARGETS,
  deleteMasteryPath,
  masteryTitle,
  newlyMastered,
  nextStepText,
  openingMessage,
  renameMasteryPath,
  resetMasteryPath,
  setRecallTarget,
  setReviewStrategy,
  sortedReviews,
  type DtKnowledgePoint,
  type DtMasteryTopic,
} from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useAnchoredMenu, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { updateDraft } from '@/features/chat/drafts';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { MapEditor } from '@/features/deeptutor/learning/MapEditor';
import { useStartPathChat } from '@/features/deeptutor/learning/pathChat';
import { pointStatusLabel, PointSheet } from '@/features/deeptutor/learning/PointSheet';
import { sessionDate, useDtMasterySessions, useDtMasteryTopic, useDtReviewStrategies } from '@/features/deeptutor/queries';
import { openDtPage } from '@/features/deeptutor/settings/DtGeneralSettings';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * A mastery path: how far you are, what's next, the outline of modules and knowledge points (tap
 * one for what its mastery rests on), reviews and how they're scheduled, what the tutor knows
 * about you, and the path's chats.
 */
export default function MasteryPathPage() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const params = useLocalSearchParams<{ id: string }>();
  const pathId = Array.isArray(params.id) ? (params.id[0] ?? '') : (params.id ?? '');
  const topic = useDtMasteryTopic(pathId);
  const sessions = useDtMasterySessions(pathId);
  const strategies = useDtReviewStrategies();
  const startChat = useStartPathChat();
  const [point, setPoint] = useState<DtKnowledgePoint | null>(null);
  const [editing, setEditing] = useState(false);
  const [allReviews, setAllReviews] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = topic.data;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'mastery'] });

  // A point newly mastered (in a chat, or marked known) gets a note, as DeepTutor celebrates it;
  // only from the screen in front, as a path chat above this page notes it too.
  const last = useRef<DtMasteryTopic | undefined>(undefined);
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );
  useEffect(() => {
    if (!data) return;
    const gained = newlyMastered(last.current, data);
    last.current = data;
    if (gained.length && focused.current) toast(`Mastered: ${gained.map((item) => item.name).join(', ')}`, 'success');
  }, [data, toast]);

  const change = async (what: string, run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      refresh();
    } catch (error) {
      toast(`Couldn't ${what}: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const rename = () =>
    Alert.prompt(
      'Rename Path',
      'Leave it empty to go back to the name DeepTutor gave it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Rename', onPress: (value?: string) => void change('rename it', () => renameMasteryPath(client, pathId, value ?? '')) },
      ],
      'plain-text',
      data?.name ?? '',
    );
  const reset = () =>
    Alert.alert('Reset progress?', 'The modules stay. Every answer, mastery level, review and point you marked as known is cleared.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => void change('reset it', () => resetMasteryPath(client, pathId)) },
    ]);
  const remove = () =>
    Alert.alert('Delete this path?', "It can't be undone. Its chats stay, as ordinary chats.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void change('delete it', async () => {
            await deleteMasteryPath(client, pathId);
            void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'learning-index'] });
            if (router.canGoBack()) router.back();
            else router.replace('/learn/mastery');
          }),
      },
    ]);

  const menu: MenuItem[] = data
    ? [
        { key: 'rename', label: 'Rename', icon: 'pencil', onPress: rename },
        { key: 'edit', label: 'Edit Modules', icon: 'view-columns', onPress: () => setEditing(true) },
        { key: 'reset', label: 'Reset Progress', icon: 'arrow-path', onPress: reset },
        { key: 'web', label: 'More on the Web', icon: 'arrow-top-right-on-square', onPress: () => openDtPage(`/learning/mastery/${encodeURIComponent(pathId)}`, masteryTitle(data)) },
        { key: 'delete', label: 'Delete Path', icon: 'trash', destructive: true, onPress: remove },
      ]
    : [];

  const strategyItems: MenuItem[] = [
    { key: 'default', label: 'Default', icon: data?.strategy ? 'arrow-path' : 'check', onPress: () => void change('change it', () => setReviewStrategy(client, pathId, '')) },
    ...(strategies.data ?? []).map((item) => ({
      key: item.id,
      label: item.builtin ? item.name : `${item.name} (yours)`,
      icon: data?.strategy?.id === item.id ? ('check' as const) : ('calendar' as const),
      onPress: () => void change('change it', () => setReviewStrategy(client, pathId, item.id)),
    })),
  ];
  const { ref: strategyRef, open: openStrategy, menu: strategyMenu } = useAnchoredMenu(strategyItems);
  const targets = [...new Set([...DT_RECALL_TARGETS, ...(data ? [data.recallTarget] : [])])].sort((a, b) => a - b);
  const { ref: targetRef, open: openTarget, menu: targetMenu } = useAnchoredMenu(
    targets.map((value) => ({
      key: String(value),
      label: percent(value),
      icon: Math.abs((data?.recallTarget ?? 0) - value) < 1e-6 ? 'check' : 'bolt',
      onPress: () => void change('change it', () => setRecallTarget(client, pathId, value)),
    })),
  );

  if (!data) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <DtHeader title="Mastery Path" />
        {topic.isError ? (
          <Pressable accessibilityRole="button" onPress={refresh}>
            <Text style={[styles.message, { color: palette.danger }]}>{`Couldn't load this path: ${describeError(topic.error)}. Tap to try again.`}</Text>
          </Pressable>
        ) : (
          <ActivityIndicator style={styles.loading} color={palette.textMuted} />
        )}
      </View>
    );
  }

  const chats = sessions.data ?? [];
  const noOutline = data.counts.total === 0;
  const next = data.next;
  const due = data.reviews.filter((review) => review.due);
  const reviews = sortedReviews(data.reviews);
  const openChat = (id: string) => router.push({ pathname: '/learn/[id]', params: { id } });
  const go = () => {
    if (!next || data.complete) return void startChat(pathId, 'review', openingMessage('review'));
    if (next.action === 'answer_pending') {
      const holder = next.sessionId || chats.find((chat) => chat.pendingQuestion)?.id;
      if (holder) return openChat(holder);
    }
    if (chats[0]) return openChat(chats[0].id);
    if (next.action === 'review') return void startChat(pathId, 'review', openingMessage('review', [next.pointName]));
    return void startChat(pathId, 'study');
  };
  const goLabel = data.complete
    ? 'Review What You Know'
    : next?.action === 'answer_pending'
      ? 'Answer Your Tutor'
      : chats.length
        ? 'Continue Learning'
        : next?.action === 'review'
          ? 'Start the Review'
          : 'Begin';

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title={masteryTitle(data)} menu={menu} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        <View style={styles.top}>
          <Text style={styles.emoji}>{data.emoji}</Text>
          <View style={styles.topText}>
            <Text style={[styles.goal, { color: palette.text }]}>{data.description || data.goal}</Text>
            {data.sources.length ? (
              <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={2}>
                {`From: ${data.sources
                  .slice(0, 5)
                  .map((source) => source.label)
                  .join(', ')}`}
              </Text>
            ) : null}
          </View>
        </View>
        {!noOutline ? (
          <View style={styles.progress}>
            <Text style={[styles.meta, { color: palette.textMuted }]}>{`${data.counts.mastered} of ${data.counts.total} knowledge points mastered`}</Text>
            <View style={[styles.track, { backgroundColor: palette.surfaceStrong }]}>
              <View style={[styles.fill, { width: percent(data.counts.mastered / data.counts.total), backgroundColor: palette.success }]} />
            </View>
          </View>
        ) : null}

        <View style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
          {noOutline ? (
            <>
              <Text style={[styles.label, { color: palette.textMuted }]}>Next up</Text>
              <Text style={[styles.cardTitle, { color: palette.text }]}>Design the outline</Text>
              <Text style={[styles.note, { color: palette.textMuted }]}>This goal has no outline yet. Agree one with the tutor, or write the modules yourself.</Text>
              <Button label="Design It With the Tutor" onPress={() => void startChat(pathId, 'outline', openingMessage('outline'))} />
              <Button label="Write the Modules Myself" variant="secondary" onPress={() => setEditing(true)} />
            </>
          ) : (
            <>
              <Text style={[styles.label, { color: palette.textMuted }]}>Next up</Text>
              <Text style={[styles.cardTitle, { color: palette.text }]}>{data.complete ? 'Everything is mastered' : next?.pointName || 'Keep going'}</Text>
              <Text style={[styles.note, { color: palette.textMuted }]}>{nextStepText(data.complete ? 'complete' : (next?.action ?? '')) || next?.reason || ''}</Text>
              <Button label={goLabel} onPress={go} />
            </>
          )}
        </View>

        {!noOutline ? (
          <View style={styles.section}>
            <Text style={[styles.heading, { color: palette.textMuted }]}>Outline</Text>
            {data.modules.map((module, index) => (
              <View key={module.id} style={[styles.module, { borderColor: palette.border }]}>
                <View style={styles.moduleHead}>
                  <Text style={[styles.moduleName, { color: palette.text }]}>{`${index + 1}. ${module.name}`}</Text>
                  <Text style={[styles.meta, { color: palette.textMuted }]}>{`${module.mastered}/${module.total}`}</Text>
                </View>
                {module.objective ? <Text style={[styles.note, { color: palette.textMuted }]}>{module.objective}</Text> : null}
                {module.points.map((item) => {
                  const isNext = !data.complete && next?.pointId === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.name}, ${pointStatusLabel(item)}${isNext ? ', next' : ''}`}
                      onPress={() => setPoint(item)}
                      style={({ pressed }) => [styles.point, pressed && { backgroundColor: palette.surface }]}>
                      <View
                        style={[
                          styles.mark,
                          item.status === 'mastered'
                            ? { backgroundColor: palette.success, borderColor: palette.success }
                            : item.status === 'learning'
                              ? { borderColor: palette.link, borderWidth: 2 }
                              : { borderColor: palette.border },
                        ]}>
                        {item.status === 'mastered' ? <Icon name={item.masterySource === 'learner' ? 'sparkles' : 'check'} size={11} color={palette.background} strokeWidth={2.5} /> : null}
                      </View>
                      <Text style={[styles.pointName, { color: item.status === 'new' ? palette.textMuted : palette.text }]} numberOfLines={2}>
                        {item.name}
                      </Text>
                      {isNext ? (
                        <View style={[styles.badge, { backgroundColor: palette.active }]}>
                          <Text style={[styles.badgeText, { color: palette.onActive }]}>Next</Text>
                        </View>
                      ) : null}
                      <Text style={[styles.status, { color: palette.textFaint }]}>{pointStatusLabel(item)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        ) : null}

        {!noOutline ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={[styles.heading, styles.grow, { color: palette.textMuted }]}>{due.length ? `Reviews · ${due.length} due` : 'Reviews'}</Text>
              {due.length ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void startChat(pathId, 'review', openingMessage('review', due.map((review) => review.pointName)))}
                  hitSlop={6}>
                  <Text style={[styles.link, { color: palette.link }]}>Start Review</Text>
                </Pressable>
              ) : null}
            </View>
            {reviews.length === 0 ? <Text style={[styles.note, { color: palette.textMuted }]}>Points you master come back here for review on a schedule.</Text> : null}
            {(allReviews ? reviews : reviews.slice(0, 5)).map((review) => (
              <View key={review.id || review.pointId} style={[styles.review, { borderColor: palette.border }]}>
                <View style={styles.grow}>
                  <Text style={[styles.pointName, { color: palette.text }]}>{review.pointName}</Text>
                  <Text style={[styles.meta, { color: review.due ? palette.text : palette.textMuted }]}>
                    {[review.due ? 'Ready now' : review.dueAt ? `Due ${sessionDate(review.dueAt)}` : '', `risk ${percent(review.risk)}`, review.recentFailure ? 'missed recently' : ''].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`Review ${review.pointName}`} onPress={() => void startChat(pathId, 'review', openingMessage('review', [review.pointName]))} hitSlop={6}>
                  <Icon name="play" size={18} color={palette.link} />
                </Pressable>
              </View>
            ))}
            {reviews.length > 5 ? (
              <Pressable accessibilityRole="button" onPress={() => setAllReviews((value) => !value)} hitSlop={6}>
                <Text style={[styles.link, { color: palette.link }]}>{allReviews ? 'Show fewer' : `Show all ${reviews.length}`}</Text>
              </Pressable>
            ) : null}
            <Pressable ref={strategyRef} accessibilityRole="button" onPress={openStrategy} disabled={busy} style={[styles.setting, { borderColor: palette.border }]}>
              <Text style={[styles.settingLabel, { color: palette.text }]}>Review plan</Text>
              <Text style={[styles.settingValue, { color: palette.textMuted }]} numberOfLines={1}>
                {data.strategy?.name ?? 'Default'}
              </Text>
              <Icon name="chevron-down" size={14} color={palette.textMuted} />
            </Pressable>
            <Pressable ref={targetRef} accessibilityRole="button" onPress={openTarget} disabled={busy} style={[styles.setting, { borderColor: palette.border }]}>
              <Text style={[styles.settingLabel, { color: palette.text }]}>Recall target</Text>
              <Text style={[styles.settingValue, { color: palette.textMuted }]}>{percent(data.recallTarget)}</Text>
              <Icon name="chevron-down" size={14} color={palette.textMuted} />
            </Pressable>
            <Text style={[styles.note, { color: palette.textFaint }]}>A higher target brings reviews sooner. Your own review plans are made and edited on the web.</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={[styles.heading, { color: palette.textMuted }]}>About you</Text>
          {data.learner ? (
            <View style={[styles.module, { borderColor: palette.border }]}>
              {[
                ['Already knows', data.learner.priorKnowledge],
                ['Wants to reach', data.learner.targetLevel],
                ['Time to give', data.learner.timeBudget],
                ['How to teach', [data.learner.preferences, data.learner.teachFirst ? 'teach first' : ''].filter(Boolean).join(' · ')],
                ['Other', data.learner.notes],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <View key={label} style={styles.fact}>
                    <Text style={[styles.factLabel, { color: palette.textMuted }]}>{label}</Text>
                    <Text style={[styles.note, { color: palette.text }]}>{value}</Text>
                  </View>
                ))}
            </View>
          ) : (
            <Text style={[styles.note, { color: palette.textMuted }]}>The tutor hasn&apos;t asked yet. Tell it in a chat to change anything here.</Text>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={[styles.heading, styles.grow, { color: palette.textMuted }]}>Chats</Text>
            <Pressable accessibilityRole="button" onPress={() => void startChat(pathId, noOutline ? 'outline' : 'study')} hitSlop={6}>
              <Text style={[styles.link, { color: palette.link }]}>New Chat</Text>
            </Pressable>
          </View>
          {sessions.isError && chats.length === 0 ? <Text style={[styles.note, { color: palette.danger }]}>Couldn&apos;t load the chats.</Text> : null}
          {!sessions.isLoading && chats.length === 0 ? <Text style={[styles.note, { color: palette.textMuted }]}>No chats yet.</Text> : null}
          {chats.map((chat) => (
            <Pressable
              key={chat.id}
              accessibilityRole="button"
              onPress={() => openChat(chat.id)}
              style={({ pressed }) => [styles.chat, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <View style={styles.grow}>
                <Text style={[styles.pointName, { color: palette.text }]} numberOfLines={1}>
                  {chat.title || 'Untitled chat'}
                </Text>
                {chat.lastMessage ? (
                  <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={2}>
                    {chat.lastMessage}
                  </Text>
                ) : null}
                <Text style={[styles.meta, { color: palette.textFaint }]}>
                  {chat.running
                    ? 'The tutor is answering…'
                    : [`${chat.messageCount} ${chat.messageCount === 1 ? 'message' : 'messages'}`, sessionDate(chat.updatedAt), chat.pendingQuestion ? 'a question waits for you' : ''].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Icon name="chevron-right" size={16} color={palette.textFaint} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
      {strategyMenu}
      {targetMenu}
      <PointSheet
        pathId={pathId}
        point={point}
        onClose={() => setPoint(null)}
        onStudy={(item) => {
          // As on DeepTutor: a new study chat with the request written in, for you to send.
          setPoint(null);
          updateDraft(`dt:path:${pathId}`, (draft) => ({ ...draft, text: `Tutor me on "${item.name}". Start with a quick check.` }));
          void startChat(pathId, 'study');
        }}
      />
      <MapEditor topic={data} visible={editing} onClose={() => setEditing(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { marginTop: 40 },
  message: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  top: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  emoji: { fontSize: 30 },
  topText: { flex: 1, gap: 4 },
  goal: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  progress: { gap: 6 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 14, gap: 8 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 18 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  section: { gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center' },
  heading: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  grow: { flex: 1 },
  link: { fontFamily: fonts.medium, fontSize: 14 },
  module: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 12, gap: 4 },
  moduleHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  moduleName: { flex: 1, fontFamily: fonts.semibold, fontSize: 15 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderRadius: radius.sm },
  mark: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  pointName: { flex: 1, fontFamily: fonts.medium, fontSize: 14 },
  badge: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontFamily: fonts.semibold, fontSize: 11 },
  status: { fontFamily: fonts.regular, fontSize: 11 },
  review: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, height: 44 },
  settingLabel: { fontFamily: fonts.medium, fontSize: 14 },
  settingValue: { flex: 1, textAlign: 'right', fontFamily: fonts.regular, fontSize: 14 },
  fact: { gap: 2, paddingVertical: 4 },
  factLabel: { fontFamily: fonts.medium, fontSize: 12 },
  chat: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
