import { noteHtml } from '@maviechat/owui-markdown';
import { getNote, noteChangeOf, noteTitle, saveKeepsSharing, saveNoteNow, type Note, type NoteChange } from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackHeader } from '@/components/BackHeader';
import { IconButton } from '@/components/IconButton';
import type { IconName } from '@/components/Icon';
import { SideScroll } from '@/components/SideScroll';
import { useToast } from '@/components/Toast';
import { useLive } from '@/features/live/LiveProvider';
import { applyFormat, noteCounts, toggleTask, type NoteFormat, type Selection } from '@/features/notes/formatting';
import { noteWhen } from '@/features/notes/noteText';
import { useNote } from '@/features/notes/queries';
import { useNoteActions } from '@/features/notes/useNoteActions';
import { Chip } from '@/features/workspace/ListControls';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities } from '@/lib/server';
import { Markdown } from '@/markdown/Markdown';
import { fonts, radius, usePalette } from '@/theme';

const FORMATS: { format: NoteFormat; icon: IconName; label: string }[] = [
  { format: 'bold', icon: 'bold', label: 'Bold' },
  { format: 'italic', icon: 'italic', label: 'Italic' },
  { format: 'strike', icon: 'strikethrough', label: 'Strikethrough' },
  { format: 'heading', icon: 'h1', label: 'Heading (press again for smaller, then none)' },
  { format: 'bullet', icon: 'list-bullet', label: 'Bulleted list' },
  { format: 'number', icon: 'numbered-list', label: 'Numbered list' },
  { format: 'task', icon: 'check-circle', label: 'Checklist' },
  { format: 'quote', icon: 'chat-bubble-bottom-center-text', label: 'Quote' },
  { format: 'code', icon: 'code-bracket', label: 'Code' },
  { format: 'codeBlock', icon: 'code-bracket-square', label: 'Code block' },
  { format: 'link', icon: 'link', label: 'Link' },
];

/** Changes wait this long after the last keystroke, then save. */
const SAVE_DELAY_MS = 800;
/**
 * How often an open note is read again. Typing on the web is saved over the web's live editing
 * link, which sends no note event; renames and other saves do (those come at once).
 */
const CHECK_EVERY_MS = 5000;

