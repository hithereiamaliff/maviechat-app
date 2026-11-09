import {
  CODE_VERSIONS_PAGE,
  compareCodeVersions,
  compareSkillFile,
  deleteCodeVersion,
  getCodeVersion,
  listCodeVersions,
  liveCodeVersionId,
  makeCodeVersionLive,
  OwuiHttpError,
  type ChangedFile,
  type CodeVersion,
  type VersionedKind,
} from '@maviechat/owui-protocol';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import { editorStyles, SheetHeader } from './EditorParts';
import { DiffView } from './VersionChanges';

/** Whose versions the sheet shows, and whether you may change them. */
export interface CodeVersionsTarget {
  kind: VersionedKind;
  id: string;
  name: string;
  canWrite: boolean;
}

const NOUN: Record<VersionedKind, string> = { tools: 'tool', functions: 'function', skills: 'skill' };
const when = (ms: number) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
/** Lines of a version's code drawn before Show All. */
const FIRST_LINES = 300;

/**
 * A tool's, function's or skill's versions (Open WebUI 0.12, as its editors show them): each save
 * that changed it, newest first, with its note, who and when, and which is live. Open one to read
 * its code (a skill's SKILL.md and its files), compare it with the live one or the one before,
 * make it live again, copy it, or delete it (not the live one).
 */
export function CodeVersionsSheet({ target, onClose, onChanged }: { target: CodeVersionsTarget | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target ? <Versions key={`${target.kind}:${target.id}`} target={target} onClose={onClose} onChanged={onChanged} /> : null}
    </Modal>
  );
}

