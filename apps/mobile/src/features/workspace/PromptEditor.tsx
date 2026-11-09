import {
  commandFromName,
  commandProblem,
  createWorkspacePrompt,
  deletePromptVersion,
  inputVariables,
  isAtLeast,
  makePromptVersionLive,
  saveWorkspacePromptVersion,
  updateWorkspacePromptMeta,
  type PromptVersion,
  type WorkspacePrompt,
} from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import { editorStyles as styles, Field, SheetHeader, SheetLoading, TagsField } from './EditorParts';
import { CompareLink } from '@/features/compare/CompareLink';
import { RevisionMergeSheet } from '@/features/compare/RevisionMergeSheet';
import { usePromptVersion, usePromptVersions, useWorkspacePrompt, useWorkspaceRefresh } from './queries';
import { VersionChanges } from './VersionChanges';

/** What the prompt sheet opens on: a new prompt, one to change (or read), or a copy of one. */
export type PromptEditorTarget = { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'clone'; id: string };

/** Names the web fills in by itself as a prompt goes in (`{{CLIPBOARD}}`, `{{USER_NAME}}`, `{{CURRENT_DATE}}`…). */
const BUILTIN = /^[A-Z_]+$/;

const when = (ms: number) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

/**
 * A Workspace prompt, as Open WebUI's prompt page has it: name, `/command` (from the name until
 * you change it), tags and text. Changed text saves as a new version (live, or kept aside), with
 * a note of what changed; name, command and tags alone change without one. Its versions: compare
 * one with the live one or the one before it, make an older one live again, copy one, or delete
 * one that isn't live.
 */
export function PromptEditor({ target, onClose }: { target: PromptEditorTarget | null; onClose: () => void }) {
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target ? <Loader target={target} onClose={onClose} /> : null}
    </Modal>
  );
}

function Loader({ target, onClose }: { target: PromptEditorTarget; onClose: () => void }) {
  const id = target.kind === 'new' ? null : target.id;
  const prompt = useWorkspacePrompt(id);
  // Opens on what the server has now: a copy cached from before waits for the fresh one.
  if (id && !(prompt.data && prompt.isFetchedAfterMount)) return <SheetLoading error={prompt.isError ? prompt.error : null} onClose={onClose} />;
  return <Form target={target} prompt={prompt.data ?? null} onClose={onClose} />;
}