/** A note, as the web's note page: its title, the text (written here as Markdown, or read formatted), saved as you go. */
export default function NoteScreen() {
  const palette = usePalette();
  const { id, new: fresh } = useLocalSearchParams<{ id: string; new?: string }>();
  const note = useNote(id ?? '');
  if (!note.data) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <BackHeader title="Note" fallback="/notes" />
        <View style={styles.center}>{note.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t open the note: ${describeError(note.error)}`}</Text> : <ActivityIndicator color={palette.textMuted} />}</View>
      </View>
    );
  }
  return <NoteEditor key={note.data.id} note={note.data} fresh={fresh === '1'} />;
}

function NoteEditor({ note, fresh }: { note: Note; fresh: boolean }) {
  const palette = usePalette();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { client, session } = useAuthed();
  const capabilities = useCapabilities();
  const { watchNote } = useLive();
  const queryClient = useQueryClient();
  const actions = useNoteActions();
  const keyboardShown = useKeyboardState((state) => state.isVisible);
  // After a save, the lists (and pinned notes, by title) read again; this note is checked on its own.
  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['notes', 'list'] });
    void queryClient.invalidateQueries({ queryKey: ['notes', 'pinned'] });
  };
  // The first copy read: the text and title start from it (later reads only update the menu).
  const [first] = useState(note);
  const keepsSharing = capabilities ? saveKeepsSharing(first.accessGrants, capabilities) : false;
  // A note the web wrote without a Markdown copy can't be written here without losing its text.
  const hasMarkdown = Boolean(first.md) || !first.html.replace(/<[^>]*>/g, '').trim();
  // A 0.12 note of several pages is written a page at a time on the web; here its pages show together.
  const onePage = first.pageCount <= 1;
  const canWrite = first.writeAccess && keepsSharing && hasMarkdown && onePage;
  // As on the web, only the owner (or an admin) renames a note.
  const canRename = canWrite && (capabilities?.isAdmin || first.ownerId === session.user.id);
  const [title, setTitle] = useState(first.title);
  const [md, setMd] = useState(first.md);
  const [mode, setMode] = useState<'write' | 'preview'>(canWrite && (fresh || !first.md.trim()) ? 'write' : 'preview');
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [forced, setForced] = useState<Selection | undefined>(undefined);
  const [status, setStatus] = useState<'saved' | 'waiting' | 'saving' | 'failed'>('saved');
  const [elsewhere, setElsewhere] = useState<NoteChange | null>(null);
  const [now] = useState(() => new Date().getTime());
  const counts = noteCounts(md);

  // What the server has (as read or last saved, with when it was saved) and what's typed here.
  const server = useRef({ title: first.title, md: first.md, updatedAt: first.updatedAt });
  const latest = useRef({ title: first.title, md: first.md });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  // What a save under way is sending: its echo can come back before the save has answered.
  const sending = useRef<{ title?: string; md?: string } | null>(null);

  // One save at a time, each with what's typed by then; a failed one is tried again with the next change.
  const save = () => {
    chain.current = chain.current.then(async () => {
      const { title: nextTitle, md: nextMd } = latest.current;
      const titleChanged = nextTitle !== server.current.title;
      const textChanged = nextMd !== server.current.md;
      if (!titleChanged && !textChanged) return setStatus('saved');
      setStatus('saving');
      sending.current = { ...(titleChanged ? { title: nextTitle } : {}), ...(textChanged ? { md: nextMd } : {}) };
      try {
        const saved = await saveNoteNow(client, first.id, { ...(titleChanged ? { title: nextTitle } : {}), ...(textChanged ? { md: nextMd, html: noteHtml(nextMd) } : {}) });
        server.current = { title: titleChanged ? saved.title : server.current.title, md: textChanged ? nextMd : server.current.md, updatedAt: Math.max(server.current.updatedAt, saved.updatedAt) };
        setStatus(latest.current.title === server.current.title && latest.current.md === server.current.md ? 'saved' : 'waiting');
        refreshLists();
      } catch (error) {
        setStatus('failed');
        toast(`Couldn’t save the note: ${describeError(error)}`, 'error');
      } finally {
        sending.current = null;
      }
    });
  };
  const flush = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    save();
  };
  const changed = (next: { title?: string; md?: string }) => {
    latest.current = { ...latest.current, ...next };
    if (next.title !== undefined) setTitle(next.title);
    if (next.md !== undefined) setMd(next.md);
    setStatus('waiting');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      save();
    }, SAVE_DELAY_MS);
  };

  // Leaving the note, or the app going to the background, saves what's waiting.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flushRef.current();
    });
    return () => {
      subscription.remove();
      flushRef.current();
    };
  }, []);

  // Changes from the web or another device, newer than what this phone has (so its own saves pass):
  // taken in when nothing typed here is waiting; otherwise you choose.
  const takeIn = (remote: { updatedAt: number; title?: string; md?: string }) => {
    if (remote.updatedAt <= server.current.updatedAt) return;
    const ours = sending.current;
    if (ours && (ours.md === undefined || remote.md === ours.md) && (ours.title === undefined || remote.title === undefined || remote.title.trim() === ours.title.trim() || remote.title === 'Untitled')) return;
    const typedText = latest.current.md !== server.current.md;
    const typedTitle = latest.current.title !== server.current.title;
    server.current = { ...server.current, updatedAt: remote.updatedAt };
    if (remote.md !== undefined && remote.md !== server.current.md) {
      if (!typedText) {
        server.current = { ...server.current, md: remote.md };
        latest.current = { ...latest.current, md: remote.md };
        setMd(remote.md);
      } else if (remote.md !== latest.current.md) setElsewhere({ id: first.id, md: remote.md, updatedAt: remote.updatedAt });
    }
    if (remote.title !== undefined && remote.title !== server.current.title && !typedTitle) {
      server.current = { ...server.current, title: remote.title };
      latest.current = { ...latest.current, title: remote.title };
      setTitle(remote.title);
    }
  };
  const takeInRef = useRef(takeIn);
  useEffect(() => {
    takeInRef.current = takeIn;
  });
  useEffect(
    () =>
      watchNote(first.id, (raw) => {
        const change = noteChangeOf(raw);
        if (change) takeInRef.current(change);
      }),
    [first.id, watchNote],
  );
  useEffect(() => {
    const check = () => {
      if (AppState.currentState === 'active') void getNote(client, first.id).then((latestNote) => takeInRef.current(latestNote), () => undefined);
    };
    const every = setInterval(check, CHECK_EVERY_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      clearInterval(every);
      subscription.remove();
    };
  }, [client, first.id]);

  const useTheirs = () => {
    if (elsewhere?.md === undefined) return setElsewhere(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    server.current = { ...server.current, md: elsewhere.md };
    latest.current = { ...latest.current, md: elsewhere.md };
    setMd(elsewhere.md);
    setStatus(latest.current.title === server.current.title ? 'saved' : 'waiting');
    setElsewhere(null);
  };
  const keepMine = () => {
    // Saving next puts this text in place of theirs.
    if (elsewhere?.md !== undefined) server.current = { ...server.current, md: elsewhere.md };
    setElsewhere(null);
    changed({ md: latest.current.md });
  };

  const format = (kind: NoteFormat) => {
    const edit = applyFormat(md, selection, kind);
    setSelection(edit.selection);
    setForced(edit.selection);
    changed({ md: edit.text });
  };
  const tick = (index: number) => changed({ md: toggleTask(latest.current.md, index) });

  const statusText = { saved: 'Saved', waiting: 'Not saved yet', saving: 'Saving…', failed: 'Couldn’t save' }[status];
  const facts = [canWrite ? statusText : '', `${counts.words.toLocaleString()} word${counts.words === 1 ? '' : 's'}`, `${counts.characters.toLocaleString()} character${counts.characters === 1 ? '' : 's'}`, first.createdAt ? `created ${noteWhen(first.createdAt, now)}` : ''].filter(Boolean);
  const readOnlyNote = !first.writeAccess
    ? 'Shared with you to read.'
    : !keepsSharing
      ? 'Read only here: saving it would take away sharing your account may not give. Change it on the web.'
      : !hasMarkdown
        ? 'Read only here: this note has no Markdown copy to write in. Change it on the web.'
        : !onePage
          ? `Read only here: this note has ${first.pageCount} pages, written one at a time on the web. Here they show together.`
          : '';

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: palette.background }]}>
      <BackHeader title={noteTitle({ title })} fallback="/notes" menu={actions.items(note, note.writeAccess, () => router.back())} />
      <View style={styles.top}>
        <TextInput
          value={title}
          onChangeText={(next) => changed({ title: next })}
          editable={canRename}
          placeholder="Title"
          placeholderTextColor={palette.textFaint}
          accessibilityLabel="Title"
          returnKeyType="done"
          style={[styles.title, { color: palette.text }]}
        />
        <Text style={[styles.facts, { color: status === 'failed' ? palette.danger : palette.textFaint }]} numberOfLines={1}>
          {facts.join(' · ')}
        </Text>
        {readOnlyNote ? <Text style={[styles.note, { color: palette.textMuted }]}>{readOnlyNote}</Text> : null}
        {canWrite ? (
          <View style={styles.modes}>
            <Chip label="Write" on={mode === 'write'} onPress={() => setMode('write')} />
            <Chip label="Preview" on={mode === 'preview'} onPress={() => setMode('preview')} />
          </View>
        ) : null}
        {elsewhere ? (
          <View style={[styles.elsewhere, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Text style={[styles.note, styles.flex, { color: palette.text }]}>It changed on the web or another device while you were writing.</Text>
            <Pressable accessibilityRole="button" onPress={useTheirs} hitSlop={6}>
              <Text style={[styles.action, { color: palette.link }]}>Use Theirs</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={keepMine} hitSlop={6}>
              <Text style={[styles.action, { color: palette.link }]}>Keep Mine</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {canWrite && mode === 'write' ? (
        <>
          <TextInput
            value={md}
            onChangeText={(next) => changed({ md: next })}
            onSelectionChange={(event) => {
              setSelection(event.nativeEvent.selection);
              if (forced) setForced(undefined);
            }}
            selection={forced}
            multiline
            autoFocus={fresh}
            textAlignVertical="top"
            placeholder="Write something…"
            placeholderTextColor={palette.textFaint}
            accessibilityLabel="Note"
            style={[styles.body, { color: palette.text }]}
          />
          <SideScroll keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} style={[styles.bar, { borderTopColor: palette.border, marginBottom: keyboardShown ? 0 : insets.bottom }]} contentContainerStyle={styles.barContent}>
            {FORMATS.map((item) => (
              <IconButton key={item.format} icon={item.icon} label={item.label} size={20} color={palette.text} onPress={() => format(item.format)} />
            ))}
          </SideScroll>
        </>
      ) : (
        <ScrollView contentContainerStyle={[styles.preview, { paddingBottom: insets.bottom + 32 }]}>
          {md.trim() ? (
            <Markdown text={md} baseUrl={session.baseUrl} token={session.token} onToggleTask={canWrite ? tick : undefined} />
          ) : (
            <Text style={[styles.note, { color: palette.textFaint }]}>{canWrite ? 'Nothing written yet. Tap Write to start.' : 'Nothing written yet.'}</Text>
          )}
        </ScrollView>
      )}
      {actions.element}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  top: { paddingHorizontal: 16, gap: 6, paddingBottom: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 22, paddingVertical: 4 },
  facts: { fontFamily: fonts.regular, fontSize: 12 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  modes: { flexDirection: 'row', gap: 8, marginTop: 4 },
  elsewhere: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  flex: { flex: 1 },
  action: { fontFamily: fonts.semibold, fontSize: 14 },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, fontFamily: fonts.mono, fontSize: 15, lineHeight: 22 },
  bar: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth },
  barContent: { paddingHorizontal: 8, paddingVertical: 4, gap: 2, alignItems: 'center' },
  preview: { paddingHorizontal: 16, paddingTop: 4 },
});
