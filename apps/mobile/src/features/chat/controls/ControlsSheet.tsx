import { attachmentName, paramsFor, withParam, withSystemPrompt, type ChatHistory, type ModelItem } from '@maviechat/owui-protocol';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useCapabilities } from '@/lib/server';
import { useStoredState } from '@/lib/storedState';
import { fonts, radius, usePalette } from '@/theme';
import { OverviewList } from './OverviewList';
import { ParamRow } from './ParamRow';
import { ValvesPanel } from './ValvesPanel';

export interface ControlChanges {
  params?: Record<string, unknown>;
  files?: unknown[];
}

interface ControlsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The chat's own system prompt and parameters (`chat.params`). */
  params: Record<string, unknown>;
  /** The documents the chat keeps sending (`chat.files`). */
  files: unknown[];
  /** What changed, a moment after you stop (and when the sheet closes). */
  onChange: (changes: ControlChanges) => void;
  /** The chat's tree, for the Overview tab (a chat with messages only). */
  overview?: { history: ChatHistory; leafId: string | null; models: ModelItem[] | undefined; onShow: (messageId: string) => void };
}

/** The web app's chat controls as a full-height sheet: Controls (files, valves, system prompt, parameters) and Overview. */
export function ControlsSheet({ visible, onClose, ...rest }: ControlsSheetProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <ControlsBody onClose={onClose} {...rest} /> : null}
    </Modal>
  );
}

const SAVE_DELAY = 400;

function ControlsBody({ onClose, params: initialParams, files: initialFiles, onChange, overview }: Omit<ControlsSheetProps, 'visible'>) {
  const palette = usePalette();
  const capabilities = useCapabilities();
  const [tab, setTab] = useStoredState<'controls' | 'overview'>('controls.tab', 'controls');
  // Edited here while the sheet is open; the chat gets them a moment after each change.
  const [params, setParams] = useState(initialParams);
  const [files, setFiles] = useState(initialFiles);
  const pending = useRef<ControlChanges | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  });

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) changed.current(pending.current);
    pending.current = null;
  };
  // Closing saves what's left.
  useEffect(() => flush, []);

  const apply = (changes: ControlChanges) => {
    if (changes.params) setParams(changes.params);
    if (changes.files) setFiles(changes.files);
    pending.current = { ...pending.current, ...changes };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  };

  const allowed = (permission: string) => capabilities?.can(permission, true) ?? false;
  const controls = allowed('chat.controls');
  const hasOverview = Boolean(overview && Object.keys(overview.history.messages).length > 0);
  const shown = !controls ? 'overview' : tab === 'overview' && hasOverview ? 'overview' : 'controls';
  const specs = paramsFor(capabilities?.isAdmin ?? false);
  const common = specs.filter((spec) => !spec.ollama);
  const ollama = specs.filter((spec) => spec.ollama);
  const paramRow = (spec: (typeof specs)[number]) => (
    <ParamRow key={spec.key} spec={spec} value={params[spec.key]} onChange={(value) => apply({ params: withParam(params, spec.key, value) })} />
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <View style={styles.tabs}>
          {controls ? <TabButton label="Controls" selected={shown === 'controls'} onPress={() => setTab('controls')} /> : null}
          {hasOverview ? <TabButton label="Overview" selected={shown === 'overview'} onPress={() => setTab('overview')} /> : null}
        </View>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={[styles.done, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      {shown === 'overview' && overview ? (
        <OverviewList history={overview.history} leafId={overview.leafId} models={overview.models} onShow={overview.onShow} />
      ) : !controls ? (
        <Text style={[styles.empty, { color: palette.textMuted }]}>Chat controls are turned off for your account.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {files.length > 0 ? (
            <Section id="files" title="Files" initiallyOpen>
              <Text style={[styles.note, { color: palette.textMuted }]}>Documents this chat sends with each message. Remove one to stop sending it.</Text>
              {files.map((file, index) => (
                <View key={(file as { id?: string }).id ?? index} style={[styles.file, { borderColor: palette.border }]}>
                  <Icon name="document-text" size={18} color={palette.textMuted} />
                  <Text style={[styles.fileName, { color: palette.text }]} numberOfLines={1}>
                    {attachmentName(file)}
                  </Text>
                  <IconButton icon="x-mark" label={`Stop sending ${attachmentName(file)}`} size={16} color={palette.textMuted} onPress={() => apply({ files: files.filter((_, i) => i !== index) })} />
                </View>
              ))}
            </Section>
          ) : null}
          {allowed('chat.valves') ? (
            <Section id="valves" title="Valves" initiallyOpen={false}>
              <ValvesPanel />
            </Section>
          ) : null}
          {allowed('chat.system_prompt') ? (
            <Section id="system" title="System Prompt" initiallyOpen>
              <TextInput
                value={typeof params.system === 'string' ? params.system : ''}
                onChangeText={(text) => apply({ params: withSystemPrompt(params, text) })}
                placeholder="Enter a system prompt for this chat"
                placeholderTextColor={palette.textFaint}
                multiline
                textAlignVertical="top"
                style={[styles.system, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
                accessibilityLabel="System prompt"
              />
              <Text style={[styles.note, { color: palette.textFaint }]}>Left empty, your default system prompt (Settings) applies.</Text>
            </Section>
          ) : null}
          {allowed('chat.params') ? (
            <Section id="params" title="Advanced Params" initiallyOpen>
              <Text style={[styles.note, { color: palette.textMuted }]}>For this chat only. Default uses your settings, then the model&apos;s.</Text>
              {common.map(paramRow)}
              {ollama.length > 0 ? (
                <Section id="ollama" title="For Ollama Models" initiallyOpen={false} nested>
                  {ollama.map(paramRow)}
                </Section>
              ) : null}
            </Section>
          ) : null}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

function TabButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tab, selected && { backgroundColor: palette.surfaceStrong }]}>
      <Text style={[styles.tabText, { color: selected ? palette.text : palette.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

/** A section that opens and closes; whether it's open is remembered while the app runs. */
function Section({ id, title, initiallyOpen, nested = false, children }: { id: string; title: string; initiallyOpen: boolean; nested?: boolean; children: ReactNode }) {
  const palette = usePalette();
  const [open, setOpen] = useStoredState(`controls.section.${id}`, initiallyOpen);
  return (
    <View style={[styles.section, !nested && { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.sectionHeader}>
        <Text style={[nested ? styles.nestedTitle : styles.sectionTitle, { color: nested ? palette.textMuted : palette.text }]}>{title}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={palette.textFaint} />
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 12, paddingRight: 20, paddingTop: 14, paddingBottom: 8 },
  tabs: { flexDirection: 'row', gap: 4 },
  tab: { borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 7 },
  tabText: { fontFamily: fonts.semibold, fontSize: 15 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  empty: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 40, paddingHorizontal: 32 },
  content: { paddingHorizontal: 16, paddingBottom: 48 },
  section: { paddingVertical: 4 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  sectionTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  nestedTitle: { fontFamily: fonts.medium, fontSize: 14 },
  sectionBody: { gap: 8, paddingBottom: 12 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingLeft: 10 },
  fileName: { flex: 1, fontFamily: fonts.regular, fontSize: 14 },
  system: { minHeight: 96, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: 10, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
});
