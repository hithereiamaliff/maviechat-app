import { addFileToKnowledge, fetchUrl, getFileText, textFileName, updateFileText, urlFileName, urlsFromText, type KnowledgeFile } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { openServerFile } from '@/lib/openServerFile';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import { editorStyles as styles, Field, plural, SheetHeader, SheetLoading } from './EditorParts';
import type { UploadSource } from './knowledgeUploads';
import { useKnowledgeFiles } from './queries';

/** The way down to a folder, from the top: tap a step to go back up to it. */
export function FolderPath({ path, onOpen }: { path: { id: string; name: string }[]; onOpen: (folderId: string | null) => void }) {
  const palette = usePalette();
  const steps = [{ id: '', name: 'All files' }, ...path];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={local.path}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <View key={step.id || 'top'} style={local.pathStep}>
            {index ? <Icon name="chevron-right" size={12} color={palette.textFaint} /> : null}
            <Pressable accessibilityRole="button" disabled={last} onPress={() => onOpen(step.id || null)} hitSlop={6}>
              <Text style={[local.pathText, { color: last ? palette.text : palette.link }]} numberOfLines={1}>
                {step.name}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

/** Where to move a file or folder: browse the collection's folders and move it to the one open. */
export function FolderPicker({ kbId, target, onClose, onPick }: { kbId: string; target: { title: string; from: string | null; exclude?: string } | null; onClose: () => void; onPick: (folderId: string | null) => void }) {
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target ? <Picker kbId={kbId} target={target} onClose={onClose} onPick={onPick} /> : null}
    </Modal>
  );
}

