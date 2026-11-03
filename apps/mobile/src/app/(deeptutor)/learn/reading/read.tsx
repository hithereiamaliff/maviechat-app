import {
  addBookmark,
  deleteAnnotation,
  getPosition,
  isMedia,
  linkStart,
  markdownQuote,
  passageSelectors,
  PASSAGE_PROMPTS,
  rawMaterialUrl,
  removeBookmark,
  saveAnnotation,
  savePosition,
  segmentAt,
  timeOf,
  videoLinkAt,
  type DtAnnotation,
  type DtTextBlock,
  type DtTranscriptSegment,
} from '@maviechat/deeptutor-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Icon } from '@/components/Icon';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useDtAnnotations, useDtBookmarks, useDtCollection, useDtMaterial, useDtTranscript, useDtUnit } from '@/features/deeptutor/queries';
import { failureText, unitName } from '@/features/deeptutor/reading/labels';
import { MediaPlayer, type MediaPlayerHandle } from '@/features/deeptutor/reading/MediaPlayer';
import { ContentsSheet, MarkSheet } from '@/features/deeptutor/reading/ReaderSheets';
import { readingPlaces } from '@/features/deeptutor/reading/readingContext';
import { TranscriptView } from '@/features/deeptutor/reading/TranscriptView';
import { UnitView } from '@/features/deeptutor/reading/UnitView';
import { openReadingChat, TRANSLATE_LANGUAGES, useReadingAsk } from '@/features/deeptutor/reading/useReadingAsk';
import { describeError } from '@/lib/errors';
import { openLink } from '@/lib/links';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

/**
 * A material from a collection, read here: page by page (or chapter, section…) as text, with its
 * figures; or a video or recording, played above its transcript, which follows along. Highlights
 * and notes, bookmarks and your place are kept on DeepTutor; the tutor's chats know which page
 * (or moment) you're on. A PDF can also be seen as it was printed.
 */
