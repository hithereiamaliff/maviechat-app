import {
  activeTerminal,
  availableToggles,
  canUseTerminal,
  chatTerminals,
  saveToolApprovalMode,
  defaultFilterIds,
  defaultSkillIds,
  defaultToggles,
  defaultToolIds,
  effectiveToggles,
  filesPending,
  listSkillChoices,
  modelControls,
  modelFilters,
  modelTerminal,
  terminalLabel,
  usableTools,
  type FeatureToggles,
  type FileItem,
  type ModelItem,
  type ToggleKey,
} from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useImperativeHandle, useRef, useState, type ComponentRef, type Ref } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { SideScroll } from '@/components/SideScroll';
import { showPrompt } from '@/components/dialogs';
import { useAnchoredMenu, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { DeepTutorPicker } from '@/features/deeptutor/DeepTutorPicker';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useModels, useServerConfig, useTerminals, useTools, useUserSettings } from '@/lib/server';
import { useInterface } from '@/lib/uiSettings';
import { useGrowingInput } from '@/lib/useGrowingInput';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';
import { AttachmentStrip } from './AttachmentStrip';
import { AttachSheet, type AttachMode } from './AttachSheet';
import { getDraft, updateDraft, useDraft } from './drafts';
import { FilePreviewSheet } from './FilePreviewSheet';
import { FullScreenInput } from './FullScreenInput';
import { IntegrationsSheet, TOGGLE_INFO } from './IntegrationsSheet';
import { MentionMenu } from './MentionMenu';
import { ModelControlsSheet } from './ModelControlsSheet';
import { pastedText } from './paste';
import { PromptVariablesSheet } from './PromptVariablesSheet';
import { QueuedMessages } from './QueuedMessages';
import { chooseTerminal, terminalAccount, useChosenTerminal } from './terminals';
import { useAttachments } from './useAttachments';
import { useInputMenus } from './useInputMenus';

export interface OutgoingMessage {
  text: string;
  files: FileItem[];
  toggles: FeatureToggles;
  toolIds: string[];
  /** Skills switched on in Integrations (`skill_ids`). */
  skillIds?: string[];
  /** The model's switchable filters turned on (`filter_ids`). */
  filterIds?: string[];
  /** Picked with `@`: this model alone answers, instead of the chat's models. */
  atModelId?: string;
}

/** Lets a screen put the cursor in the input (e.g. after inserting a suggestion). */
export interface ComposerHandle {
  focus: () => void;
}