function Form({ target, prompt, onClose }: { target: PromptEditorTarget; prompt: WorkspacePrompt | null; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const refresh = useWorkspaceRefresh();
  const capabilities = useCapabilities();
  // 0.11 wrote a not-live version's text into the prompt anyway; 0.12 keeps the live one.
  const oldServer = !isAtLeast(capabilities?.version, '0.12.0');
  const editing = target.kind === 'edit';
  const cloning = target.kind === 'clone';
  const readOnly = editing && prompt !== null && !prompt.writeAccess;
  // The server's copy while editing: what "changed" is measured from, and what versions belong to.
  const [saved, setSaved] = useState(editing ? prompt : null);
  const [name, setName] = useState(prompt ? (cloning ? `${prompt.name} (Clone)` : prompt.name) : '');
  const [command, setCommand] = useState(prompt ? (cloning ? `${prompt.command}-clone` : prompt.command) : '');
  const [commandTouched, setCommandTouched] = useState(target.kind !== 'new');
  const [tags, setTags] = useState<string[]>(prompt?.tags ?? []);
  const [content, setContent] = useState(prompt?.content ?? '');
  // The text when a comparison with a revision opened (null while none is open).
  const [comparing, setComparing] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const commandIssue = commandProblem(command.trim());
  const textChanged = saved !== null && content !== saved.content;
  const metaChanged = saved !== null && (name.trim() !== saved.name || command.trim() !== saved.command || tags.join('\n') !== saved.tags.join('\n'));
  const ready = !readOnly && Boolean(name.trim()) && !commandIssue && Boolean(content.trim());
  const variables = inputVariables(content);
  const asks = variables.filter((item) => !BUILTIN.test(item.name)).map((item) => item.name);
  const fills = variables.filter((item) => BUILTIN.test(item.name)).map((item) => item.name);

  const save = async () => {
    if (!ready) return setProblem(commandIssue ?? 'It needs a name, a command and some text.');
    if (saved && !textChanged && !metaChanged) return onClose();
    setBusy(true);
    setProblem('');
    try {
      const form = { name: name.trim(), command: command.trim(), tags };
      if (!saved) await createWorkspacePrompt(client, { ...form, content });
      else if (textChanged) await saveWorkspacePromptVersion(client, { ...saved, ...form }, { content, commitMessage: message, live });
      else await updateWorkspacePromptMeta(client, saved.id, form);
      refresh();
      toast(!saved ? 'Prompt made (private)' : textChanged && !live ? 'Saved as a version that isn’t live' : 'Prompt saved');
      onClose();
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const makeLive = (version: PromptVersion) => {
    if (!saved) return;
    const go = async () => {
      try {
        const next = await makePromptVersionLive(client, saved.id, version.id);
        setSaved(next);
        setName(next.name);
        setCommand(next.command);
        setTags(next.tags);
        setContent(next.content);
        setMessage('');
        refresh();
        toast('That version is live');
      } catch (error) {
        toast(`Couldn’t make it live: ${describeError(error)}`, 'error');
      }
    };
    if (textChanged || metaChanged) Alert.alert('Make that version live?', 'What you’ve changed here and not saved is dropped.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Make Live', onPress: () => void go() }]);
    else void go();
  };
  const removeVersion = (version: PromptVersion) => {
    if (!saved) return;
    Alert.alert('Delete this version?', 'It leaves the prompt’s history for good. The live version stays as it is.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deletePromptVersion(client, saved.id, version.id).then(
            () => {
              refresh();
              toast('Version deleted');
            },
            (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={editing ? (saved?.name ?? 'Prompt') : cloning ? 'Copy of a Prompt' : 'New Prompt'} onCancel={onClose} onSave={() => void save()} canSave={ready} busy={busy} readOnly={readOnly} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {readOnly ? <Text style={[styles.note, { color: palette.textMuted }]}>Shared with you to use: only its owner (or someone they let) can change it.</Text> : null}
        {problem ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{problem}</Text> : null}
        <Field label="Name">
          <TextInput
            value={name}
            onChangeText={(value) => {
              setName(value);
              if (!commandTouched) setCommand(commandFromName(value));
            }}
            editable={!readOnly}
            placeholder="Weekly summary"
            placeholderTextColor={palette.textFaint}
            accessibilityLabel="Name"
            style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
        </Field>
        <Field label="Command" note={command && commandIssue ? commandIssue : readOnly ? null : 'Type it after / in a chat. Every prompt on this server has its own.'} problem={Boolean(command && commandIssue)}>
          <View style={[styles.input, styles.row, local.command, { borderColor: command && commandIssue ? palette.danger : palette.border, backgroundColor: palette.surface }]}>
            <Text style={[styles.mono, { color: palette.textMuted }]}>/</Text>
            <TextInput
              value={command}
              onChangeText={(value) => {
                setCommandTouched(true);
                setCommand(value);
              }}
              editable={!readOnly}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              placeholder="weekly-summary"
              placeholderTextColor={palette.textFaint}
              accessibilityLabel="Command"
              style={[styles.mono, styles.flex, local.commandInput, { color: palette.text }]}
            />
          </View>
        </Field>
        <TagsField tags={tags} setTags={setTags} readOnly={readOnly} />
        <Field
          label="Text"
          note={[asks.length ? `Asks for: ${asks.join(', ')}.` : 'Write {{name}} where it should ask you for something.', fills.length ? `Fills in by itself: ${fills.join(', ')}.` : ''].filter(Boolean).join(' ')}>
          <TextInput
            value={content}
            onChangeText={setContent}
            editable={!readOnly}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            placeholder="Summarise {{topic}} in three lines for {{USER_NAME}}."
            placeholderTextColor={palette.textFaint}
            accessibilityLabel="Text"
            style={[styles.input, styles.body, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
        </Field>
        {readOnly ? null : <CompareLink onPress={() => setComparing(content)} />}
        <RevisionMergeSheet current={comparing} title="Compare the Text" onApply={setContent} onClose={() => setComparing(null)} />
        {textChanged ? (
          <View style={[local.box, { borderColor: palette.border }]}>
            <TextInput value={message} onChangeText={setMessage} placeholder="What changed (optional)" placeholderTextColor={palette.textFaint} accessibilityLabel="What changed" style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
            <View style={styles.row}>
              <Text style={[styles.label, styles.flex, { color: palette.text }]}>Make it the live version</Text>
              <Switch accessibilityLabel="Make it the live version" value={live} onValueChange={setLive} />
            </View>
            {!live ? (
              <Text style={[styles.note, { color: palette.textMuted }]}>
                {oldServer ? 'This Open WebUI version still puts the new text in when you type its command; only the live mark stays on the version before.' : 'The version before stays the one its command puts in; this one is kept aside.'}
              </Text>
            ) : null}
          </View>
        ) : null}
        <Text style={[styles.note, { color: palette.textFaint }]}>{saved ? 'Its sharing stays as it is.' : 'New prompts are private: only you (and admins) can use them.'}</Text>
        {saved ? <Versions prompt={saved} readOnly={readOnly} onMakeLive={makeLive} onDelete={removeVersion} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Every saved version, newest first: what changed, who, when, and which is live; open one to see
 * its text, or what differs between it and the live one or the one before it.
 */
function Versions({ prompt, readOnly, onMakeLive, onDelete }: { prompt: WorkspacePrompt; readOnly: boolean; onMakeLive: (version: PromptVersion) => void; onDelete: (version: PromptVersion) => void }) {
  const palette = usePalette();
  const toast = useToast();
  const versions = usePromptVersions(prompt.id);
  const [open, setOpen] = useState<string | null>(null);
  const [comparing, setComparing] = useState<'live' | 'previous' | null>(null);
  const items = versions.data?.pages.flat() ?? [];
  const listedLive = items.find((item) => item.id === prompt.versionId);
  // The live version is read on its own when it's older than the versions listed so far.
  const fetchedLive = usePromptVersion(prompt.id, comparing === 'live' && !listedLive ? prompt.versionId : null);
  const live = listedLive ?? fetchedLive.data;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.text }]}>Versions</Text>
      {versions.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {versions.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load them: ${describeError(versions.error)}`}</Text> : null}
      {versions.data && !items.length ? <Text style={[styles.note, { color: palette.textFaint }]}>None saved yet.</Text> : null}
      {items.map((version, index) => {
        const isLive = version.id === prompt.versionId;
        const shown = open === version.id;
        const previous = items[index + 1];
        const withLive = shown && comparing === 'live' && !isLive;
        const withPrevious = shown && comparing === 'previous' && previous !== undefined;
        return (
          <View key={version.id} style={[local.version, { borderColor: isLive ? palette.link : palette.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: shown }}
              onPress={() => {
                setOpen(shown ? null : version.id);
                setComparing(null);
              }}
              style={styles.row}>
              <View style={styles.flex}>
                <Text style={[styles.label, { color: palette.text }]} numberOfLines={1}>
                  {version.commitMessage || 'Saved'}
                </Text>
                <Text style={[styles.note, { color: palette.textMuted }]} numberOfLines={1}>
                  {[version.author, when(version.createdAt)].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {isLive ? <Text style={[local.live, { color: palette.link, borderColor: palette.link }]}>Live</Text> : null}
              <Icon name={shown ? 'chevron-up' : 'chevron-down'} size={14} color={palette.textMuted} />
            </Pressable>
            {shown ? (
              <>
                {withLive && live ? (
                  <VersionChanges before={version} after={live} caption="From this version to the live one: − only in this version, + only in the live one." />
                ) : withLive ? (
                  fetchedLive.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t load the live version: ${describeError(fetchedLive.error)}`}</Text> : <ActivityIndicator color={palette.textMuted} />
                ) : withPrevious ? (
                  <VersionChanges before={previous} after={version} caption="What this version changed from the one before it: − taken out, + put in." />
                ) : (
                  <Text selectable style={[styles.mono, local.text, { color: palette.text, backgroundColor: palette.surface }]}>
                    {version.content}
                  </Text>
                )}
                <View style={local.actions}>
                  {withLive || withPrevious ? <Action label="Show Text" onPress={() => setComparing(null)} /> : null}
                  {!isLive && prompt.versionId && !withLive ? <Action label="Compare with Live" onPress={() => setComparing('live')} /> : null}
                  {previous && !withPrevious ? <Action label="Compare with Previous" onPress={() => setComparing('previous')} /> : null}
                  {!isLive && !readOnly ? <Action label="Make Live" onPress={() => onMakeLive(version)} /> : null}
                  <Action label="Copy" onPress={() => void Clipboard.setStringAsync(version.content).then(() => toast('Copied'))} />
                  {!isLive && !readOnly ? <Action label="Delete" danger onPress={() => onDelete(version)} /> : null}
                </View>
              </>
            ) : null}
          </View>
        );
      })}
      {versions.hasNextPage ? <Action label={versions.isFetchingNextPage ? 'Loading…' : 'Show Older'} onPress={() => void versions.fetchNextPage()} /> : null}
    </View>
  );
}

function Action({ label, onPress, danger = false }: { label: string; onPress: () => void; danger?: boolean }) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6} style={({ pressed }) => [local.action, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
      <Text style={[styles.label, { color: danger ? palette.danger : palette.link }]}>{label}</Text>
    </Pressable>
  );
}

const local = StyleSheet.create({
  command: { gap: 2, paddingVertical: 0 },
  commandInput: { paddingVertical: 10 },
  box: { gap: 10, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  version: { gap: 10, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  live: { fontFamily: fonts.medium, fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  text: { padding: 10, borderRadius: radius.md, lineHeight: 19, overflow: 'hidden' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, alignSelf: 'flex-start' },
});