function Picker({ kbId, target, onClose, onPick }: { kbId: string; target: { title: string; from: string | null; exclude?: string }; onClose: () => void; onPick: (folderId: string | null) => void }) {
  const palette = usePalette();
  const [at, setAt] = useState<string | null>(null);
  const listing = useKnowledgeFiles(kbId, { folderId: at, orderBy: 'name', direction: 'asc' });
  const first = listing.data?.pages[0];
  const folders = (first?.folders ?? []).filter((folder) => folder.id !== target.exclude);
  const here = at === target.from;
  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
          {target.title}
        </Text>
        <Pressable accessibilityRole="button" disabled={here} onPress={() => onPick(at)} hitSlop={10}>
          <Text style={[styles.action, styles.strong, { color: here ? palette.textFaint : palette.link }]}>Move Here</Text>
        </Pressable>
      </View>
      <View style={local.pad}>
        <FolderPath path={first?.path ?? []} onOpen={setAt} />
        {here ? <Text style={[styles.note, { color: palette.textMuted }]}>It’s here now: open another folder.</Text> : null}
      </View>
      <ScrollView contentContainerStyle={local.list}>
        {listing.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {listing.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load the folders: ${describeError(listing.error)}`}</Text> : null}
        {listing.data && !folders.length ? <Text style={[styles.note, { color: palette.textFaint }]}>No folders in here.</Text> : null}
        {folders.map((folder) => (
          <Pressable key={folder.id} accessibilityRole="button" onPress={() => setAt(folder.id)} style={({ pressed }) => [local.row, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <Icon name="folder" size={18} color={palette.textMuted} />
            <Text style={[styles.label, styles.flex, { color: palette.text }]} numberOfLines={1}>
              {folder.name}
            </Text>
            <Icon name="chevron-right" size={14} color={palette.textFaint} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** A file's text as the server read it (what's searched); writers can correct it, and it's read again. */
export function KnowledgeFileSheet({ file, writable, onClose }: { file: KnowledgeFile | null; writable: boolean; onClose: () => void }) {
  return (
    <Modal visible={file !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {file ? <FileText file={file} writable={writable} onClose={onClose} /> : null}
    </Modal>
  );
}

function FileText({ file, writable, onClose }: { file: KnowledgeFile; writable: boolean; onClose: () => void }) {
  const { client } = useAuthed();
  const read = useQuery({ queryKey: ['workspace', 'file-text', file.id], queryFn: () => getFileText(client, file.id), staleTime: 0 });
  if (!(read.data && read.isFetchedAfterMount)) return <SheetLoading error={read.isError ? read.error : null} onClose={onClose} />;
  return <FileTextForm file={file} saved={read.data.content} status={read.data.status} error={read.data.error} writable={writable} onClose={onClose} />;
}

function FileTextForm({ file, saved, status, error, writable, onClose }: { file: KnowledgeFile; saved: string; status: string; error: string; writable: boolean; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useAuthed();
  const [content, setContent] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const save = async () => {
    if (content === saved) return onClose();
    setBusy(true);
    setProblem('');
    try {
      await updateFileText(client, file.id, content);
      toast('Saved: it’s read into its collections again');
      onClose();
    } catch (failure) {
      setProblem(describeError(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={file.name} onCancel={onClose} onSave={() => void save()} canSave={content.trim().length > 0} busy={busy} readOnly={!writable} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {problem ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{problem}</Text> : null}
        {status === 'failed' ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{`The server couldn’t read it: ${error || 'no reason given'}`}</Text> : null}
        <Pressable accessibilityRole="button" onPress={() => void openServerFile(session, file.id, file.name).catch((failure: unknown) => toast(`Couldn’t open it: ${describeError(failure)}`, 'error'))} style={local.link}>
          <Icon name="arrow-top-right-on-square" size={14} color={palette.link} />
          <Text style={[styles.label, { color: palette.link }]}>Open the Original</Text>
        </Pressable>
        <Field label="Text as read" note={writable ? 'What models search. Changing it reads it into every collection that has it again.' : 'What models search.'}>
          <TextInput value={content} onChangeText={setContent} editable={writable} multiline accessibilityLabel="Text as read" style={[styles.input, styles.body, local.text, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        </Field>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Web pages to add: the server fetches each address (a page's text, a YouTube video's captions,
 * or a file); pages come in as text files named after the address, files as they are.
 */
export function AddPagesSheet({ kbId, folderId, visible, onClose, send, onAdded }: { kbId: string; folderId: string | null; visible: boolean; onClose: () => void; send: (sources: UploadSource[]) => Promise<void>; onAdded: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <AddPages kbId={kbId} folderId={folderId} onClose={onClose} send={send} onAdded={onAdded} /> : null}
    </Modal>
  );
}

function AddPages({ kbId, folderId, onClose, send, onAdded }: { kbId: string; folderId: string | null; onClose: () => void; send: (sources: UploadSource[]) => Promise<void>; onAdded: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const [input, setInput] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const { urls, refused } = urlsFromText(input);
  const add = async () => {
    if (!urls.length) return setProblem('Add a web address (http or https) on each line.');
    setProblem('');
    const failed: string[] = [];
    const pages: UploadSource[] = [];
    let files = 0;
    for (const [index, url] of urls.entries()) {
      setProgress(`Fetching ${index + 1} of ${urls.length}…`);
      try {
        const fetched = await fetchUrl(client, url);
        if (fetched.kind === 'page') pages.push({ name: urlFileName(url), text: fetched.content, sourceUrl: url, folderId });
        else {
          await addFileToKnowledge(client, kbId, fetched.fileId, folderId);
          files += 1;
        }
      } catch (error) {
        failed.push(`${url}: ${describeError(error)}`);
      }
    }
    setProgress(null);
    if (files) onAdded();
    if (pages.length) void send(pages);
    if (failed.length) {
      setProblem(`${failed.length === urls.length ? 'None' : `${plural(urls.length - failed.length, 'address', 'addresses')} added; ${failed.length}`} couldn’t be fetched:\n${failed.join('\n')}`);
      setInput(failed.map((line) => line.slice(0, line.indexOf(': '))).join('\n'));
      return;
    }
    toast(urls.length === 1 ? 'Added: the server is reading it' : `Added ${urls.length}: the server is reading them`);
    onClose();
  };
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title="Add Web Pages" onCancel={onClose} onSave={() => void add()} canSave={urls.length > 0 && progress === null} busy={progress !== null} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {problem ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{problem}</Text> : null}
        {progress ? <Text style={[styles.note, { color: palette.textMuted }]}>{progress}</Text> : null}
        <Field label="Web addresses" note={refused.length ? `Not web addresses, left out: ${refused.join(', ')}` : 'One a line. The server fetches each page and reads its text in.'} problem={refused.length > 0}>
          <TextInput value={input} onChangeText={setInput} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} keyboardType="url" placeholder={'https://example.com/guide\nhttps://example.com/faq'} placeholderTextColor={palette.textFaint} accessibilityLabel="Web addresses" style={[styles.input, styles.body, local.urls, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        </Field>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Text typed or pasted in, added as a text file with the name given. */
export function AddTextSheet({ folderId, visible, onClose, send }: { folderId: string | null; visible: boolean; onClose: () => void; send: (sources: UploadSource[]) => Promise<void> }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <AddText folderId={folderId} onClose={onClose} send={send} /> : null}
    </Modal>
  );
}

function AddText({ folderId, onClose, send }: { folderId: string | null; onClose: () => void; send: (sources: UploadSource[]) => Promise<void> }) {
  const palette = usePalette();
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const ready = Boolean(name.trim() && body.trim());
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader
        title="Add Text"
        onCancel={onClose}
        onSave={() => {
          void send([{ name: textFileName(name), text: body, folderId }]);
          onClose();
        }}
        canSave={ready}
        busy={false}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label="Name" note={name.trim() ? `Saved as ${textFileName(name)}` : null}>
          <TextInput value={name} onChangeText={setName} placeholder="Meeting notes" placeholderTextColor={palette.textFaint} accessibilityLabel="Name" style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        </Field>
        <Field label="Text">
          <TextInput value={body} onChangeText={setBody} multiline placeholder="Paste or type the text" placeholderTextColor={palette.textFaint} accessibilityLabel="Text" style={[styles.input, styles.body, local.text, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        </Field>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const local = StyleSheet.create({
  pad: { paddingHorizontal: 16, paddingBottom: 8, gap: 6 },
  list: { padding: 16, gap: 8, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  path: { alignItems: 'center', gap: 4 },
  pathStep: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pathText: { fontFamily: fonts.medium, fontSize: 13, maxWidth: 180 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  text: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, minHeight: 320 },
  urls: { minHeight: 140 },
});
