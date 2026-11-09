import {
  codeIdFromName,
  codeIdProblem,
  createAdminFunction,
  createWorkspaceTool,
  formatPythonCode,
  getAdminFunction,
  getWorkspaceTool,
  isAtLeast,
  requirementsOf,
  updateAdminFunction,
  updateWorkspaceTool,
  versionProblem,
  type CodeKind,
} from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { SideScroll } from '@/components/SideScroll';
import { useToast } from '@/components/Toast';
import { editorStyles, SheetHeader, SheetLoading } from '@/features/workspace/EditorParts';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, radius, usePalette, useSyntaxColors } from '@/theme';
import { EDITOR_PAGE } from './editorPage.generated';

/** What the editor opens: an existing tool or function (loaded here), or new code. */
export type CodeTarget =
  | { kind: CodeKind; id: string }
  | {
      kind: CodeKind;
      id: null;
      name: string;
      description: string;
      content: string;
      /** From a link or a file: shown first, saved only when you say. */
      imported?: boolean;
      /** The id it came with (an export file's), instead of one made from the name. */
      suggestedId?: string;
    };

const NOUN: Record<CodeKind, string> = { tools: 'Tool', functions: 'Function' };

/**
 * Writing a Workspace tool's or an admin function's Python, as the web's editor does: its name,
 * id (new ones) and what it's for, and the code in an editor made for it (CodeMirror in a web
 * view: Python colours, line numbers, indenting as you type, find), with Tab and Untab, which a
 * phone keyboard lacks. Saving runs the code on the server, so it asks first.
 */
export function CodeEditorSheet({ target, onClose, onSaved }: { target: CodeTarget | null; onClose: () => void; onSaved: () => void }) {
  const palette = usePalette();
  // Leaving with changes asks first; the sheet's own close goes through it.
  const closerRef = useRef<() => void>(onClose);
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => closerRef.current()}>
      {target === null ? (
        <View style={{ backgroundColor: palette.background }} />
      ) : target.id === null ? (
        <Editor key={`new:${target.name}:${target.content.length}`} kind={target.kind} existingId={null} initial={target} imported={Boolean(target.imported)} onClose={onClose} onSaved={onSaved} closerRef={closerRef} />
      ) : (
        <Existing kind={target.kind} id={target.id} onClose={onClose} onSaved={onSaved} closerRef={closerRef} />
      )}
    </Modal>
  );
}

function Existing({ kind, id, onClose, onSaved, closerRef }: { kind: CodeKind; id: string; onClose: () => void; onSaved: () => void; closerRef: RefObject<() => void> }) {
  const { client } = useAuthed();
  const item = useQuery({
    queryKey: ['code-item', kind, id],
    queryFn: async () => {
      const found = kind === 'tools' ? await getWorkspaceTool(client, id) : await getAdminFunction(client, id);
      if (found.content === null) throw new Error('this account may not change its code');
      return { name: found.name, description: found.description, content: found.content };
    },
    staleTime: 0,
    gcTime: 0,
  });
  if (!item.data) return <SheetLoading error={item.error} onClose={onClose} />;
  return <Editor kind={kind} existingId={id} initial={item.data} imported={false} onClose={onClose} onSaved={onSaved} closerRef={closerRef} />;
}