interface ComposerProps {
  ref?: Ref<ComposerHandle>;
  /** Which chat's draft this is (`NEW_CHAT` on the new-chat screen). */
  draftKey: string;
  /** The model that leads: its default toggles and tools apply. */
  model: ModelItem | undefined;
  /** With Compare, every model the message goes to; a toggle shows only when all of them allow it. */
  models?: ModelItem[];
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
  /** The new-chat screen's temporary chat switch, for the `/temporary` command. */
  onTemporary?: () => void;
  /** A saved chat's `/fork` command. */
  onFork?: () => void;
  /** A saved chat's `/compact` command, where the server has context compaction on. */
  onCompact?: () => void;
  /** `/status`, once the chat has messages. */
  onStatus?: () => void;
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
  models,
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
  onTemporary,
  onFork,
  onCompact,
  onStatus,
}: ComposerProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { session, client } = useAuthed();
  const capabilities = useCapabilities();
  const settings = useUserSettings();
  const ui = useInterface();
  const config = useServerConfig();
  const queryClient = useQueryClient();
  const toast = useToast();
  // Tool permissions, when the server has them on: your choice is kept with your settings' parameters.
  const approvalsOn = (config.data?.features as { enable_tool_permissions?: boolean } | undefined)?.enable_tool_permissions === true;
  const approvalMode = ((settings.data?.ui as { params?: { tool_approval_mode?: string } } | null | undefined)?.params?.tool_approval_mode === 'ask' ? 'ask' : 'full') as 'full' | 'ask';
  const setApprovalMode = (mode: 'full' | 'ask') =>
    void saveToolApprovalMode(client, mode)
      .then(() => queryClient.invalidateQueries({ queryKey: ['user-settings'] }))
      .catch((error: unknown) => toast(`Couldn't change tool permissions: ${describeError(error)}`, 'error'));
  const tools = useTools();
  // Skills you can switch on (the web's Integrations list, and the `/` list): the active ones.
  const skills = useQuery({ queryKey: ['workspace', 'skill-choices'], queryFn: () => listSkillChoices(client), staleTime: 60_000 });
  const draft = useDraft(draftKey);
  const attach = useAttachments({ draftKey, model, temporary });
  const [sending, setSending] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [deepTutorOpen, setDeepTutorOpen] = useState(false);
  const [knobsOpen, setKnobsOpen] = useState(false);
  const [attachMode, setAttachMode] = useState<AttachMode | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const deepTutorSignedIn = useDeepTutor().state.status === 'signed-in';
  const notesOn = capabilities?.feature('notes', true) ?? false;
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
  const allModels = useModels();
  const atModel = draft.atModel ? allModels.data?.find((item) => item.id === draft.atModel) : undefined;

  // The system the model works on (the web's terminal menu): offered while a model answering may use one.
  const terminals = useTerminals();
  const account = terminalAccount(session.baseUrl, session.user.id);
  const chosenSystemId = useChosenTerminal(account);
  const answering = atModel ? [atModel] : models?.length ? models : [model];
  const systems = answering.some(canUseTerminal) ? chatTerminals(terminals.data ?? [], temporary) : [];
  const system = activeTerminal(terminals.data ?? [], chosenSystemId, answering, temporary);
  const offered = capabilities ? availableToggles(capabilities, atModel ?? (models?.length ? models : model)) : NO_TOGGLES;
  // As on the web, a system and the code interpreter don't go together.
  const available = system ? { ...offered, codeInterpreter: false } : offered;
  // "Always search the web" (Interface): on for every message where it's available, as on the web.
  const always: ToggleKey[] = ui('webSearch') && available.webSearch ? ['webSearch'] : [];
  const toggles = effectiveToggles(always.length ? { ...draft.toggles, webSearch: true } : draft.toggles, available);
  const usable = usableTools(tools.data ?? []);
  // 0.12's knobs: the chosen models that have some (none on 0.11).
  const knobModels = (models ?? (model ? [model] : [])).filter((item) => modelControls(item).length > 0);
  const toolIds = draft.toolIds.filter((id) => usable.some((tool) => tool.id === id));
  const activeSkills = (skills.data ?? []).filter((skill) => skill.active);
  const skillIds = draft.skillIds.filter((id) => activeSkills.some((skill) => skill.id === id));
  // The filters of the model that leads (the web's list, too, follows the first model).
  const filters = modelFilters(atModel ?? model);
  const filterIds = draft.filterIds.filter((id) => filters.some((filter) => filter.id === id));
  const hasContent = draft.text.trim().length > 0 || draft.files.length > 0;
  const uploading = filesPending(draft.files);
  const canSend = hasContent && !sending && !uploading;
  const showIntegrations =
    available.webSearch || available.imageGeneration || available.codeInterpreter || usable.length > 0 || approvalsOn || systems.length > 0 || activeSkills.length > 0 || filters.length > 0;
  const canExpand = draft.text.split('\n').length > 2;
  // With "Paste long text as a file" on, a paste over 1,000 characters is attached instead, and the box keeps what it had.
  const setText = (text: string) => {
    const pasted = ui('largeTextAsFile') ? pastedText(getDraft(draftKey).text, text) : null;
    if (pasted !== null) return void attach.attachText(pasted);
    updateDraft(draftKey, (current) => ({ ...current, text }));
  };
  const field = useGrowingInput(draft.text, setText);
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(false);
  const menus = useInputMenus({
    draftKey,
    text: draft.text,
    cursor,
    focused,
    setText: (text, at) => {
      setText(text);
      setCursor(at);
      // After the new text is in, the cursor goes where the picked item ends.
      setTimeout(() => input.current?.setSelection(at, at), 50);
    },
    onPickModel,
    onTemporary,
    onFork,
    onCompact,
    onStatus,
  });

  // Like the web, a model brings its own default toggles, tools, skills, filters and system when you start with it.
  const settingsReady = !settings.isPending;
  const toolsReady = !tools.isPending;
  const terminalsReady = !terminals.isPending;
  const skillsReady = !skills.isPending;
  useEffect(() => {
    if (!model || !capabilities || !settingsReady || !toolsReady || !terminalsReady || !skillsReady || getDraft(draftKey).defaultsFor === model.id) return;
    const saved = (settings.data?.ui as { tools?: unknown } | null | undefined)?.tools;
    updateDraft(draftKey, (current) => ({
      ...current,
      toggles: defaultToggles(capabilities, model),
      toolIds: defaultToolIds(model, tools.data ?? [], saved),
      skillIds: defaultSkillIds(model, skills.data ?? []),
      filterIds: defaultFilterIds(model),
      defaultsFor: model.id,
    }));
    const preset = modelTerminal(model, terminals.data ?? []);
    if (preset) chooseTerminal(account, preset);
  }, [draftKey, model, capabilities, settingsReady, toolsReady, terminalsReady, skillsReady, settings.data, tools.data, terminals.data, skills.data, account]);

  const { ref: plusRef, open: openPlus, menu: plusMenu } = useAnchoredMenu([
    { key: 'files', label: 'Upload Files', icon: 'paper-clip', onPress: () => void attach.pickFiles() },
    { key: 'photos', label: 'Photo Library', icon: 'photo', onPress: () => void attach.pickPhotos() },
    { key: 'camera', label: 'Capture', icon: 'camera', onPress: () => void attach.capture() },
    { key: 'paste', label: 'Paste Image', icon: 'clipboard-document', onPress: () => void attach.pasteImage() },
    {
      key: 'web',
      label: 'Attach Webpage',
      icon: 'globe-alt',
      onPress: () =>
        showPrompt(
          'Attach Webpage',
          'The page’s address, starting with https://',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Attach', onPress: (value?: string) => void attach.attachWebpage(value ?? '') },
          ],
          'plain-text',
          '',
          'url',
        ),
    },
    { key: 'previous', label: 'Attach Files', icon: 'document-text', onPress: () => setAttachMode('files') },
    ...(notesOn ? [{ key: 'notes', label: 'Attach Notes', icon: 'pencil-square' as const, onPress: () => setAttachMode('notes') }] : []),
    { key: 'knowledge', label: 'Attach Knowledge', icon: 'circle-stack', onPress: () => setAttachMode('knowledge') },
    { key: 'chats', label: 'Reference Chats', icon: 'chat-bubble-left-right', onPress: () => setAttachMode('chats') },
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
  const setSkill = (id: string, on: boolean) =>
    updateDraft(draftKey, (current) => ({ ...current, skillIds: on ? [...current.skillIds.filter((item) => item !== id), id] : current.skillIds.filter((item) => item !== id) }));
  const setFilter = (id: string, on: boolean) =>
    updateDraft(draftKey, (current) => ({ ...current, filterIds: on ? [...current.filterIds.filter((item) => item !== id), id] : current.filterIds.filter((item) => item !== id) }));
  // Choosing a system switches the code interpreter off, as on the web; null stops using one.
  const pickSystem = (id: string | null) => {
    chooseTerminal(account, id);
    if (id) setToggle('codeInterpreter', false);
  };
  const removeAttachment = (index: number) =>
    updateDraft(draftKey, (current) => {
      const itemId = current.files[index]?.itemId;
      const previews = { ...current.previews };
      if (itemId) delete previews[itemId];
      return { ...current, files: current.files.filter((_, at) => at !== index), previews };
    });

  const submit = async () => {
    if (!canSend) return;
    const message = { text: draft.text, files: draft.files, toggles, toolIds, skillIds, filterIds, ...(atModel ? { atModelId: atModel.id } : {}) };
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
      {menus.trigger && (menus.entries.length > 0 || menus.loading || menus.trigger.query.length > 0) ? (
        <MentionMenu entries={menus.entries} loading={menus.loading} empty={menus.empty} />
      ) : null}
      <View style={[styles.box, { borderColor: palette.border, backgroundColor: palette.background }]}>
        {atModel ? (
          <View style={styles.atRow}>
            <Text style={[styles.atText, { color: palette.textMuted }]} numberOfLines={1}>
              {`Talking to @${atModel.name ?? atModel.id}`}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop talking to this model"
              hitSlop={8}
              onPress={() => updateDraft(draftKey, (current) => ({ ...current, atModel: null }))}>
              <Icon name="x-mark" size={14} color={palette.textMuted} />
            </Pressable>
          </View>
        ) : null}
        <AttachmentStrip files={draft.files} previews={draft.previews} baseUrl={session.baseUrl} token={session.token} onRemove={removeAttachment} onOpen={setPreviewIndex} />
        <View>
          <TextInput
            ref={input}
            value={field.value}
            onChangeText={field.onChangeText}
            onSelectionChange={(event) => setCursor(event.nativeEvent.selection.end)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
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
          <SideScroll showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
            {chipKeys.map((key) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={always.includes(key) ? `${TOGGLE_INFO[key].label} always on` : `${TOGGLE_INFO[key].label} on. Turn off`}
                disabled={always.includes(key)}
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
            {systems.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={system ? `System: ${terminalLabel(system)}. Change` : 'System: none. Choose one'}
                onPress={() => setSheetOpen(true)}
                style={[styles.chip, styles.systemChip, system ? { backgroundColor: palette.active } : { borderWidth: 1, borderColor: palette.border }]}>
                <Icon name="cloud" size={16} color={system ? palette.onActive : palette.textMuted} />
                {system ? (
                  <Text style={[styles.systemName, { color: palette.onActive }]} numberOfLines={1}>
                    {terminalLabel(system)}
                  </Text>
                ) : null}
              </Pressable>
            ) : null}
          </SideScroll>
          {knobModels.length ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Model controls" onPress={() => setKnobsOpen(true)} hitSlop={6} style={styles.knobs}>
              <Icon name="adjustments-vertical" size={16} color={palette.textMuted} />
            </Pressable>
          ) : null}
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
      {attach.pictureElement}
      <AttachSheet mode={attachMode} draftKey={draftKey} chatId={draftKey} onClose={() => setAttachMode(null)} />
      <FilePreviewSheet
        file={previewIndex !== null ? (draft.files[previewIndex] ?? null) : null}
        onClose={() => setPreviewIndex(null)}
        onChange={(change) =>
          updateDraft(draftKey, (current) => ({ ...current, files: current.files.map((file, index) => (index === previewIndex ? { ...file, ...change } : file)) }))
        }
      />
      {knobModels.length ? <ModelControlsSheet visible={knobsOpen} models={knobModels} onClose={() => setKnobsOpen(false)} /> : null}
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
      <PromptVariablesSheet variables={menus.form} onCancel={menus.cancelForm} onInsert={menus.insertForm} />
      <IntegrationsSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        available={available}
        always={always}
        toggles={toggles}
        onToggle={setToggle}
        tools={usable}
        toolIds={toolIds}
        onToggleTool={setTool}
        skills={activeSkills.length ? { list: activeSkills, chosen: skillIds, onToggle: setSkill } : undefined}
        filters={filters.length ? { list: filters, chosen: filterIds, onToggle: setFilter } : undefined}
        approval={approvalsOn ? { mode: approvalMode, onChange: setApprovalMode } : undefined}
        systems={systems.length > 0 ? { list: systems, chosenId: system?.id ?? null, onChoose: pickSystem } : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 6 },
  box: { borderWidth: 1, borderRadius: 26, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: 6 },
  input: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, maxHeight: 160, paddingTop: 2, paddingBottom: 2 },
  inputBesideExpand: { paddingRight: 30 },
  atRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  atText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 13 },
  expand: { position: 'absolute', top: -2, right: -6, width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  round: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chips: { flexGrow: 1, flexShrink: 1 },
  chipsContent: { alignItems: 'center', gap: 6 },
  chip: { height: 30, minWidth: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  toolChip: { flexDirection: 'row', gap: 3, paddingHorizontal: 9 },
  chipCount: { fontFamily: fonts.semibold, fontSize: 12 },
  systemChip: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, maxWidth: 150 },
  systemName: { fontFamily: fonts.medium, fontSize: 12, flexShrink: 1 },
  model: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, maxWidth: '45%' },
  knobs: { paddingHorizontal: 2 },
  modelText: { fontFamily: fonts.medium, fontSize: 13, flexShrink: 1 },
  send: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 11, height: 11, borderRadius: 2 },
});