function Versions({ target, onClose, onChanged }: { target: CodeVersionsTarget; onClose: () => void; onChanged: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client } = useAuthed();
  const { kind, id } = target;
  const root = ['code-versions', kind, id] as const;
  const live = useQuery({ queryKey: [...root, 'live'], queryFn: () => liveCodeVersionId(client, kind, id), staleTime: 0 });
  const versions = useInfiniteQuery({
    queryKey: [...root, 'list'],
    queryFn: ({ pageParam }) => listCodeVersions(client, kind, id, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.length >= CODE_VERSIONS_PAGE ? pages.length + 1 : undefined),
    staleTime: 0,
  });
  const [open, setOpen] = useState<string | null>(null);
  const [comparing, setComparing] = useState<'live' | 'previous' | null>(null);
  const items = versions.data?.pages.flat() ?? [];
  const liveId = live.data ?? null;

  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: root });
    onChanged();
  };
  const makeLive = (version: CodeVersion) =>
    Alert.alert(
      'Make this version live?',
      kind === 'skills' ? 'Models using the skill get this version from now on.' : `The server loads its code again, as when it was saved (installing what its header lists). Only make code you trust live.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Make Live',
          onPress: () =>
            void makeCodeVersionLive(client, kind, id, version.id, liveId).then(
              () => {
                reload();
                toast('That version is live');
              },
              (error: unknown) =>
                // A skill changed meanwhile: its live version isn't the one shown here any more.
                Alert.alert('Not made live', error instanceof OwuiHttpError && error.status === 409 ? 'It changed meanwhile: close this and open it again.' : describeError(error)),
            ),
        },
      ],
    );
  const remove = (version: CodeVersion) =>
    Alert.alert('Delete this version?', 'It leaves the history for good; the versions after it are linked to the one before it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteCodeVersion(client, kind, id, version.id).then(
            () => {
              if (open === version.id) setOpen(null);
              reload();
              toast('Version deleted');
            },
            (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);

  return (
    <View style={[editorStyles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={`Versions of ${target.name}`} onCancel={onClose} onSave={onClose} canSave={false} busy={false} readOnly />
      <ScrollView contentContainerStyle={editorStyles.content}>
        <Text style={[editorStyles.note, { color: palette.textMuted }]}>
          {`Each save that changes the ${NOUN[kind]} is kept here and made live.${kind === 'skills' ? '' : ' Making an older one live loads its code on the server again.'}`}
        </Text>
        {versions.isLoading || live.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {versions.isError ? <Text style={[editorStyles.note, { color: palette.danger }]}>{`Couldn’t load them: ${describeError(versions.error)}`}</Text> : null}
        {versions.data && !items.length ? <Text style={[editorStyles.note, { color: palette.textFaint }]}>None kept yet: the next save that changes it starts the history.</Text> : null}
        {items.map((version) => {
          const isLive = version.id === liveId;
          const shown = open === version.id;
          // The one it was saved over (compared by id, so it needn't be listed yet).
          const previous = version.parentId;
          return (
            <View key={version.id} style={[styles.version, { borderColor: isLive ? palette.link : palette.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: shown }}
                onPress={() => {
                  setOpen(shown ? null : version.id);
                  setComparing(null);
                }}
                style={styles.row}>
                <View style={styles.flex}>
                  <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
                    {version.note || 'Saved'}
                  </Text>
                  <Text style={[editorStyles.note, { color: palette.textMuted }]} numberOfLines={1}>
                    {[version.author, when(version.createdAt), version.id.slice(0, 7)].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {isLive ? <Text style={[styles.live, { color: palette.link, borderColor: palette.link }]}>Live</Text> : null}
                <Icon name={shown ? 'chevron-up' : 'chevron-down'} size={14} color={palette.textMuted} />
              </Pressable>
              {shown ? (
                <>
                  {comparing === 'live' && liveId && !isLive ? (
                    <Comparison kind={kind} id={id} fromId={version.id} toId={liveId} caption="From this version to the live one: − only in this version, + only in the live one." />
                  ) : comparing === 'previous' && previous ? (
                    <Comparison kind={kind} id={id} fromId={previous} toId={version.id} caption="What this version changed from the one it was saved over: − taken out, + put in." />
                  ) : (
                    <Snapshot kind={kind} id={id} versionId={version.id} />
                  )}
                  <View style={styles.actions}>
                    {comparing ? <Action label={kind === 'skills' ? 'Show Text' : 'Show Code'} onPress={() => setComparing(null)} /> : null}
                    {!isLive && liveId && comparing !== 'live' ? <Action label="Compare with Live" onPress={() => setComparing('live')} /> : null}
                    {previous && comparing !== 'previous' ? <Action label="Compare with Previous" onPress={() => setComparing('previous')} /> : null}
                    {!isLive && target.canWrite ? <Action label="Make Live…" onPress={() => makeLive(version)} /> : null}
                    <CopyAction kind={kind} id={id} versionId={version.id} />
                    {!isLive && target.canWrite ? <Action label="Delete…" danger onPress={() => remove(version)} /> : null}
                  </View>
                </>
              ) : null}
            </View>
          );
        })}
        {versions.hasNextPage ? <Action label={versions.isFetchingNextPage ? 'Loading…' : 'Show Older'} onPress={() => void versions.fetchNextPage()} /> : null}
      </ScrollView>
    </View>
  );
}

/** One version's name, description and code (a skill's SKILL.md, and the files it held). */
function Snapshot({ kind, id, versionId }: { kind: VersionedKind; id: string; versionId: string }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const [all, setAll] = useState(false);
  const version = useQuery({ queryKey: ['code-versions', kind, id, 'version', versionId], queryFn: () => getCodeVersion(client, kind, id, versionId), staleTime: Infinity });
  if (version.isError) return <Text style={[editorStyles.note, { color: palette.danger }]}>{`Couldn’t load it: ${describeError(version.error)}`}</Text>;
  if (!version.data) return <ActivityIndicator color={palette.textMuted} />;
  const { snapshot } = version.data;
  const lines = snapshot.content.split('\n');
  const others = snapshot.files.filter((file) => file.path !== 'SKILL.md');
  return (
    <View style={styles.snapshot}>
      <Text style={[styles.title, { color: palette.text }]}>{snapshot.name}</Text>
      {snapshot.description ? <Text style={[editorStyles.note, { color: palette.textMuted }]}>{snapshot.description}</Text> : null}
      <Text selectable style={[styles.code, { color: palette.text, backgroundColor: palette.surface }]}>
        {all || lines.length <= FIRST_LINES ? snapshot.content : lines.slice(0, FIRST_LINES).join('\n')}
      </Text>
      {!all && lines.length > FIRST_LINES ? <Action label={`Show All ${lines.length} Lines`} onPress={() => setAll(true)} /> : null}
      {others.length ? <Text style={[editorStyles.note, { color: palette.textMuted }]}>{`Its other files: ${others.map((file) => `${file.path}${file.binary ? ' (binary)' : ''}`).join(', ')}`}</Text> : null}
    </View>
  );
}

/** Two versions compared by the server: name and description, the code line by line, a skill's other files. */
function Comparison({ kind, id, fromId, toId, caption }: { kind: VersionedKind; id: string; fromId: string; toId: string; caption: string }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const compared = useQuery({ queryKey: ['code-versions', kind, id, 'compare', fromId, toId], queryFn: () => compareCodeVersions(client, kind, id, fromId, toId), staleTime: Infinity });
  if (compared.isError) return <Text style={[editorStyles.note, { color: palette.danger }]}>{`Couldn’t compare them: ${describeError(compared.error)}`}</Text>;
  if (!compared.data) return <ActivityIndicator color={palette.textMuted} />;
  const { changes, diff, files } = compared.data;
  return (
    <View style={styles.snapshot}>
      <DiffView diff={diff} caption={kind === 'skills' ? `${caption} Its SKILL.md:` : caption} changes={changes.map((change) => `${change.what}: “${change.before}” → “${change.after}”`)} />
      {files.length ? <Text style={[styles.title, { color: palette.text }]}>Its other files</Text> : null}
      {files.map((file) => (
        <SkillFileChange key={file.path} id={id} fromId={fromId} toId={toId} file={file} />
      ))}
    </View>
  );
}

const STATUS: Record<ChangedFile['status'], string> = { added: 'put in', deleted: 'taken out', modified: 'changed' };

/** A skill's other file that differs: tap to see how (text files only). */
function SkillFileChange({ id, fromId, toId, file }: { id: string; fromId: string; toId: string; file: ChangedFile }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const [shown, setShown] = useState(false);
  const compared = useQuery({ queryKey: ['code-versions', 'skills', id, 'file', fromId, toId, file.path], queryFn: () => compareSkillFile(client, id, fromId, toId, file.path), enabled: shown && !file.binary, staleTime: Infinity });
  return (
    <View style={styles.file}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: shown }} disabled={file.binary} onPress={() => setShown(!shown)} style={styles.row}>
        <Text style={[styles.fileName, { color: palette.text }]} numberOfLines={1}>
          {file.path}
        </Text>
        <Text style={[editorStyles.note, { color: palette.textMuted }]}>{`${STATUS[file.status]}${file.binary ? ', binary' : ''}`}</Text>
        {file.binary ? null : <Icon name={shown ? 'chevron-up' : 'chevron-down'} size={13} color={palette.textMuted} />}
      </Pressable>
      {shown && compared.isError ? <Text style={[editorStyles.note, { color: palette.danger }]}>{describeError(compared.error)}</Text> : null}
      {shown && !compared.data && !compared.isError ? <ActivityIndicator color={palette.textMuted} /> : null}
      {shown && compared.data ? <DiffView diff={compared.data.diff} caption={file.path} /> : null}
    </View>
  );
}

/** Copies a version's code (it's read first if it isn't yet). */
function CopyAction({ kind, id, versionId }: { kind: VersionedKind; id: string; versionId: string }) {
  const toast = useToast();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const copy = () =>
    void queryClient
      .fetchQuery({ queryKey: ['code-versions', kind, id, 'version', versionId], queryFn: () => getCodeVersion(client, kind, id, versionId), staleTime: Infinity })
      .then((version) => Clipboard.setStringAsync(version.snapshot.content))
      .then(
        () => toast('Copied'),
        (error: unknown) => toast(`Couldn’t copy it: ${describeError(error)}`, 'error'),
      );
  return <Action label="Copy" onPress={copy} />;
}

function Action({ label, onPress, danger = false }: { label: string; onPress: () => void; danger?: boolean }) {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.action, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
      <Text style={[styles.actionText, { color: danger ? palette.danger : palette.link }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  version: { gap: 10, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontFamily: fonts.medium, fontSize: 14 },
  live: { fontFamily: fonts.medium, fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  snapshot: { gap: 8 },
  code: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, padding: 10, borderRadius: radius.md, overflow: 'hidden' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, alignSelf: 'flex-start' },
  actionText: { fontFamily: fonts.medium, fontSize: 14 },
  file: { gap: 6 },
  fileName: { flex: 1, fontFamily: fonts.mono, fontSize: 13 },
});
