import { noteHtml } from '@maviechat/owui-markdown';
import {
  attachmentLink,
  attachmentsIn,
  changeNotePages,
  defaultModelIds,
  getNote,
  getNoteChat,
  hasHeldPictures,
  isAtLeast,
  noteChangeOf,
  noteFilesOf,
  noteTitle,
  pageLink,
  pictureLink,
  saveKeepsSharing,
  saveNoteNow,
  suggestNoteTitle,
  withNoteFile,
  withoutAttachment,
  withoutNoteFile,
  type Capabilities,
  type Note,
  type NoteChange,
  type NoteFile,
  type NotePage,
  type PageOperation,
} from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackHeader } from '@/components/BackHeader';
import { showActionSheet } from '@/components/dialogs';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import type { MenuItem } from '@/components/Menu';
import { SideScroll } from '@/components/SideScroll';
import { useToast } from '@/components/Toast';
import { useLive } from '@/features/live/LiveProvider';
import { applyFormat, insertBlock, noteCounts, toggleTask, type NoteFormat, type Selection } from '@/features/notes/formatting';
import { emptyHistory, redo, remember, undo } from '@/features/notes/history';
import { NoteAttachments } from '@/features/notes/NoteAttachments';
import { onInsertIntoNote, setNoteSelection } from '@/features/notes/noteChatLink';
import { noteWhen } from '@/features/notes/noteText';
import { pageName, PagesSheet } from '@/features/notes/PagesSheet';
import { useNote } from '@/features/notes/queries';
import { useNoteActions } from '@/features/notes/useNoteActions';
import { useNoteFiles, type NoteFileSource, type UploadedNoteFile } from '@/features/notes/useNoteFiles';
import { Chip } from '@/features/workspace/ListControls';
import { describeError } from '@/lib/errors';
import { openServerFile } from '@/lib/openServerFile';
import { useAuthed, useCapabilities, useModels, useServerConfig, useUserSettings } from '@/lib/server';
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

const ADD: { source: NoteFileSource; label: string; icon: IconName }[] = [
  { source: 'files', label: 'Add Files…', icon: 'paper-clip' },
  { source: 'photos', label: 'Add Photos…', icon: 'photo' },
  { source: 'camera', label: 'Take Photo…', icon: 'camera' },
  { source: 'audio', label: 'Add a Recording…', icon: 'musical-note' },
];

/** Changes wait this long after the last keystroke, then save. */
const SAVE_DELAY_MS = 800;
/**
 * How often an open note is read again. Typing on the web is saved over the web's live editing
 * link, which sends no note event; renames and other saves do (those come at once).
 */
const CHECK_EVERY_MS = 5000;
const FILE_LINK = /^\/api\/v1\/files\/([\w-]+)\/content$/;

const clock = () => Date.now();
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const writtenIn = (md: string, html: string) => Boolean(md) || !html.replace(/<[^>]*>/g, '').trim();

/** 0.12: the note's pages, or its text as the one page a note had before pages. */
const pagesOfNote = (note: Note): NotePage[] =>
  note.pages.length ? note.pages : [{ id: 'main', parentId: null, title: note.title, md: note.md, html: note.html, depth: 0, inheritsTitle: true }];

/** The text the editor shows: the page's on 0.12, the note's on 0.11. */
function textOf(note: Note, pageId: string | null): { md: string; html: string } {
  const page = pageId ? pagesOfNote(note).find((item) => item.id === pageId) : undefined;
  return page ?? { md: note.md, html: note.html };
}

/** A note read again, as a change to take in (the same shape as a note event). */
function changeOf(note: Note, pageId: string | null): NoteChange {
  const text = pageId ? pagesOfNote(note).find((item) => item.id === pageId) : { md: note.md, html: note.html };
  return { id: note.id, updatedAt: note.updatedAt, title: note.title, md: text?.md, html: text?.html, files: list(note.data.files), pages: note.pages.length ? note.pages : undefined, pagesRevision: note.pagesRevision };
}

