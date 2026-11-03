import { sameSelection, sessionTitle, type DtChatTool, type DtKnowledgeBase, type DtLlmOption, type DtLlmSelection } from '@maviechat/deeptutor-protocol';
import { useImperativeHandle, useRef, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/Icon';
import { useAnchoredMenu, type MenuItem } from '@/components/Menu';
import { updateDraft, useDraftText } from '@/features/chat/drafts';
import { useDtAttachmentLimits, useDtNotebooks, useDtSessions } from '@/features/deeptutor/queries';
import { fonts, radius, usePalette } from '@/theme';
import { capabilityName, modeInfo } from './capabilities';
import { DtExtrasStrip, DtPickSheet, type ExtraChip, type PickItem } from './DtExtrasViews';
import { clearExtras, hasExtras, useDtAttach, type DtExtras } from './extras';

/** Our names for DeepTutor's switchable chat tools; others show their id, made readable. */
const TOOL_INFO: Record<string, { label: string; icon: IconName }> = {
  brainstorm: { label: 'Brainstorm', icon: 'light-bulb' },
  web_search: { label: 'Web search', icon: 'globe-alt' },
  reason: { label: 'Deep reasoning', icon: 'sparkles' },
  paper_search: { label: 'Paper search', icon: 'academic-cap' },
  zotero_search: { label: 'Zotero library', icon: 'book-open' },
  geogebra_analysis: { label: 'GeoGebra', icon: 'chart-bar' },
  imagegen: { label: 'Image generation', icon: 'photo' },
  videogen: { label: 'Video generation', icon: 'film' },
};

export function toolLabel(name: string): string {
  const known = TOOL_INFO[name]?.label;
  if (known) return known;
  const words = name.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function toolIcon(name: string): IconName {
  return TOOL_INFO[name]?.icon ?? 'wrench-screwdriver';
}

export interface DtComposerHandle {
  focus: () => void;
}

interface DtComposerProps {
  ref?: Ref<DtComposerHandle>;
  /** Which chat's draft this is (`dt:new` on the new-chat screen). */
  draftKey: string;
  running: boolean;
  /** Resolves true when the message went out (the input and its extras stay cleared). */
  onSend: (text: string, extras: DtExtras) => Promise<boolean>;
  onStop: () => void;
  tools: DtChatTool[] | undefined;
  selectedTools: string[];
  onToolsChange: (names: string[]) => void;
  models: DtLlmOption[] | undefined;
  model: DtLlmSelection | null;
  onModelChange: (model: DtLlmSelection) => void;
  /** The modes on offer, the current one, and its settings. */
  modes: string[];
  mode: string;
  onModeChange: (mode: string) => void;
  config: Record<string, unknown>;
  onSettingChange: (key: string, value: unknown) => void;
  /** The account's knowledge bases and the ones this chat searches. */
  knowledgeBases: DtKnowledgeBase[] | undefined;
  selectedKnowledgeBases: string[];
  onKnowledgeBasesChange: (names: string[]) => void;
  /** Kept out of the "earlier chat" list. */
  sessionId?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** In the middle of the home screen rather than at the bottom (no room kept for the home indicator). */
  floating?: boolean;
}

const PLACEHOLDERS: Record<string, string> = {
  deep_solve: 'Describe the problem',
  deep_question: 'What should the quiz cover?',
  deep_research: 'What should DeepTutor research?',
  visualize: 'What should it draw?',
  ask_questions: 'What do you need help with?',
};

/**
 * DeepTutor's input: the text, then a tray with the mode (and its settings), the chat's tools
 * and model, and send or stop. The text is kept per chat while the app runs.
 */
export function DtComposer({
  ref,
  draftKey,
  running,
  onSend,
  onStop,
  tools,
  selectedTools,
  onToolsChange,
  models,
  model,
  onModelChange,
  modes,
  mode,
  onModeChange,
  config,
  onSettingChange,
  knowledgeBases,
  selectedKnowledgeBases,
  onKnowledgeBasesChange,
  sessionId,
  placeholder,
  autoFocus = false,
  floating = false,
}: DtComposerProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
  const text = useDraftText(draftKey);
  const [sending, setSending] = useState(false);
  const [sheet, setSheet] = useState<'mode' | 'tools' | 'model' | 'notebook' | 'chat' | 'knowledge' | null>(null);
  const info = modeInfo(mode);
  const limits = useDtAttachmentLimits();
  const attach = useDtAttach(draftKey, limits.data ?? { maxFileBytes: 20 * 1024 * 1024, maxTotalBytes: 25 * 1024 * 1024 });
  const { extras, setExtras } = attach;
  const notebooks = useDtNotebooks(sheet === 'notebook');
  const chats = useDtSessions('');
  const canSend = (text.trim().length > 0 || extras.attachments.length > 0) && !sending && !running;
  const plusItems: MenuItem[] = [
    { key: 'photos', label: 'Photos', icon: 'photo', onPress: () => void attach.pickPhotos() },
    { key: 'camera', label: 'Take Photo', icon: 'camera', onPress: () => void attach.takePhoto() },
    { key: 'files', label: 'Files', icon: 'paper-clip', onPress: () => void attach.pickFiles() },
    { key: 'notebook', label: 'Notebook', icon: 'book-open', onPress: () => setSheet('notebook') },
    { key: 'chat', label: 'Earlier Chat', icon: 'chat-bubble-left', onPress: () => setSheet('chat') },
    { key: 'knowledge', label: 'Knowledge Bases', icon: 'archive-box', onPress: () => setSheet('knowledge') },
  ];
  const { ref: plusRef, open: openPlus, menu: plusMenu } = useAnchoredMenu(plusItems);
  const chips: ExtraChip[] = [
    ...extras.attachments.map((item) => ({
      key: `a${item.id}`,
      icon: 'document-text' as const,
      label: item.filename,
      image: item.preview,
      onRemove: () => setExtras({ ...extras, attachments: extras.attachments.filter((other) => other.id !== item.id) }),
    })),
    ...extras.notebooks.map((item) => ({
      key: `n${item.id}`,
      icon: 'book-open' as const,
      label: item.name,
      onRemove: () => setExtras({ ...extras, notebooks: extras.notebooks.filter((other) => other.id !== item.id) }),
    })),
    ...extras.chats.map((item) => ({
      key: `c${item.id}`,
      icon: 'chat-bubble-left' as const,
      label: item.title,
      onRemove: () => setExtras({ ...extras, chats: extras.chats.filter((other) => other.id !== item.id) }),
    })),
    ...selectedKnowledgeBases.map((name) => ({
      key: `k${name}`,
      icon: 'archive-box' as const,
      label: name,
      onRemove: () => onKnowledgeBasesChange(selectedKnowledgeBases.filter((other) => other !== name)),
    })),
  ];
  const toggle = <T extends { id: string }>(list: T[], item: T) => (list.some((other) => other.id === item.id) ? list.filter((other) => other.id !== item.id) : [...list, item]);
  const chatItems: PickItem[] = (chats.data ?? []).filter((chat) => chat.id !== sessionId).map((chat) => ({ id: chat.id, label: sessionTitle(chat) }));
  const modelLabel = models?.find((option) => sameSelection(option, model))?.label ?? (models?.length ? 'Choose a model' : 'Default model');
  const usable = tools ?? [];
  const chosen = selectedTools.filter((name) => usable.some((tool) => tool.name === name));

  const submit = async () => {
    const message = text.trim();
    if ((!message && !extras.attachments.length) || sending || running) return;
    setSending(true);
    const going = extras;
    updateDraft(draftKey, (draft) => ({ ...draft, text: '' }));
    if (hasExtras(going)) clearExtras(draftKey);
    const sent = await onSend(message, going);
    // A message that didn't go out comes back for another try, with what went with it.
    if (!sent) {
      updateDraft(draftKey, (draft) => ({ ...draft, text: draft.text || message }));
      if (hasExtras(going)) setExtras(going);
    }
    setSending(false);
  };

  return (
    <View style={[styles.wrap, !floating && { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={[styles.box, { borderColor: palette.border, backgroundColor: palette.background }]}>
        <DtExtrasStrip chips={chips} />
        <TextInput
          ref={input}
          value={text}
          onChangeText={(value) => updateDraft(draftKey, (draft) => ({ ...draft, text: value }))}
          placeholder={placeholder ?? PLACEHOLDERS[mode] ?? 'Ask DeepTutor anything'}
          placeholderTextColor={palette.textFaint}
          multiline
          autoFocus={autoFocus}
          style={[styles.input, { color: palette.text }]}
          accessibilityLabel="Message"
        />
        <View style={styles.row}>
          <Pressable
            ref={plusRef}
            accessibilityRole="button"
            accessibilityLabel="Attach photos or files, or refer to a notebook, chat or knowledge base"
            onPress={openPlus}
            hitSlop={4}
            style={({ pressed }) => [styles.round, { borderColor: palette.border }, pressed && { backgroundColor: palette.surfaceStrong }]}>
            <Icon name="plus" size={18} color={palette.textMuted} />
          </Pressable>
          {modes.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Mode: ${capabilityName(mode)}. Change mode`}
              onPress={() => setSheet('mode')}
              hitSlop={4}
              style={({ pressed }) => [
                styles.chip,
                mode === 'chat' ? { borderColor: palette.border, borderWidth: 1 } : { backgroundColor: palette.active },
                pressed && { opacity: 0.7 },
              ]}>
              <Icon name={info.icon} size={15} color={mode === 'chat' ? palette.textMuted : palette.onActive} />
              <Text style={[styles.chipText, { color: mode === 'chat' ? palette.textMuted : palette.onActive }]}>{capabilityName(mode)}</Text>
            </Pressable>
          ) : null}
          {mode === 'chat' && usable.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={chosen.length ? `${chosen.length} tools on. Change tools` : 'Tools'}
              onPress={() => setSheet('tools')}
              hitSlop={4}
              style={({ pressed }) => [
                styles.chip,
                chosen.length ? { backgroundColor: palette.active } : { borderColor: palette.border, borderWidth: 1 },
                pressed && { opacity: 0.7 },
              ]}>
              <Icon name="wrench-screwdriver" size={15} color={chosen.length ? palette.onActive : palette.textMuted} />
              <Text style={[styles.chipText, { color: chosen.length ? palette.onActive : palette.textMuted }]}>
                {chosen.length ? `Tools · ${chosen.length}` : 'Tools'}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Model: ${modelLabel}. Change model`}
            onPress={() => setSheet('model')}
            disabled={!models?.length}
            hitSlop={6}
            style={styles.model}>
            <Text style={[styles.modelText, { color: palette.textMuted }]} numberOfLines={1}>
              {modelLabel}
            </Text>
            {models?.length ? <Icon name="chevron-down" size={14} color={palette.textMuted} strokeWidth={2} /> : null}
          </Pressable>
          <View style={styles.spacer} />
          {running ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Stop generating" onPress={onStop} style={[styles.send, { backgroundColor: palette.primary }]}>
              <View style={[styles.stopSquare, { backgroundColor: palette.onPrimary }]} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: !canSend, busy: sending }}
              disabled={!canSend}
              onPress={() => void submit()}
              style={[styles.send, { backgroundColor: canSend ? palette.primary : palette.surfaceStrong }]}>
              {sending ? (
                <ActivityIndicator size="small" color={palette.onPrimary} />
              ) : (
                <Icon name="arrow-up" size={18} color={canSend ? palette.onPrimary : palette.textFaint} strokeWidth={2.2} />
              )}
            </Pressable>
          )}
        </View>
      </View>

      {plusMenu}
      <DtPickSheet
        visible={sheet === 'notebook'}
        title="Notebook"
        note="DeepTutor reads the notebooks you pick when it answers your next message."
        items={(notebooks.data ?? []).map((notebook) => ({ id: notebook.id, label: notebook.name, hint: notebook.description || undefined }))}
        selected={extras.notebooks.map((notebook) => notebook.id)}
        loading={notebooks.isLoading}
        empty="No notebooks yet. Send an Open WebUI chat to DeepTutor, or make one in the DeepTutor web app."
        onToggle={(item) => setExtras({ ...extras, notebooks: toggle(extras.notebooks, { id: item.id, name: item.label }) })}
        onClose={() => setSheet(null)}
      />
      <DtPickSheet
        visible={sheet === 'chat'}
        title="Earlier Chat"
        note="DeepTutor reads the chats you pick when it answers your next message."
        items={chatItems}
        selected={extras.chats.map((chat) => chat.id)}
        loading={chats.isLoading}
        empty="No other DeepTutor chats yet."
        onToggle={(item) => setExtras({ ...extras, chats: toggle(extras.chats, { id: item.id, title: item.label }) })}
        onClose={() => setSheet(null)}
      />
      <DtPickSheet
        visible={sheet === 'knowledge'}
        title="Knowledge Bases"
        note="This chat searches the knowledge bases you pick, until you change them."
        items={(knowledgeBases ?? []).map((kb) => ({ id: kb.name, label: kb.name, hint: kb.status || undefined }))}
        selected={selectedKnowledgeBases}
        loading={knowledgeBases === undefined}
        empty="No knowledge bases yet. Make one in the DeepTutor web app; it needs an embedding model in DeepTutor's settings."
        onToggle={(item) =>
          onKnowledgeBasesChange(selectedKnowledgeBases.includes(item.id) ? selectedKnowledgeBases.filter((name) => name !== item.id) : [...selectedKnowledgeBases, item.id])
        }
        onClose={() => setSheet(null)}
      />

      <Sheet visible={sheet === 'mode'} title="Mode" onClose={() => setSheet(null)}>
        <View style={[styles.group, { borderColor: palette.border }]}>
          {modes.map((id, index) => {
            const selected = id === mode;
            const about = modeInfo(id);
            return (
              <Pressable
                key={id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => onModeChange(id)}
                style={({ pressed }) => [
                  styles.sheetRow,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
                  pressed && { backgroundColor: palette.surface },
                ]}>
                <Icon name={about.icon} size={18} color={palette.textMuted} />
                <View style={styles.sheetText}>
                  <Text style={[styles.sheetLabel, { color: palette.text }]}>{capabilityName(id)}</Text>
                  <Text style={[styles.sheetHint, { color: palette.textFaint }]}>{about.hint}</Text>
                </View>
                {selected ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
              </Pressable>
            );
          })}
        </View>
        {info.options.map((option) => (
          <View key={option.key} style={styles.setting}>
            <Text style={[styles.settingLabel, { color: palette.textMuted }]}>{option.label}</Text>
            <View style={styles.choices}>
              {option.choices.map((choice) => {
                const selected = config[option.key] === choice.value;
                return (
                  <Pressable
                    key={String(choice.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => onSettingChange(option.key, choice.value)}
                    style={[styles.choice, selected ? { backgroundColor: palette.primary } : { borderColor: palette.border, borderWidth: 1 }]}>
                    <Text style={[styles.choiceText, { color: selected ? palette.onPrimary : palette.text }]}>{choice.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </Sheet>

      <Sheet visible={sheet === 'tools'} title="Tools" onClose={() => setSheet(null)}>
        <Text style={[styles.sheetNote, { color: palette.textMuted }]}>DeepTutor may use the tools you switch on when it answers in this chat.</Text>
        <View style={[styles.group, { borderColor: palette.border }]}>
          {usable.map((tool, index) => {
            const on = selectedTools.includes(tool.name);
            return (
              <View key={tool.name} style={[styles.sheetRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }]}>
                <Icon name={toolIcon(tool.name)} size={18} color={palette.textMuted} />
                <View style={styles.sheetText}>
                  <Text style={[styles.sheetLabel, { color: palette.text }]}>{toolLabel(tool.name)}</Text>
                  {tool.description ? (
                    <Text style={[styles.sheetHint, { color: palette.textFaint }]} numberOfLines={2}>
                      {tool.description}
                    </Text>
                  ) : null}
                </View>
                <Switch
                  accessibilityLabel={toolLabel(tool.name)}
                  value={on}
                  onValueChange={(value) => onToolsChange(value ? [...selectedTools, tool.name] : selectedTools.filter((name) => name !== tool.name))}
                />
              </View>
            );
          })}
        </View>
      </Sheet>

      <Sheet visible={sheet === 'model'} title="Model" onClose={() => setSheet(null)}>
        <View style={[styles.group, { borderColor: palette.border }]}>
          {(models ?? []).map((option, index) => {
            const selected = sameSelection(option, model);
            return (
              <Pressable
                key={`${option.profile_id}/${option.model_id}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => {
                  onModelChange({ profile_id: option.profile_id, model_id: option.model_id });
                  setSheet(null);
                }}
                style={({ pressed }) => [
                  styles.sheetRow,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
                  pressed && { backgroundColor: palette.surface },
                ]}>
                <View style={styles.sheetText}>
                  <Text style={[styles.sheetLabel, { color: palette.text }]}>{option.label}</Text>
                  <Text style={[styles.sheetHint, { color: palette.textFaint }]}>
                    {[option.profileName, option.isDefault ? 'default' : ''].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {selected ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const palette = usePalette();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: palette.text }]} accessibilityRole="header">
            {title}
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
            <Text style={[styles.done, { color: palette.link }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetContent}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 6 },
  box: { borderWidth: 1, borderRadius: 26, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: 6 },
  input: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, maxHeight: 160, paddingTop: 2, paddingBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { height: 30, borderRadius: 15, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  model: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  modelText: { fontFamily: fonts.medium, fontSize: 13, flexShrink: 1 },
  spacer: { flex: 1 },
  send: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  round: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 11, height: 11, borderRadius: 2 },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  sheetContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  sheetNote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginHorizontal: 4 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14, paddingVertical: 8 },
  sheetText: { flex: 1, gap: 2 },
  sheetLabel: { fontFamily: fonts.regular, fontSize: 15 },
  sheetHint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  setting: { gap: 8, marginTop: 6 },
  settingLabel: { fontFamily: fonts.medium, fontSize: 13, marginHorizontal: 4 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  choiceText: { fontFamily: fonts.medium, fontSize: 14 },
});