export default function Reader() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const ask = useReadingAsk();
  const params = useLocalSearchParams<{ collection?: string; material?: string; locator?: string; t?: string }>();
  const collectionId = one(params.collection);
  const materialId = one(params.material);
  const asked = Number(one(params.locator)) || null;
  // A moment in a video (a time the tutor cited, say).
  const askedTime = one(params.t) !== '' && Number.isFinite(Number(one(params.t))) ? Math.max(0, Number(one(params.t))) : null;
  const collection = useDtCollection(collectionId);
  const detail = useDtMaterial(materialId);
  const material = collection.data?.collection.materials.find((item) => item.id === materialId);
  const media = material ? isMedia(material) : detail.data?.renderMode === 'video' || detail.data?.renderMode === 'audio';
  const position = useQuery({
    queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading', 'material', materialId, 'position'],
    queryFn: () => getPosition(client, materialId),
    enabled: Boolean(materialId) && asked === null && askedTime === null,
    staleTime: 0,
  });
  const [chosen, setChosen] = useState<{ material: string; locator: number } | null>(asked ? { material: materialId, locator: asked } : null);
  const unitCount = Math.max(1, detail.data?.unitCount ?? 1);
  const settled = asked !== null || chosen?.material === materialId || !position.isLoading;
  const transcript = useDtTranscript(materialId, Boolean(media));
  const segments = useMemo(() => transcript.data?.segments ?? [], [transcript.data]);
  // Where a video starts: the moment asked for, the line asked for, where you left it, or where its link starts.
  const savedTime = position.data ? timeOf(position.data.anchor) : null;
  const start = askedTime ?? (asked !== null ? segments.find((segment) => segment.locator === asked)?.start : undefined) ?? savedTime ?? (material ? linkStart(material.sourceUrl) : 0);
  const startKnown = askedTime !== null || (asked !== null ? !transcript.isLoading : !position.isLoading);
  const locator = Math.min(
    unitCount,
    Math.max(1, (chosen?.material === materialId ? chosen.locator : null) ?? (media && segments.length ? segmentAt(segments, start)?.locator : undefined) ?? position.data?.locator ?? 1),
  );
  const unit = useDtUnit(materialId, !media && settled && detail.data ? locator : 0);
  const annotations = useDtAnnotations(materialId);
  const bookmarks = useDtBookmarks(materialId);
  const [original, setOriginal] = useState(false);
  const [contents, setContents] = useState(false);
  const [mark, setMark] = useState<DtAnnotation | null>(null);
  // The moment you're at in a video, as the chats hear it (this file's only).
  const [moment, setMoment] = useState<{ material: string; seconds: number } | null>(null);
  const timeSeconds = moment?.material === materialId ? moment.seconds : media && startKnown ? start : undefined;
  const setTimeSeconds = (seconds: number) => setMoment({ material: materialId, seconds });
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const annotationsKey = useMemo(() => [DT_QUERY_ROOT, session.baseUrl, 'reading', 'material', materialId, 'annotations'], [session.baseUrl, materialId]);
  const bookmarksKey = useMemo(() => [DT_QUERY_ROOT, session.baseUrl, 'reading', 'material', materialId, 'bookmarks'], [session.baseUrl, materialId]);
  const unitMarks = useMemo(() => (annotations.data ?? []).filter((item) => item.locator === locator), [annotations.data, locator]);
  const bookmark = (bookmarks.data ?? []).find((item) => item.locator === locator);
  const unitWord = unitName(detail.data?.unit ?? 'section');
  const markdown = detail.data?.contentFormat === 'web_markdown';

  // The chats hear where you are.
  useEffect(() => {
    if (detail.data && collectionId) readingPlaces.update(collectionId, { materialId, revision: detail.data.revision, locator, timeSeconds });
  }, [collectionId, materialId, detail.data, locator, timeSeconds]);

  // Your place is kept on DeepTutor once you move (not the place you opened at: re-saving that
  // would wipe an e-book position the web app keeps), and not while you flick through. (A video's
  // is kept as it plays, below.)
  const saved = useRef<string | null>(null);
  const moved = chosen?.material === materialId;
  useEffect(() => {
    if (!detail.data || !moved || media) return;
    const key = `${materialId} ${locator}`;
    if (saved.current === key) return;
    const timer = setTimeout(() => {
      saved.current = key;
      void savePosition(client, materialId, { locator, anchor: '', percentage: locator / unitCount }).catch(() => undefined);
    }, 800);
    return () => clearTimeout(timer);
  }, [detail.data, moved, materialId, locator, client, unitCount, media]);

  // What's playing, kept out of state (it changes twice a second): the transcript follows it, the
  // chats hear it every few seconds, and DeepTutor keeps it as its web app does (every 5 seconds
  // played, on pause, and on leaving), with how far through it is.
  const player = useRef<MediaPlayerHandle>(null);
  const live = useRef({ material: '', time: 0, duration: 0, played: false, saved: 0, locator: 1 });
  const [playingIn, setPlayingIn] = useState<string | null>(null);
  const playing = playingIn === materialId;
  const track = () => {
    const state = live.current;
    if (state.material !== materialId) Object.assign(state, { material: materialId, time: start, duration: material?.duration ?? 0, played: false, saved: start, locator });
    return state;
  };
  const persist = (time: number) => {
    const state = track();
    state.saved = time;
    void savePosition(client, materialId, { locator: state.locator, anchor: `#t=${Math.floor(time)}`, percentage: state.duration > 0 ? Math.min(1, time / state.duration) : 0 }).catch(
      () => undefined,
    );
  };
  useEffect(() => {
    const state = live.current;
    return () => {
      if (state.material !== materialId || !state.played || Math.abs(state.time - state.saved) < 1) return;
      void savePosition(client, materialId, {
        locator: state.locator,
        anchor: `#t=${Math.floor(state.time)}`,
        percentage: state.duration > 0 ? Math.min(1, state.time / state.duration) : 0,
      }).catch(() => undefined);
    };
  }, [client, materialId]);
  // Out of sight (a chat on top), it stops.
  useFocusEffect(useCallback(() => () => player.current?.pause(), []));

  // The line playing stays in view, unless you've just scrolled away.
  const view = useRef({ top: 0, height: 0, held: false, release: undefined as ReturnType<typeof setTimeout> | undefined });
  const listTop = useRef(0);
  const segmentTops = useRef(new Map<number, number>());
  const keepInView = (target: number) => {
    const y = segmentTops.current.get(target);
    const at = view.current;
    if (y === undefined || at.held) return;
    const top = listTop.current + y;
    if (top < at.top + 8 || top > at.top + at.height - 96) scroll.current?.scrollTo({ y: Math.max(0, top - 8), animated: true });
  };

  const onTime = (seconds: number, duration: number) => {
    const state = track();
    if (duration > 0) state.duration = duration;
    if (!state.played) return;
    state.time = seconds;
    const segment = segmentAt(segments, seconds);
    if (segment && segment.locator !== state.locator) {
      state.locator = segment.locator;
      setChosen({ material: materialId, locator: segment.locator });
      keepInView(segment.locator);
    }
    if (Math.abs(seconds - state.saved) >= 5) {
      persist(seconds);
      setTimeSeconds(seconds);
    }
  };
  const onPlaying = (now: boolean) => {
    const state = track();
    setPlayingIn(now ? materialId : null);
    if (now) {
      state.played = true;
      return;
    }
    if (!state.played) return;
    if (Math.abs(state.time - state.saved) >= 1) persist(state.time);
    setTimeSeconds(state.time);
  };
  const playedTime = () => {
    const state = track();
    return state.played ? state.time : (timeSeconds ?? start);
  };

  const go = (target: number) => {
    setChosen({ material: materialId, locator: Math.min(unitCount, Math.max(1, target)) });
    setContents(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const keepMark = (saved: DtAnnotation, replaces?: string) =>
    queryClient.setQueryData<DtAnnotation[]>(annotationsKey, (old) => [...(old ?? []).filter((item) => item.id !== (replaces ?? saved.id)), saved]);

  const highlight = async (block: DtTextBlock, note = '') => {
    const text = unit.data ?? '';
    const end = Math.min(block.end, block.start + 2000);
    try {
      const saved = await saveAnnotation(
        client,
        materialId,
        markdown
          ? { locator, quote: markdownQuote(block.text).slice(0, 2000), note }
          : { locator, quote: text.slice(block.start, end), note, selectors: passageSelectors(text, block.start, end) },
      );
      keepMark(saved);
    } catch (error) {
      toast(`Couldn't keep the highlight: ${describeError(error)}`, 'error');
    }
  };

  const updateMark = async (target: DtAnnotation, change: { note: string; color: string }) => {
    try {
      keepMark(
        await saveAnnotation(client, materialId, {
          id: target.id,
          locator: target.locator,
          kind: target.kind,
          color: change.color,
          quote: target.quote,
          note: change.note,
          anchor: target.anchor,
          rects: target.rects,
          selectors: target.selectors,
        }),
      );
      setMark(null);
    } catch (error) {
      toast(`Couldn't save it: ${describeError(error)}`, 'error');
    }
  };

  const removeMark = (target: DtAnnotation) =>
    Alert.alert('Remove this highlight?', target.note ? 'Its note goes too.' : undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setMark(null);
          deleteAnnotation(client, materialId, target.id)
            .then(() => queryClient.setQueryData<DtAnnotation[]>(annotationsKey, (old) => (old ?? []).filter((item) => item.id !== target.id)))
            .catch((error: unknown) => toast(`Couldn't remove it: ${describeError(error)}`, 'error'));
        },
      },
    ]);

  const translate = (passage: string) =>
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Translate into', options: [...TRANSLATE_LANGUAGES, 'Cancel'], cancelButtonIndex: TRANSLATE_LANGUAGES.length }, (index) => {
      const language = TRANSLATE_LANGUAGES[index];
      if (language) void ask(collectionId, PASSAGE_PROMPTS.translate(language), passage);
    });

  const noteFor = (onNote: (note: string) => void, initial = '') =>
    Alert.prompt('Note', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Save', onPress: (value?: string) => (value?.trim() ? onNote(value.trim()) : undefined) }], 'plain-text', initial);

  // Long-press on a paragraph, as DeepTutor's selection card offers.
  const blockAction = (block: DtTextBlock, marks: DtAnnotation[]) => {
    const passage = (markdown ? markdownQuote(block.text) : block.text).slice(0, 2000);
    const first = marks[0];
    const options = [first ? 'Edit Highlight' : 'Highlight', first ? 'Edit Note…' : 'Add a Note…', 'Ask the Tutor', 'Explain', 'Translate…', 'Guide Me Through It', 'Copy', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1, title: passage.length > 140 ? `${passage.slice(0, 140)}…` : passage }, (index) => {
      if (index === 0) return first ? setMark(first) : void highlight(block);
      if (index === 1) return noteFor((note) => (first ? void updateMark(first, { note, color: first.color }) : void highlight(block, note)), first?.note ?? '');
      if (index === 2) return openReadingChat(collectionId, passage);
      if (index === 3) return void ask(collectionId, PASSAGE_PROMPTS.explain, passage);
      if (index === 4) return translate(passage);
      if (index === 5) return void ask(collectionId, PASSAGE_PROMPTS.guide, passage);
      if (index === 6) return void Clipboard.setStringAsync(passage).then(() => toast('Copied'));
    });
  };

  // A transcript segment: play from it (it becomes your place), or note it and ask about it.
  const pickSegment = (segment: DtTranscriptSegment) => {
    setChosen({ material: materialId, locator: segment.locator });
    setTimeSeconds(segment.start);
    const state = track();
    state.time = segment.start;
    state.locator = segment.locator;
    persist(segment.start);
    player.current?.seek(segment.start);
  };
  const segmentAction = (segment: DtTranscriptSegment) => {
    // The tutor hears which line you're asking about; the video carries on.
    setChosen({ material: materialId, locator: segment.locator });
    setTimeSeconds(segment.start);
    const options = ['Play From Here', 'Add a Note…', 'Ask the Tutor', 'Explain', 'Copy', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1 }, (index) => {
      if (index === 0) return pickSegment(segment);
      if (index === 1)
        return noteFor((note) =>
          void saveAnnotation(client, materialId, { locator: segment.locator, kind: 'note', quote: segment.text.slice(0, 2000), note, anchor: `#t=${Math.floor(segment.start)}` })
            .then((saved) => keepMark(saved))
            .catch((error: unknown) => toast(`Couldn't keep the note: ${describeError(error)}`, 'error')),
        );
      if (index === 2) return openReadingChat(collectionId, segment.text);
      if (index === 3) return void ask(collectionId, PASSAGE_PROMPTS.explain, segment.text);
      if (index === 4) return void Clipboard.setStringAsync(segment.text).then(() => toast('Copied'));
    });
  };

  const toggleBookmark = async () => {
    try {
      if (bookmark) await removeBookmark(client, materialId, bookmark.id);
      else await addBookmark(client, materialId, locator, detail.data?.unitRefs.find((ref) => ref.locator === locator)?.title || `${unitWord} ${locator}`);
      void queryClient.invalidateQueries({ queryKey: bookmarksKey });
    } catch (error) {
      toast(`Couldn't change the bookmark: ${describeError(error)}`, 'error');
    }
  };

  const others = (collection.data?.collection.materials ?? []).filter((item) => item.id !== materialId && item.status === 'ready');
  const switchTo = () =>
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Open another file', options: [...others.map((item) => item.title), 'Cancel'], cancelButtonIndex: others.length }, (index) => {
      const next = others[index];
      if (next) router.setParams({ material: next.id, locator: '', t: '' });
    });

  const menu: MenuItem[] = [
    { key: 'contents', label: 'Contents and Highlights', icon: 'list-bullet', onPress: () => setContents(true) },
    ...(!media ? [{ key: 'bookmark', label: bookmark ? 'Remove Bookmark' : `Bookmark This ${unitWord}`, icon: bookmark ? ('bookmark-slash' as const) : ('bookmark' as const), onPress: () => void toggleBookmark() }] : []),
    ...(detail.data?.hasRawView && !media ? [{ key: 'original', label: original ? 'Show as Text' : 'Show as Printed', icon: 'document-text' as const, onPress: () => setOriginal(!original) }] : []),
    // YouTube's or Bilibili's own app, at the moment you're at.
    ...(media && material && (material.kind === 'youtube' || material.kind === 'bilibili')
      ? [
          {
            key: 'watch',
            label: material.kind === 'youtube' ? 'Watch on YouTube' : 'Watch on Bilibili',
            icon: 'play' as const,
            onPress: () => void openLink(videoLinkAt(material.sourceUrl, playedTime())),
          },
        ]
      : []),
    ...(others.length ? [{ key: 'switch', label: 'Open Another File', icon: 'rectangle-stack' as const, onPress: switchTo }] : []),
    { key: 'ask', label: 'Ask the Tutor', icon: 'chat-bubble-left-right', onPress: () => openReadingChat(collectionId) },
    {
      key: 'web',
      label: 'Open in DeepTutor Web App',
      icon: 'arrow-top-right-on-square',
      onPress: () => router.push({ pathname: '/learn/web', params: { path: `/learning/reading/${encodeURIComponent(collectionId)}`, title: collection.data?.collection.title ?? 'Reading' } }),
    },
  ];

  const title = detail.data?.title || material?.title || 'Reading';
  const notReady = material && material.status !== 'ready';

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title={title} menu={menu} />
      {notReady ? (
        <View style={styles.center}>
          {material.status === 'failed' ? (
            <Text style={[styles.note, { color: palette.danger }]}>{failureText(material)}</Text>
          ) : (
            <>
              <ActivityIndicator color={palette.textMuted} />
              <Text style={[styles.note, { color: palette.textMuted }]}>{`Preparing… ${material.progress}%`}</Text>
            </>
          )}
        </View>
      ) : detail.isLoading ? (
        <ActivityIndicator style={styles.loading} color={palette.textMuted} />
      ) : detail.isError || !detail.data ? (
        <Text style={[styles.note, styles.padded, { color: palette.danger }]}>{`Couldn't open it: ${describeError(detail.error)}`}</Text>
      ) : original ? (
        <WebView<object>
          source={{ uri: rawMaterialUrl(session.baseUrl, materialId), headers: { Authorization: `Bearer ${session.token}` } }}
          originWhitelist={['*']}
          sharedCookiesEnabled
          style={styles.screen}
        />
      ) : media ? (
        <>
          {material && startKnown ? (
            <MediaPlayer key={materialId} ref={player} material={material} start={start} onTime={onTime} onPlaying={onPlaying} />
          ) : (
            <View style={[material?.renderMode === 'audio' || material?.kind === 'audio' ? styles.audioSpace : styles.videoSpace, { backgroundColor: palette.surface }]} />
          )}
          <ScrollView
            ref={scroll}
            contentContainerStyle={styles.content}
            scrollEventThrottle={100}
            onLayout={(event) => {
              view.current.height = event.nativeEvent.layout.height;
            }}
            onScroll={(event) => {
              view.current.top = event.nativeEvent.contentOffset.y;
            }}
            onScrollBeginDrag={() => {
              clearTimeout(view.current.release);
              view.current.held = true;
            }}
            onScrollEndDrag={() => {
              view.current.release = setTimeout(() => {
                view.current.held = false;
              }, 4000);
            }}>
            {material?.kind === 'bilibili' && segments.length ? (
              <Text style={[styles.hint, { color: palette.textMuted }]}>Bilibili&apos;s player doesn&apos;t say where it is, so the transcript can&apos;t follow it. Tap a line to play from there.</Text>
            ) : null}
            {transcript.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
            {!transcript.isLoading && !segments.length ? (
              <Text style={[styles.note, { color: palette.textMuted }]}>
                This has no transcript, so the tutor can&apos;t follow what&apos;s said. You can still play it here and ask the tutor about it.
              </Text>
            ) : null}
            <View
              onLayout={(event) => {
                listTop.current = event.nativeEvent.layout.y;
              }}>
              <TranscriptView
                segments={segments}
                current={locator}
                playing={playing}
                notes={(annotations.data ?? []).filter((item) => item.kind === 'note')}
                onPick={pickSegment}
                onAction={segmentAction}
                onNotePress={setMark}
                onSegmentLayout={(at, y) => {
                  segmentTops.current.set(at, y);
                }}
              />
            </View>
          </ScrollView>
        </>
      ) : (
        <>
          <ScrollView ref={scroll} contentContainerStyle={styles.content}>
            {unit.isLoading || !settled ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
            {unit.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't load this ${unitWord.toLowerCase()}: ${describeError(unit.error)}`}</Text> : null}
            {unit.data !== undefined ? (
              <UnitView materialId={materialId} text={unit.data} markdown={markdown} annotations={unitMarks} onBlockAction={blockAction} onMarkPress={setMark} />
            ) : null}
          </ScrollView>
          <View style={[styles.footer, { borderTopColor: palette.border }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Previous ${unitWord.toLowerCase()}`} disabled={locator <= 1} onPress={() => go(locator - 1)} hitSlop={8} style={styles.turn}>
              <Icon name="chevron-left" size={20} color={locator <= 1 ? palette.textFaint : palette.text} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityHint="Shows the contents" onPress={() => setContents(true)} style={styles.where}>
              <Text style={[styles.whereText, { color: palette.textMuted }]}>{`${unitWord} ${locator} of ${unitCount}`}</Text>
              {bookmark ? <Icon name="bookmark" size={13} color={palette.textMuted} /> : null}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Next ${unitWord.toLowerCase()}`} disabled={locator >= unitCount} onPress={() => go(locator + 1)} hitSlop={8} style={styles.turn}>
              <Icon name="chevron-right" size={20} color={locator >= unitCount ? palette.textFaint : palette.text} />
            </Pressable>
          </View>
        </>
      )}
      <ContentsSheet
        visible={contents}
        detail={detail.data}
        current={locator}
        bookmarks={bookmarks.data ?? []}
        annotations={annotations.data ?? []}
        onClose={() => setContents(false)}
        onGo={go}
      />
      <MarkSheet
        annotation={mark}
        onClose={() => setMark(null)}
        onSave={(change) => (mark ? void updateMark(mark, change) : undefined)}
        onDelete={() => (mark ? removeMark(mark) : undefined)}
        onAsk={() => {
          const quote = mark?.quote;
          setMark(null);
          openReadingChat(collectionId, quote);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { marginTop: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  padded: { padding: 16 },
  content: { padding: 20, paddingBottom: 48 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  videoSpace: { width: '100%', aspectRatio: 16 / 9 },
  audioSpace: { width: '100%', height: 90 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  turn: { padding: 8 },
  where: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md },
  whereText: { fontFamily: fonts.medium, fontSize: 13 },
});