function Editor({
  kind,
  existingId,
  initial,
  imported,
  onClose,
  onSaved,
  closerRef,
}: {
  kind: CodeKind;
  existingId: string | null;
  initial: { name: string; description: string; content: string; suggestedId?: string };
  imported: boolean;
  onClose: () => void;
  onSaved: () => void;
  closerRef: RefObject<() => void>;
}) {
  const palette = usePalette();
  const syntax = useSyntaxColors();
  const toast = useToast();
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const isNew = existingId === null;
  const [name, setName] = useState(initial.name);
  const [id, setId] = useState(isNew ? (initial.suggestedId ?? codeIdFromName(initial.name)) : existingId);
  const [idEdited, setIdEdited] = useState(Boolean(initial.suggestedId));
  const [description, setDescription] = useState(initial.description);
  // 0.12 keeps each save as a version, with a note when one is given.
  const versioned = !isNew && isAtLeast(capabilities?.version, '0.12.0');
  const [note, setNote] = useState('');
  const [details, setDetails] = useState(isNew);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const [wrap, setWrap] = useState(false);
  const [busy, setBusy] = useState<'saving' | 'formatting' | null>(null);
  const webview = useRef<WebView<object>>(null);
  const pending = useRef(new Map<string, (value: string) => void>());
  const latest = useRef(initial.content);
  const counter = useRef(0);
  const dark = palette.background !== '#FFFFFF';
  const look = { dark, colors: lookColors(palette), syntax: syntaxOf(syntax) };
  // The code and the look go in before the page starts, once; later looks are sent to it.
  const [init] = useState(() => `window.__mavieInit=${JSON.stringify({ value: initial.content, wrap: false, fontSize: 13, ...look })};true;`);
  const send = (script: string) => webview.current?.injectJavaScript(`window.mavieEditor&&${script};true;`);

  useEffect(() => {
    if (ready) webview.current?.injectJavaScript(`window.mavieEditor&&window.mavieEditor.set(${JSON.stringify({ dark, colors: lookColors(palette), syntax: syntaxOf(syntax) })});true;`);
  }, [ready, dark, palette, syntax]);

  const changed = dirty || name !== initial.name || description !== initial.description;
  const idProblem = isNew ? codeIdProblem(id) : null;
  const canSave = ready && !busy && name.trim().length > 0 && !idProblem && (isNew || changed);

  // Leaving with changes asks first.
  const leave = () => {
    if (!changed || busy) return void onClose();
    Alert.alert('Discard your changes?', isNew ? 'This code isn’t saved.' : 'The code on the server stays as it was.', [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };
  useEffect(() => {
    closerRef.current = leave;
  });

  const codeNow = () =>
    new Promise<string>((resolve) => {
      counter.current += 1;
      const request = String(counter.current);
      const timer = setTimeout(() => {
        pending.current.delete(request);
        resolve(latest.current);
      }, 3000);
      pending.current.set(request, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      send(`window.mavieEditor.flush(${JSON.stringify(request)})`);
    });

  const onMessage = (event: WebViewMessageEvent) => {
    let message: { type?: unknown; id?: unknown; value?: unknown; undo?: unknown; redo?: unknown };
    try {
      message = JSON.parse(event.nativeEvent.data) as typeof message;
    } catch {
      return;
    }
    if (message.type === 'ready') setReady(true);
    else if (message.type === 'dirty') setDirty(true);
    else if (message.type === 'history') setHistory({ undo: message.undo === true, redo: message.redo === true });
    else if (message.type === 'doc' && typeof message.value === 'string') {
      latest.current = message.value;
      if (typeof message.id === 'string') {
        const done = pending.current.get(message.id);
        pending.current.delete(message.id);
        done?.(message.value);
      }
    }
  };

  const format = async () => {
    setBusy('formatting');
    try {
      const code = await codeNow();
      const tidy = await formatPythonCode(client, code);
      if (tidy === code) toast('Already tidy');
      else {
        send(`window.mavieEditor.setValue(${JSON.stringify(tidy)})`);
        toast('Formatted');
      }
    } catch (error) {
      Alert.alert('Couldn’t format it', describeError(error));
    } finally {
      setBusy(null);
    }
  };

  const write = async (code: string) => {
    setBusy('saving');
    try {
      const fields = { name: name.trim(), description: description.trim(), content: code, note: versioned ? note : '' };
      if (existingId) {
        if (kind === 'tools') await updateWorkspaceTool(client, existingId, fields);
        else await updateAdminFunction(client, existingId, fields);
      } else if (kind === 'tools') await createWorkspaceTool(client, { id: id.trim(), ...fields });
      else await createAdminFunction(client, { id: id.trim(), ...fields });
      onSaved();
      toast(`${fields.name} saved`);
      onClose();
    } catch (error) {
      // The server's reason can be a Python error: shown whole.
      Alert.alert('Not saved', describeError(error));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!canSave) return;
    const code = await codeNow();
    if (!code.trim()) return void Alert.alert('Not saved', 'There’s no code.');
    const tooOld = versionProblem(code, capabilities?.version);
    if (tooOld) return void Alert.alert('Not saved', tooOld);
    const installs = requirementsOf(code);
    const what = `${isNew ? 'The server runs this code to save it' : 'The server runs the new code to load it'}${installs ? `, and installs ${installs}` : ''}.`;
    Alert.alert(isNew ? `Save and run ${name.trim()}?` : `Save ${name.trim()}?`, `${what}${isNew || imported ? ' Only save code you trust.' : ''}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Save', style: isNew ? 'destructive' : 'default', onPress: () => void write(code) },
    ]);
  };

  const input = [editorStyles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];

  return (
    <KeyboardAvoidingView behavior="padding" style={[editorStyles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={isNew ? `New ${NOUN[kind]}` : name || initial.name} onCancel={leave} onSave={() => void save()} canSave={canSave} busy={busy === 'saving'} />
      {isNew || imported ? (
        <View style={[styles.warning, { borderColor: palette.warning }]}>
          <Icon name="exclamation-triangle" size={16} color={palette.warning} />
          <Text style={[styles.warningText, { color: palette.text }]}>{`${NOUN[kind]}s run Python on your server. Only save code from someone you trust.`}</Text>
        </View>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails(!details)} style={styles.detailsRow}>
        <Text style={[styles.detailsText, { color: palette.textMuted }]} numberOfLines={1}>
          {details ? 'Details' : `${name || 'No name yet'}${description ? ` · ${description}` : ''}`}
        </Text>
        <Icon name={details ? 'chevron-up' : 'chevron-down'} size={14} color={palette.textMuted} />
      </Pressable>
      {details ? (
        <View style={styles.details}>
          <TextInput
            value={name}
            onChangeText={(value) => {
              setName(value);
              if (isNew && !idEdited) setId(codeIdFromName(value));
            }}
            placeholder={`${NOUN[kind]} name`}
            placeholderTextColor={palette.textFaint}
            autoFocus={isNew && !initial.name}
            accessibilityLabel="Name"
            style={input}
          />
          {isNew ? (
            <>
              <TextInput
                value={id}
                onChangeText={(value) => {
                  setId(value);
                  setIdEdited(true);
                }}
                placeholder="id, like my_tool"
                placeholderTextColor={palette.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Id"
                style={[input, styles.mono, idProblem && id ? { borderColor: palette.danger } : null]}
              />
              {idProblem && id ? <Text style={[editorStyles.note, { color: palette.danger }]}>{idProblem}</Text> : null}
            </>
          ) : (
            <Text style={[editorStyles.note, styles.mono, { color: palette.textMuted }]}>{existingId}</Text>
          )}
          <TextInput value={description} onChangeText={setDescription} placeholder="What it’s for" placeholderTextColor={palette.textFaint} accessibilityLabel="Description" style={input} />
          {versioned ? <TextInput value={note} onChangeText={setNote} placeholder="A note on this change, kept with its version" placeholderTextColor={palette.textFaint} accessibilityLabel="Note on this change" style={input} /> : null}
        </View>
      ) : null}
      <View style={[styles.toolbar, { borderColor: palette.border }]}>
        <IconButton icon="arrow-uturn-left" label="Undo" size={18} color={palette.text} disabled={!history.undo} onPress={() => send("window.mavieEditor.run('undo')")} />
        <IconButton icon="arrow-uturn-right" label="Redo" size={18} color={palette.text} disabled={!history.redo} onPress={() => send("window.mavieEditor.run('redo')")} />
        <SideScroll horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills} style={styles.flex}>
          <Pill label="Tab" onPress={() => send("window.mavieEditor.run('tab')")} />
          <Pill label="Untab" onPress={() => send("window.mavieEditor.run('dedent')")} />
          <Pill label="Find" onPress={() => send("window.mavieEditor.run('find')")} />
          <Pill
            label="Wrap"
            on={wrap}
            onPress={() => {
              setWrap(!wrap);
              send(`window.mavieEditor.set(${JSON.stringify({ wrap: !wrap })})`);
            }}
          />
          {/* The server's formatter is for admins, as on the web. */}
          {capabilities?.isAdmin ? <Pill label={busy === 'formatting' ? 'Formatting…' : 'Format'} disabled={busy !== null || !ready} onPress={() => void format()} /> : null}
        </SideScroll>
      </View>
      <View style={styles.flex}>
        <WebView<object>
          ref={webview}
          source={{ html: EDITOR_PAGE }}
          injectedJavaScriptBeforeContentLoaded={init}
          onMessage={onMessage}
          // Nothing in the page goes anywhere else.
          onShouldStartLoadWithRequest={(request) => request.url === 'about:blank' || request.url.startsWith('data:')}
          originWhitelist={['about:*', 'data:*']}
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView
          scrollEnabled={false}
          bounces={false}
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          style={[styles.flex, { backgroundColor: palette.background }]}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

/** A toolbar button with words: Tab, Untab, Find, Wrap, Format. */
function Pill({ label, onPress, on = false, disabled = false }: { label: string; onPress: () => void; on?: boolean; disabled?: boolean }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: on }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, { borderColor: palette.border, backgroundColor: on ? palette.active : pressed ? palette.surfaceStrong : 'transparent', opacity: disabled ? 0.4 : 1 }]}>
      <Text style={[styles.pillText, { color: on ? palette.onActive : palette.text }]}>{label}</Text>
    </Pressable>
  );
}

/** The page's own colours, from the app's. */
function lookColors(palette: ReturnType<typeof usePalette>) {
  return {
    background: palette.background,
    text: palette.text,
    muted: palette.textMuted,
    faint: palette.textFaint,
    border: palette.border,
    surface: palette.surface,
    activeLine: palette.surface,
    selection: palette.surfaceStrong,
    match: palette.surfaceStrong,
  };
}

/** The app's code colours, as the page names them. */
function syntaxOf(syntax: Record<string, string>) {
  return {
    keyword: syntax.keyword,
    string: syntax.string,
    number: syntax.number,
    comment: syntax.comment,
    fn: syntax['title.function'] ?? syntax.title,
    type: syntax['title.class'] ?? syntax.type,
    decorator: syntax.meta,
  };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  warning: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 6, padding: 10, borderWidth: 1, borderRadius: radius.md },
  warningText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  detailsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 6 },
  detailsText: { flex: 1, fontFamily: fonts.medium, fontSize: 13 },
  details: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  mono: { fontFamily: fonts.mono, fontSize: 13 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  pills: { alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  pill: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 5 },
  pillText: { fontFamily: fonts.medium, fontSize: 13 },
});
