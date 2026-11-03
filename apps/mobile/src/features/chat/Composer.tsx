import {
  availableToggles,
  defaultToggles,
  defaultToolIds,
  effectiveToggles,
  filesPending,
  usableTools,
  type FeatureToggles,
  type FileItem,
  type ModelItem,
  type ToggleKey,
} from '@maviechat/owui-protocol';
import { useEffect, useImperativeHandle, useRef, useState, type ComponentRef, type Ref } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { useAnchoredMenu, type MenuItem } from '@/components/Menu';
import { DeepTutorPicker } from '@/features/deeptutor/DeepTutorPicker';
import { useAuthed, useCapabilities, useTools, useUserSettings } from '@/lib/server';
import { useGrowingInput } from '@/lib/useGrowingInput';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';
import { AttachmentStrip } from './AttachmentStrip';
import { getDraft, updateDraft, useDraft } from './drafts';
import { FullScreenInput } from './FullScreenInput';
import { IntegrationsSheet, TOGGLE_INFO } from './IntegrationsSheet';
import { QueuedMessages } from './QueuedMessages';
import { useAttachments } from './useAttachments';

export interface OutgoingMessage {
  text: string;
  files: FileItem[];
  toggles: FeatureToggles;
  toolIds: string[];
}

/** Lets a screen put the cursor in the input (e.g. after inserting a suggestion). */
export interface ComposerHandle {
  focus: () => void;
}

interface ComposerProps {
  ref?: Ref<ComposerHandle>;
  /** Which chat's draft this is (`NEW_CHAT` on the new-chat screen). */
  draftKey: string;
  model: ModelItem | undefined;
  modelLabel: string;
  onPickModel: () => void;
  /** Resolves true when the message was sent or queued (the input is then cleared). */
  onSend: (message: OutgoingMessage) => Promise<boolean>;
  onStop: () => void;
  /** Sends one queued message right away, stopping the running reply. */
  onSendQueued?: (id: string) => void;
  streaming: boolean;
  /** Temporary chat: attachments stay on the phone. */
  temporary?: boolean;
  /** Floating in the middle of the new-chat screen rather than docked at the bottom. */
  floating?: boolean;
  autoFocus?: boolean;
  /** The web asks "How can I help you today?" on the new-chat screen and "Send a Message" in a chat. */
  placeholder?: string;
}

const NO_TOGGLES: Record<ToggleKey, boolean> = { webSearch: false, imageGeneration: false, codeInterpreter: false };

/**
 * The web app's phone input bar: attachments and queued messages above the text; below it
 * +, integrations and the switched-on toggles, then the model and send/stop.
 * Enter inserts a new line, as on the web's touch layout. Past two lines an expand button
 * opens the same text in a full-screen editor.
 */