/** A note, as the web's note page: its title, the text (written here as Markdown, or read formatted), saved as you go. */
export default function NoteScreen() {
  const palette = usePalette();
  const { id, new: fresh, page } = useLocalSearchParams<{ id: string; new?: string; page?: string }>();
  const note = useNote(id ?? '');
  const capabilities = useCapabilities();
  if (!note.data || !capabilities) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <BackHeader title="Note" fallback="/notes" />
        <View style={styles.center}>{note.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t open the note: ${describeError(note.error)}`}</Text> : <ActivityIndicator color={palette.textMuted} />}</View>
      </View>
    );
  }
  return <NoteEditor key={note.data.id} note={note.data} capabilities={capabilities} fresh={fresh === '1'} startPage={page} />;
}

function NoteEditor({ note, capabilities, fresh, startPage }: { note: Note; capabilities: Capabilities; fresh: boolean; startPage?: string }) {
  const palette = usePalette();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { client, session } = useAuthed();
  const { watchNote } = useLive();
  const queryClient = useQueryClient();
  const actions = useNoteActions();
  const noteFiles = useNoteFiles();
  const models = useModels();
  const settings = useUserSettings();
  const config = useServerConfig();
  const keyboardShown = useKeyboardState((state) => state.isVisible);
  // After a save, the lists (and pinned notes, by title) read again; this note is checked on its own.
  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['notes', 'list'] });
    void queryClient.invalidateQueries({ queryKey: ['notes', 'pinned'] });
  };
  // 0.12 keeps a note's text in pages, written one at a time; 0.11 has one text and a file list.
  const pagesOn = isAtLeast(capabilities.version, '0.12.0');
  // The first copy read: the text and title start from it (later reads only update the menu).
  const [first] = useState(note);
  const [pageId, setPageId] = useState<string | null>(() => (pagesOn ? (startPage && pagesOfNote(first).some((page) => page.id === startPage) ? startPage : 'main') : null));
  const [pages, setPages] = useState<NotePage[]>(() => (pagesOn ? pagesOfNote(first) : []));
  // The text as read for the page shown: whether it can be written here is decided from it.
  const [loaded, setLoaded] = useState(() => textOf(first, pageId));
  const keepsSharing = saveKeepsSharing(first.accessGrants, capabilities);
  // A note the web wrote without a Markdown copy can't be written here without losing its text.
  const hasMarkdown = writtenIn(loaded.md, loaded.html);
  // Pictures the web holds inside the text don't survive the web's editor reading a phone's save.
  const heldPictures = hasHeldPictures(loaded.md, loaded.html);
  const canWrite = first.writeAccess && keepsSharing && hasMarkdown && !heldPictures;
  // As on the web, only the owner (or an admin) renames a note.
  const canRename = canWrite && (capabilities.isAdmin || first.ownerId === session.user.id);
  const [title, setTitle] = useState(first.title);
  const [md, setMd] = useState(loaded.md);
  const [mode, setMode] = useState<'write' | 'preview'>(canWrite && (fresh || !loaded.md.trim()) ? 'write' : 'preview');
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [forced, setForced] = useState<Selection | undefined>(undefined);
  const [status, setStatus] = useState<'saved' | 'waiting' | 'saving' | 'failed'>('saved');
  const [elsewhere, setElsewhere] = useState<NoteChange | null>(null);
  const [history, setHistory] = useState(emptyHistory);
  const [attached, setAttached] = useState<NoteFile[]>(() => noteFilesOf(first.data.files));
  const [pagesOpen, setPagesOpen] = useState(false);
  const [busy, setBusy] = useState<'' | 'pages' | 'chat' | 'title'>('');
  const [now] = useState(() => new Date().getTime());
  const counts = noteCounts(md);
  // 0.12 attaches files in the text; 0.11 keeps a list.
  const files = pagesOn ? attachmentsIn(md) : attached;
  const page = pages.find((item) => item.id === pageId);

  // What the server has (as read or last saved, with when it was saved) and what's typed here.
  const server = useRef({ title: first.title, md: loaded.md, updatedAt: first.updatedAt });
  const latest = useRef({ title: first.title, md: loaded.md });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  // What a save under way is sending: its echo can come back before the save has answered.
  const sending = useRef<{ title?: string; md?: string } | null>(null);
  const pageRef = useRef(pageId);
  const revision = useRef(first.pagesRevision);
  const rawFiles = useRef<unknown[]>(list(first.data.files));
  const selectionRef = useRef<Selection>({ start: 0, end: 0 });
  const modeRef = useRef(mode);

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
        const saved = await saveNoteNow(client, first.id, {
          ...(titleChanged ? { title: nextTitle } : {}),
          ...(textChanged ? { md: nextMd, html: noteHtml(nextMd), ...(pageRef.current ? { pageId: pageRef.current } : {}) } : {}),
        });
        server.current = { title: titleChanged ? saved.title : server.current.title, md: textChanged ? nextMd : server.current.md, updatedAt: Math.max(server.current.updatedAt, saved.updatedAt) };
        if (pagesOn && saved.pages.length) {
          setPages(saved.pages);
          revision.current = saved.pagesRevision;
        }
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
  /** A change typed or made here: `typing` joins a burst of keystrokes into one Undo step, `edit` is a step of its own. */
  const changed = (next: { title?: string; md?: string }, step?: 'typing' | 'edit') => {
    if (step && next.md !== undefined && next.md !== latest.current.md) {
      const before = latest.current.md;
      setHistory((current) => remember(current, before, clock(), step === 'typing'));
    }
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

  // 0.11's file list is saved on its own (as the web does), after any save already on its way.
  const saveFiles = (change: (current: unknown[]) => unknown[]) => {
    rawFiles.current = change(rawFiles.current);
    setAttached(noteFilesOf(rawFiles.current));
    chain.current = chain.current.then(async () => {
      try {
        const saved = await saveNoteNow(client, first.id, { files: change });
        rawFiles.current = list(saved.data.files);
        setAttached(noteFilesOf(rawFiles.current));
        server.current = { ...server.current, updatedAt: Math.max(server.current.updatedAt, saved.updatedAt) };
        refreshLists();
      } catch (error) {
        toast(`Couldn’t save the note’s files: ${describeError(error)}`, 'error');
      }
    });
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

  /** Shows a page (0.12): what's typed on the one before is saved first. */
  const showPage = (target: NotePage) => {
    pageRef.current = target.id;
    setPageId(target.id);
    server.current = { ...server.current, md: target.md };
    latest.current = { ...latest.current, md: target.md };
    selectionRef.current = { start: 0, end: 0 };
    setSelection({ start: 0, end: 0 });
    setMd(target.md);
    setLoaded({ md: target.md, html: target.html });
    setHistory(emptyHistory());
    setElsewhere(null);
    setStatus(latest.current.title === server.current.title ? 'saved' : 'waiting');
  };
  const openPage = async (id: string) => {
    if (id === pageRef.current || busy) return;
    setBusy('pages');
    try {
      flush();
      await chain.current;
      // The page as it is now (another device may have written in it since the list was read).
      const fresh = await getNote(client, first.id).catch(() => null);
      const all = fresh ? pagesOfNote(fresh) : pages;
      if (fresh) {
        setPages(all);
        revision.current = fresh.pagesRevision;
        server.current = { ...server.current, updatedAt: Math.max(server.current.updatedAt, fresh.updatedAt) };
      }
      const target = all.find((item) => item.id === id);
      if (target) showPage(target);
      else toast('That page isn’t there any more.', 'error');
    } finally {
      setBusy('');
    }
  };
  const changePages = async (operation: PageOperation) => {
    if (busy) return;
    setBusy('pages');
    try {
      flush();
      await chain.current;
      const result = await changeNotePages(client, { id: first.id, pagesRevision: revision.current, writeAccess: first.writeAccess }, operation);
      const all = pagesOfNote(result.note);
      revision.current = result.note.pagesRevision;
      server.current = { ...server.current, updatedAt: Math.max(server.current.updatedAt, result.note.updatedAt) };
      setPages(all);
      const target = all.find((item) => item.id === (result.pageId ?? pageRef.current)) ?? all[0];
      if (target && target.id !== pageRef.current) showPage(target);
      refreshLists();
    } catch (error) {
      toast(`Couldn’t change the pages: ${describeError(error)}`, 'error');
      // Read them again: another device may have changed them first.
      void getNote(client, first.id).then((fresh) => {
        setPages(pagesOfNote(fresh));
        revision.current = fresh.pagesRevision;
      }, () => undefined);
    } finally {
      setBusy('');
    }
  };

  // Changes from the web, another device or the note's chat, newer than what this phone has (so
  // its own saves pass): taken in when nothing typed here is waiting; otherwise you choose.
  const takeIn = (remote: NoteChange) => {
    if (remote.updatedAt <= server.current.updatedAt) return;
    const ours = sending.current;
    if (ours && (ours.md === undefined || remote.md === ours.md) && (ours.title === undefined || remote.title === undefined || remote.title.trim() === ours.title.trim() || remote.title === 'Untitled')) return;
    const typedText = latest.current.md !== server.current.md;
    const typedTitle = latest.current.title !== server.current.title;
    server.current = { ...server.current, updatedAt: remote.updatedAt };
    if (remote.pages) {
      setPages(remote.pages);
      if (remote.pagesRevision !== undefined) revision.current = remote.pagesRevision;
      const gone = pageRef.current !== null && !remote.pages.some((item) => item.id === pageRef.current);
      const main = remote.pages[0];
      if (gone && main) {
        toast('The page you were on was deleted elsewhere.');
        showPage(main);
        return;
      }
    }
    if (!pagesOn && remote.files) {
      rawFiles.current = remote.files;
      setAttached(noteFilesOf(remote.files));
    }
    if (remote.md !== undefined && remote.md !== server.current.md) {
      if (!typedText) {
        const before = latest.current.md;
        setHistory((current) => remember(current, before, clock(), false));
        server.current = { ...server.current, md: remote.md };
        latest.current = { ...latest.current, md: remote.md };
        setMd(remote.md);
        setLoaded({ md: remote.md, html: remote.html ?? '' });
      } else if (remote.md !== latest.current.md) setElsewhere({ id: first.id, md: remote.md, html: remote.html, updatedAt: remote.updatedAt });
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
        const change = noteChangeOf(raw, pageRef.current);
        if (change) takeInRef.current(change);
      }),
    [first.id, watchNote],
  );
  useEffect(() => {
    const check = () => {
      if (AppState.currentState === 'active') void getNote(client, first.id).then((latestNote) => takeInRef.current(changeOf(latestNote, pageRef.current)), () => undefined);
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
    const before = latest.current.md;
    setHistory((current) => remember(current, before, clock(), false));
    server.current = { ...server.current, md: elsewhere.md };
    latest.current = { ...latest.current, md: elsewhere.md };
    setMd(elsewhere.md);
    setLoaded({ md: elsewhere.md, html: elsewhere.html ?? '' });
    setStatus(latest.current.title === server.current.title ? 'saved' : 'waiting');
    setElsewhere(null);
  };
  const keepMine = () => {
    // Saving next puts this text in place of theirs.
    if (elsewhere?.md !== undefined) server.current = { ...server.current, md: elsewhere.md };
    setElsewhere(null);
    changed({ md: latest.current.md });
  };

  const switchMode = (next: 'write' | 'preview') => {
    modeRef.current = next;
    setMode(next);
  };
  const format = (kind: NoteFormat) => {
    const edit = applyFormat(md, selection, kind);
    selectionRef.current = edit.selection;
    setSelection(edit.selection);
    setForced(edit.selection);
    changed({ md: edit.text }, 'edit');
  };
  const tick = (index: number) => changed({ md: toggleTask(latest.current.md, index) }, 'edit');
  const step = (direction: 'undo' | 'redo') => {
    const result = direction === 'undo' ? undo(history, latest.current.md) : redo(history, latest.current.md);
    if (!result) return;
    setHistory(result.history);
    changed({ md: result.text });
  };
  /** Text on lines of its own: after the line you're writing on, or at the end when reading. */
  const insert = (block: string) => {
    if (!block.trim()) return;
    const writing = modeRef.current === 'write';
    const edit = insertBlock(latest.current.md, writing ? selectionRef.current.end : latest.current.md.length, block.trim());
    selectionRef.current = edit.selection;
    if (writing) {
      setSelection(edit.selection);
      setForced(edit.selection);
    }
    changed({ md: edit.text }, 'edit');
  };
  // Replies inserted from the note's chat come here while the note is open.
  const insertRef = useRef(insert);
  useEffect(() => {
    insertRef.current = insert;
  });
  useEffect(() => (canWrite ? onInsertIntoNote(first.id, (markdown) => insertRef.current(markdown)) : undefined), [canWrite, first.id]);

  // A picture goes in the text; any other file is attached (0.11's list, 0.12's text).
  const attach = (file: UploadedNoteFile) => {
    const link = { id: file.entry.id, name: file.entry.name };
    if (file.picture) insertRef.current(pictureLink(link));
    else if (pagesOn) insertRef.current(attachmentLink(link));
    else saveFiles((current) => withNoteFile(current, file.entry));
  };
  const addFiles = (source: NoteFileSource) => void noteFiles.add(source, attach);
  const askAdd = () =>
    showActionSheet({ title: 'Add to the Note', options: [...ADD.map((item) => item.label), 'Cancel'], cancelButtonIndex: ADD.length }, (index) => {
      const item = ADD[index];
      if (item) addFiles(item.source);
    });
  const removeFile = (file: NoteFile) => (pagesOn ? changed({ md: withoutAttachment(latest.current.md, file.id) }, 'edit') : saveFiles((current) => withoutNoteFile(current, file.id)));
  // Files attached in the text open on the phone (they need your sign-in), not in the browser.
  const openLink = (href: string, text: string) => {
    const id = FILE_LINK.exec(href)?.[1];
    if (!id) return false;
    void openServerFile(session, id, text || 'file').catch((error: unknown) => toast(`Couldn’t open it: ${describeError(error)}`, 'error'));
    return true;
  };

  // The note's chat: what's typed is saved first, so its model reads the note as it is here.
  const openChat = async (ask?: 'enhance') => {
    if (busy) return;
    setBusy('chat');
    try {
      flush();
      await chain.current;
      const range = selectionRef.current;
      setNoteSelection(first.id, modeRef.current === 'write' ? latest.current.md.slice(range.start, range.end) : '');
      const chat = await getNoteChat(client, first.id);
      router.push({ pathname: '/c/[id]', params: { id: chat.id, note: first.id, ...(ask ? { ask } : {}) } });
    } catch (error) {
      toast(`Couldn’t open the note’s chat: ${describeError(error)}`, 'error');
    } finally {
      setBusy('');
    }
  };
  // The web's Generate beside the title: your default model names the note from its text.
  const generateTitle = async () => {
    const model = defaultModelIds(models.data ?? [], settings.data, config.data)[0];
    if (!model) return toast('There’s no model to ask.', 'error');
    if (!latest.current.md.trim()) return toast('Write something first, then it can be named.');
    setBusy('title');
    try {
      changed({ title: await suggestNoteTitle(client, model, latest.current.md, first.id) });
    } catch (error) {
      toast(`Couldn’t make a title: ${describeError(error)}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const statusText = { saved: 'Saved', waiting: 'Not saved yet', saving: 'Saving…', failed: 'Couldn’t save' }[status];
  const facts = [canWrite ? statusText : '', `${counts.words.toLocaleString()} word${counts.words === 1 ? '' : 's'}`, `${counts.characters.toLocaleString()} character${counts.characters === 1 ? '' : 's'}`, first.createdAt ? `created ${noteWhen(first.createdAt, now)}` : ''].filter(Boolean);
  const readOnlyNote = !first.writeAccess
    ? 'Shared with you to read.'
    : !keepsSharing
      ? 'Read only here: saving it would take away sharing your account may not give. Change it on the web.'
      : !hasMarkdown
        ? 'Read only here: this note has no Markdown copy to write in. Change it on the web.'
        : heldPictures
          ? 'Read only here: pictures were pasted into its text on the web, and only the web’s editor keeps those. Change it on the web.'
          : '';
  const menu: MenuItem[] = [
    // The web's Enhance: the note's chat is asked to improve the note, and rewrites it.
    ...(canWrite ? [{ key: 'enhance', label: 'Enhance', icon: 'sparkles' as const, onPress: () => void openChat('enhance') }] : []),
    ...(canWrite ? ADD.map((item) => ({ key: item.source, label: item.label, icon: item.icon, onPress: () => addFiles(item.source) })) : []),
    ...actions.items(note, note.writeAccess, () => router.back()),
  ];
  const pageCount = pages.length;

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: palette.background }]}>
      <BackHeader
        title={noteTitle({ title })}
        fallback="/notes"
        menu={menu}
        accessory={busy === 'chat' ? <ActivityIndicator style={styles.spin} color={palette.textMuted} /> : <IconButton icon="chat-bubble-left-right" label="Chat about this note" onPress={() => void openChat()} />}
      />
      <View style={styles.top}>
        <View style={styles.titleRow}>
          <TextInput
            value={title}
            onChangeText={(next) => changed({ title: next })}
            editable={canRename && busy !== 'title'}
            placeholder={busy === 'title' ? 'Thinking of a title…' : 'Title'}
            placeholderTextColor={palette.textFaint}
            accessibilityLabel="Title"
            returnKeyType="done"
            style={[styles.title, { color: palette.text }]}
          />
          {canRename && md.trim() ? (
            busy === 'title' ? (
              <ActivityIndicator color={palette.textMuted} />
            ) : (
              <IconButton icon="sparkles" label="Generate a title from the text" size={18} color={palette.textMuted} onPress={() => void generateTitle()} />
            )
          ) : null}
        </View>
        <Text style={[styles.facts, { color: status === 'failed' ? palette.danger : palette.textFaint }]} numberOfLines={1}>
          {facts.join(' · ')}
        </Text>
        {readOnlyNote ? <Text style={[styles.note, { color: palette.textMuted }]}>{readOnlyNote}</Text> : null}
        {pagesOn && page ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Page: ${pageName(page, title)}, ${pageCount} in all`}
            accessibilityHint="Lists the note’s pages"
            onPress={() => setPagesOpen(true)}
            style={({ pressed }) => [styles.pageButton, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <Icon name="queue-list" size={16} color={palette.textMuted} />
            <Text style={[styles.pageName, { color: palette.text }]} numberOfLines={1}>
              {pageName(page, title)}
            </Text>
            <Text style={[styles.facts, { color: palette.textFaint }]}>{pageCount === 1 ? '1 page' : `${pageCount} pages`}</Text>
            {busy === 'pages' ? <ActivityIndicator size="small" color={palette.textMuted} /> : <Icon name="chevron-down" size={14} color={palette.textMuted} />}
          </Pressable>
        ) : null}
        {canWrite ? (
          <View style={styles.modes}>
            <Chip label="Write" on={mode === 'write'} onPress={() => switchMode('write')} />
            <Chip label="Preview" on={mode === 'preview'} onPress={() => switchMode('preview')} />
            <View style={styles.flex} />
            <IconButton icon="arrow-uturn-left" label="Undo" size={18} color={palette.text} disabled={!history.past.length} onPress={() => step('undo')} />
            <IconButton icon="arrow-uturn-right" label="Redo" size={18} color={palette.text} disabled={!history.future.length} onPress={() => step('redo')} />
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
      <NoteAttachments files={files} uploading={noteFiles.uploading} writable={canWrite} onRemove={removeFile} onInsert={insert} />
      {canWrite && mode === 'write' ? (
        <>
          <TextInput
            value={md}
            onChangeText={(next) => changed({ md: next }, 'typing')}
            onSelectionChange={(event) => {
              selectionRef.current = event.nativeEvent.selection;
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
            <IconButton icon="paper-clip" label="Add files, photos or a recording" size={20} color={palette.text} onPress={askAdd} />
            {FORMATS.map((item) => (
              <IconButton key={item.format} icon={item.icon} label={item.label} size={20} color={palette.text} onPress={() => format(item.format)} />
            ))}
          </SideScroll>
        </>
      ) : (
        <ScrollView contentContainerStyle={[styles.preview, { paddingBottom: insets.bottom + 32 }]}>
          {md.trim() ? (
            <Markdown text={md} baseUrl={session.baseUrl} token={session.token} onToggleTask={canWrite ? tick : undefined} onLink={openLink} />
          ) : (
            <Text style={[styles.note, { color: palette.textFaint }]}>{canWrite ? 'Nothing written yet. Tap Write to start.' : 'Nothing written yet.'}</Text>
          )}
        </ScrollView>
      )}
      {actions.element}
      {noteFiles.pictureElement}
      {pagesOn && page ? (
        <PagesSheet
          visible={pagesOpen}
          onClose={() => setPagesOpen(false)}
          pages={pages}
          activeId={page.id}
          noteTitle={title}
          writable={first.writeAccess}
          onOpen={(id) => void openPage(id)}
          onChange={(operation) => void changePages(operation)}
          onCopyLink={(id) => void Clipboard.setStringAsync(pageLink(session.baseUrl, first.id, id)).then(() => toast('Link copied'))}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  top: { paddingHorizontal: 16, gap: 6, paddingBottom: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 22, paddingVertical: 4 },
  facts: { fontFamily: fonts.regular, fontSize: 12 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  pageButton: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', maxWidth: '100%', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6, marginTop: 2 },
  pageName: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 14 },
  modes: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  elsewhere: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  flex: { flex: 1 },
  spin: { marginHorizontal: 10 },
  action: { fontFamily: fonts.semibold, fontSize: 14 },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, fontFamily: fonts.mono, fontSize: 15, lineHeight: 22 },
  bar: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth },
  barContent: { paddingHorizontal: 8, paddingVertical: 4, gap: 2, alignItems: 'center' },
  preview: { paddingHorizontal: 16, paddingTop: 4 },
});
