import { OcHttpError, type Agent } from '@maviechat/opencode-protocol';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MenuTrigger } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { fonts, radius, usePalette } from '@/theme';
import { describeOcError } from './errors';
import { modelSections, type ModelChoice } from './models';
import { useSetDefaultModel } from './queries';

export interface ModelPick {
  providerID: string;
  modelID: string;
}

const sameModel = (a: ModelPick | null, b: ModelPick) => a?.providerID === b.providerID && a.modelID === b.modelID;

/**
 * Every model OpenCode can use, under its provider (providers and models A to Z), with a search
 * that keeps what it finds under the provider too. The one in use is ticked, the default marked,
 * and Set as Default makes the ticked one the machine's default (after a warning).
 */
function ModelSheet({
  models,
  value,
  defaultModel,
  onPick,
  onClose,
}: {
  models: ModelChoice[];
  value: ModelPick | null;
  defaultModel: ModelPick | null;
  onPick: (model: ModelPick) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const sections = useMemo(() => modelSections(models, query), [models, query]);
  const typed = query.trim();
  const toast = useToast();
  const setDefault = useSetDefaultModel();
  const [saving, setSaving] = useState(false);
  // The ticked model can become the machine's default, when it isn't already.
  const chosen = value ? models.find((item) => sameModel(value, item)) : undefined;
  const offerDefault = Boolean(chosen && !sameModel(defaultModel, chosen));

  const save = async (model: ModelChoice) => {
    setSaving(true);
    try {
      await setDefault({ providerID: model.providerID, modelID: model.modelID });
      toast(`${model.name} is now the default`, 'success');
      onClose();
    } catch (error) {
      toast(error instanceof OcHttpError && error.status === 404 ? 'This machine’s gateway can’t change the default yet. Update it, then try again.' : describeOcError(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDefault = () => {
    if (!chosen) return;
    Alert.alert(
      `Make ${chosen.name} the default?`,
      'New sessions on this machine will use it, here and in OpenCode in the terminal. OpenCode reloads its projects, so a reply that’s running on this machine stops.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Set as Default', onPress: () => void save(chosen) },
      ],
    );
  };

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.sheetHeader}>
        <Text style={[styles.sheetTitle, { color: palette.text }]}>Model</Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.done, { color: palette.link }]}>Done</Text>
        </Pressable>
      </View>
      <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search models or providers"
          placeholderTextColor={palette.textFaint}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search models"
          style={[styles.searchInput, { color: palette.text }]}
        />
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(model) => `${model.providerID}/${model.modelID}`}
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionRow, { backgroundColor: palette.background }]}>
            <Text style={[styles.section, { color: palette.textMuted }]} numberOfLines={1}>
              {section.title}
            </Text>
            <Text style={[styles.count, { color: palette.textFaint }]}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const selected = sameModel(value, item);
          const isDefault = sameModel(defaultModel, item);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.provider}${isDefault ? ', the default' : ''}`}
              accessibilityState={{ selected }}
              onPress={() => {
                onPick({ providerID: item.providerID, modelID: item.modelID });
                onClose();
              }}
              style={({ pressed }) => [styles.modelRow, (pressed || selected) && { backgroundColor: palette.surface }]}>
              <Text style={[styles.modelName, { color: palette.text }]} numberOfLines={1}>
                {item.name}
              </Text>
              {isDefault ? <Text style={[styles.tag, { color: palette.textFaint }]}>default</Text> : null}
              {selected ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
            </Pressable>
          );
        }}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.modelList, { paddingBottom: offerDefault ? 12 : insets.bottom + 12 }]}
        ListEmptyComponent={<Text style={[styles.empty, { color: palette.textMuted }]}>{typed ? `No models match “${typed}”.` : 'No models found.'}</Text>}
      />
      {offerDefault && chosen ? (
        <View style={[styles.sheetFooter, { borderTopColor: palette.border, paddingBottom: insets.bottom + 12 }]}>
          <Button label={`Set ${chosen.name} as Default`} variant="secondary" loading={saving} onPress={confirmDefault} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Where you write to OpenCode: the text, which model and agent answer, and send, or stop while
 * it works. `onSend` resolves true when the prompt went out, which clears the text. Until a
 * model is picked, the chip names `defaultModel`, the one OpenCode will use.
 */
export function OcComposer({
  working,
  models,
  model,
  defaultModel = null,
  onModel,
  agents,
  agent,
  onAgent,
  onSend,
  onStop,
  placeholder = 'Ask OpenCode',
  disabled = false,
}: {
  working: boolean;
  models: ModelChoice[];
  model: ModelPick | null;
  defaultModel?: ModelPick | null;
  onModel: (model: ModelPick) => void;
  agents: Agent[];
  agent: string | null;
  onAgent: (agent: string) => void;
  onSend: (text: string) => Promise<boolean>;
  onStop?: () => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const palette = usePalette();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const shown = model ?? defaultModel;
  const current = models.find((item) => sameModel(shown, item));
  const modelLabel = current?.name ?? shown?.modelID ?? 'Default model';

  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      if (await onSend(value)) setText('');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.wrap, { borderColor: palette.border, backgroundColor: palette.background }]}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={palette.textFaint}
        multiline
        editable={!disabled}
        style={[styles.input, { color: palette.text }]}
        accessibilityLabel="Message to OpenCode"
      />
      <View style={styles.bar}>
        {agents.length > 1 ? (
          <MenuTrigger label={`Agent: ${agent ?? agents[0]?.name ?? ''}`} items={agents.map((item) => ({ key: item.name, label: item.name, icon: item.name === agent ? 'check' : 'sparkles', onPress: () => onAgent(item.name) }))}>
            <View style={[styles.chip, { borderColor: palette.border }]}>
              <Icon name="sparkles" size={14} color={palette.textMuted} />
              <Text style={[styles.chipText, { color: palette.text }]}>{agent ?? agents[0]?.name}</Text>
            </View>
          </MenuTrigger>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`Model: ${modelLabel}${model ? '' : ', the default'}`} onPress={() => setPicking(true)} style={[styles.chip, styles.modelChip, { borderColor: palette.border }]}>
          <Icon name="cpu-chip" size={14} color={palette.textMuted} />
          <Text style={[styles.chipText, { color: palette.text }]} numberOfLines={1}>
            {modelLabel}
          </Text>
        </Pressable>
        <View style={styles.flex} />
        {working && onStop && !text.trim() ? (
          <IconButton icon="stop-circle" label="Stop" onPress={onStop} size={26} color={palette.text} />
        ) : sending ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            disabled={!text.trim() || disabled}
            onPress={() => void send()}
            style={[styles.send, { backgroundColor: text.trim() && !disabled ? palette.primary : palette.surfaceStrong }]}>
            <Icon name="arrow-up" size={18} color={text.trim() && !disabled ? palette.onPrimary : palette.textFaint} strokeWidth={2} />
          </Pressable>
        )}
      </View>
      <Modal visible={picking} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicking(false)}>
        {picking ? <ModelSheet models={models} value={shown} defaultModel={defaultModel} onPick={onModel} onClose={() => setPicking(false)} /> : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // The same box as Open WebUI's composer.
  wrap: { borderWidth: 1, borderRadius: 26, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: 6 },
  input: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, maxHeight: 160, minHeight: 26, paddingTop: 2, paddingBottom: 2 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flex: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  modelChip: { flexShrink: 1 },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  // The model sheet, laid out like Open WebUI's model picker.
  sheet: { flex: 1, paddingTop: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 18 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 40, marginHorizontal: 16, marginVertical: 8, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  modelList: { paddingHorizontal: 8 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 6 },
  section: { flex: 1, fontFamily: fonts.semibold, fontSize: 13 },
  count: { fontFamily: fonts.regular, fontSize: 12 },
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 11, borderRadius: radius.md },
  modelName: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  tag: { fontFamily: fonts.regular, fontSize: 12 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 24 },
  sheetFooter: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
