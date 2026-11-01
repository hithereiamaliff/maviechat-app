import { sameSelection, type DtChatTool, type DtLlmOption, type DtLlmSelection } from '@maviechat/deeptutor-protocol';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/Icon';
import { updateDraft, useDraftText } from '@/features/chat/drafts';
import { fonts, radius, usePalette } from '@/theme';

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

interface DtComposerProps {
  /** Which chat's draft this is (`dt:new` on the new-chat screen). */
  draftKey: string;
  running: boolean;
  /** Resolves true when the message went out (the input stays cleared). */
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  tools: DtChatTool[] | undefined;
  selectedTools: string[];
  onToolsChange: (names: string[]) => void;
  models: DtLlmOption[] | undefined;
  model: DtLlmSelection | null;
  onModelChange: (model: DtLlmSelection) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * DeepTutor's input: the text, then a tray with the chat's tools and model, and send or stop.
 * The text is kept per chat while the app runs.
 */
export function DtComposer({
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
  placeholder = 'Ask DeepTutor anything',
  autoFocus = false,
}: DtComposerProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const text = useDraftText(draftKey);
  const [sending, setSending] = useState(false);
  const [sheet, setSheet] = useState<'tools' | 'model' | null>(null);
  const canSend = text.trim().length > 0 && !sending && !running;
  const modelLabel = models?.find((option) => sameSelection(option, model))?.label ?? (models?.length ? 'Choose a model' : 'Default model');
  const usable = tools ?? [];
  const chosen = selectedTools.filter((name) => usable.some((tool) => tool.name === name));

  const submit = async () => {
    const message = text.trim();
    if (!message || sending || running) return;
    setSending(true);
    updateDraft(draftKey, (draft) => ({ ...draft, text: '' }));
    const sent = await onSend(message);
    // A message that didn't go out comes back for another try.
    if (!sent) updateDraft(draftKey, (draft) => ({ ...draft, text: draft.text || message }));
    setSending(false);
  };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={[styles.box, { borderColor: palette.border, backgroundColor: palette.background }]}>
        <TextInput
          value={text}
          onChangeText={(value) => updateDraft(draftKey, (draft) => ({ ...draft, text: value }))}
          placeholder={placeholder}
          placeholderTextColor={palette.textFaint}
          multiline
          autoFocus={autoFocus}
          style={[styles.input, { color: palette.text }]}
          accessibilityLabel="Message"
        />
        <View style={styles.row}>
          {usable.length > 0 ? (
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
});