export function Composer({
  ref,
  draftKey,
  model,
  modelLabel,
  onPickModel,
  onSend,
  onStop,
  onSendQueued,
  streaming,
  temporary = false,
  floating = false,
  autoFocus = false,
  placeholder = 'Send a Message',
}: ComposerProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { session } = useAuthed();
  const capabilities = useCapabilities();
  const settings = useUserSettings();
  const tools = useTools();
  const draft = useDraft(draftKey);
  const attach = useAttachments({ draftKey, model, temporary });
  const [sending, setSending] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [deepTutorOpen, setDeepTutorOpen] = useState(false);
  const deepTutorSignedIn = useDeepTutor().state.status === 'signed-in';
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);

  const available = capabilities ? availableToggles(capabilities, model) : NO_TOGGLES;
  const toggles = effectiveToggles(draft.toggles, available);
  const usable = usableTools(tools.data ?? []);
  const toolIds = draft.toolIds.filter((id) => usable.some((tool) => tool.id === id));
  const hasContent = draft.text.trim().length > 0 || draft.files.length > 0;
  const uploading = filesPending(draft.files);
  const canSend = hasContent && !sending && !uploading;
  const showIntegrations = available.webSearch || available.imageGeneration || available.codeInterpreter || usable.length > 0;
  const canExpand = draft.text.split('\n').length > 2;
  const setText = (text: string) => updateDraft(draftKey, (current) => ({ ...current, text }));
  const field = useGrowingInput(draft.text, setText);

  // Like the web, a model brings its own default toggles and tools when you start with it.
  const settingsReady = !settings.isPending;
  const toolsReady = !tools.isPending;
  useEffect(() => {
    if (!model || !capabilities || !settingsReady || !toolsReady || getDraft(draftKey).defaultsFor === model.id) return;
    const saved = (settings.data?.ui as { tools?: unknown } | null | undefined)?.tools;
    updateDraft(draftKey, (current) => ({
      ...current,
      toggles: defaultToggles(capabilities, model),
      toolIds: defaultToolIds(model, tools.data ?? [], saved),
      defaultsFor: model.id,
    }));
  }, [draftKey, model, capabilities, settingsReady, toolsReady, settings.data, tools.data]);

  const { ref: plusRef, open: openPlus, menu: plusMenu } = useAnchoredMenu([
    { key: 'files', label: 'Upload Files', icon: 'paper-clip', onPress: () => void attach.pickFiles() },
    { key: 'photos', label: 'Photo Library', icon: 'photo', onPress: () => void attach.pickPhotos() },
    { key: 'camera', label: 'Capture', icon: 'camera', onPress: () => void attach.capture() },
    ...(deepTutorSignedIn
      ? [{ key: 'deeptutor', label: 'Reference DeepTutor Chat', icon: 'academic-cap' as const, onPress: () => setDeepTutorOpen(true) }]
      : []),
  ] satisfies MenuItem[]);

  const setToggle = (key: ToggleKey, on: boolean) =>
    updateDraft(draftKey, (current) => ({ ...current, toggles: { ...current.toggles, [key]: on } }));
  const setTool = (id: string, on: boolean) =>
    updateDraft(draftKey, (current) => ({
      ...current,
      toolIds: on ? [...current.toolIds.filter((item) => item !== id), id] : current.toolIds.filter((item) => item !== id),
    }));
  const removeAttachment = (index: number) =>
    updateDraft(draftKey, (current) => {
      const itemId = current.files[index]?.itemId;
      const previews = { ...current.previews };
      if (itemId) delete previews[itemId];
      return { ...current, files: current.files.filter((_, at) => at !== index), previews };
    });

  const submit = async () => {
    if (!canSend) return;
    const message = { text: draft.text, files: draft.files, toggles, toolIds };
    const previews = draft.previews;
    setSending(true);
    // As on the web, the input empties as the message goes; one that didn't go out comes back,
    // unless something new was written meanwhile.
    updateDraft(draftKey, (current) => ({ ...current, text: '', files: [], previews: {} }));
    const sent = await onSend(message);
    setSending(false);
    if (!sent) {
      updateDraft(draftKey, (current) =>
        current.text || current.files.length ? current : { ...current, text: message.text, files: message.files, previews },
      );
    }
  };

  const editQueued = (id: string) =>
    updateDraft(draftKey, (current) => {
      const item = current.queue.find((entry) => entry.id === id);
      if (!item) return current;
      return { ...current, queue: current.queue.filter((entry) => entry.id !== id), text: item.prompt, files: item.files };
    });
  const deleteQueued = (id: string) =>
    updateDraft(draftKey, (current) => ({ ...current, queue: current.queue.filter((entry) => entry.id !== id) }));

  const chipKeys = (Object.keys(TOGGLE_INFO) as ToggleKey[]).filter((key) => toggles[key]);

  return (
    <View style={[styles.wrap, !floating && { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <QueuedMessages queue={draft.queue} onSendNow={onSendQueued} onEdit={editQueued} onDelete={deleteQueued} />
      <View style={[styles.box, { borderColor: palette.border, backgroundColor: palette.background }]}>
        <AttachmentStrip files={draft.files} previews={draft.previews} baseUrl={session.baseUrl} token={session.token} onRemove={removeAttachment} />
        <View>
          <TextInput
            ref={input}
            value={field.value}
            onChangeText={field.onChangeText}
            placeholder={placeholder}
            placeholderTextColor={palette.textFaint}
            multiline
            autoFocus={autoFocus}
            style={[styles.input, canExpand && styles.inputBesideExpand, { color: palette.text }, field.style]}
            accessibilityLabel="Message"
          />
          {canExpand ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Expand input"
              onPress={() => setExpanded(true)}
              hitSlop={8}
              style={({ pressed }) => [styles.expand, pressed && { backgroundColor: palette.surfaceStrong }]}>
              <Icon name="arrows-pointing-out" size={16} color={palette.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.row}>
          <Pressable
            ref={plusRef}
            accessibilityRole="button"
            accessibilityLabel="Attach files or photos"
            onPress={openPlus}
            hitSlop={4}
            style={({ pressed }) => [styles.round, { borderColor: palette.border }, pressed && { backgroundColor: palette.surfaceStrong }]}>
            <Icon name="plus" size={18} color={palette.textMuted} />
          </Pressable>
          {showIntegrations ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Integrations"
              onPress={() => setSheetOpen(true)}
              hitSlop={4}
              style={({ pressed }) => [styles.round, { borderColor: palette.border }, pressed && { backgroundColor: palette.surfaceStrong }]}>
              <Icon name="puzzle-piece" size={17} color={palette.textMuted} />
            </Pressable>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
            {chipKeys.map((key) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={`${TOGGLE_INFO[key].label} on. Turn off`}
                onPress={() => setToggle(key, false)}
                style={[styles.chip, { backgroundColor: palette.active }]}>
                <Icon name={TOGGLE_INFO[key].icon} size={17} color={palette.onActive} />
              </Pressable>
            ))}
            {toolIds.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${toolIds.length} tools on. Change tools`}
                onPress={() => setSheetOpen(true)}
                style={[styles.chip, styles.toolChip, { backgroundColor: palette.active }]}>
                <Icon name="wrench-screwdriver" size={15} color={palette.onActive} />
                <Text style={[styles.chipCount, { color: palette.onActive }]}>{toolIds.length}</Text>
              </Pressable>
            ) : null}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Model: ${modelLabel}. Change model`}
            onPress={onPickModel}
            hitSlop={6}
            style={styles.model}>
            <Text style={[styles.modelText, { color: palette.textMuted }]} numberOfLines={1}>
              {modelLabel}
            </Text>
            <Icon name="chevron-down" size={14} color={palette.textMuted} strokeWidth={2} />
          </Pressable>
          {streaming ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop generating"
              onPress={onStop}
              style={[styles.send, { backgroundColor: hasContent ? palette.surfaceStrong : palette.primary }]}>
              <View style={[styles.stopSquare, { backgroundColor: hasContent ? palette.text : palette.onPrimary }]} />
            </Pressable>
          ) : null}
          {!streaming || hasContent ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={streaming ? 'Queue message' : 'Send message'}
              accessibilityState={{ disabled: !canSend, busy: sending || uploading }}
              disabled={!canSend}
              onPress={() => void submit()}
              style={[styles.send, { backgroundColor: canSend ? palette.primary : palette.surfaceStrong }]}>
              {sending || uploading ? (
                <ActivityIndicator size="small" color={canSend ? palette.onPrimary : palette.textFaint} />
              ) : (
                <Icon name="arrow-up" size={18} color={canSend ? palette.onPrimary : palette.textFaint} strokeWidth={2.2} />
              )}
            </Pressable>
          ) : null}
        </View>
      </View>
      {plusMenu}
      {deepTutorSignedIn ? (
        <DeepTutorPicker visible={deepTutorOpen} onClose={() => setDeepTutorOpen(false)} onPick={(session) => void attach.attachDeepTutorChat(session)} />
      ) : null}
      <FullScreenInput
        visible={expanded}
        value={draft.text}
        placeholder={placeholder}
        onChange={setText}
        onClose={() => setExpanded(false)}
        onDismiss={() => input.current?.focus()}
      />
      <IntegrationsSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        available={available}
        toggles={toggles}
        onToggle={setToggle}
        tools={usable}
        toolIds={toolIds}
        onToggleTool={setTool}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 6 },
  box: { borderWidth: 1, borderRadius: 26, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: 6 },
  input: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, maxHeight: 160, paddingTop: 2, paddingBottom: 2 },
  inputBesideExpand: { paddingRight: 30 },
  expand: { position: 'absolute', top: -2, right: -6, width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  round: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chips: { flexGrow: 1, flexShrink: 1 },
  chipsContent: { alignItems: 'center', gap: 6 },
  chip: { height: 30, minWidth: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  toolChip: { flexDirection: 'row', gap: 3, paddingHorizontal: 9 },
  chipCount: { fontFamily: fonts.semibold, fontSize: 12 },
  model: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, maxWidth: '45%' },
  modelText: { fontFamily: fonts.medium, fontSize: 13, flexShrink: 1 },
  send: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 11, height: 11, borderRadius: 2 },
});
