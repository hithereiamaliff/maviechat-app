import type { Agent } from '@maviechat/opencode-protocol';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { MenuTrigger } from '@/components/Menu';
import { fonts, radius, usePalette } from '@/theme';
import type { ModelChoice } from './queries';

export interface ModelPick {
  providerID: string;
  modelID: string;
}

const sameModel = (a: ModelPick | null, b: ModelPick) => a?.providerID === b.providerID && a.modelID === b.modelID;

/** Every model OpenCode can use here, by provider; the one in use ticked. */
function ModelSheet({ models, value, onPick, onClose }: { models: ModelChoice[]; value: ModelPick | null; onPick: (model: ModelPick) => void; onClose: () => void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const providers = [...new Set(models.map((model) => model.provider))];
  return (
    <View style={[styles.sheet, { backgroundColor: palette.background, paddingBottom: insets.bottom + 12 }]}>
      <View style={[styles.sheetHeader, { borderBottomColor: palette.border }]}>
        <Text style={[styles.sheetTitle, { color: palette.text }]}>Model</Text>
        <IconButton icon="x-mark" label="Close" onPress={onClose} />
      </View>
      <ScrollView>
        {providers.map((provider) => (
          <View key={provider}>
            <Text style={[styles.section, { color: palette.textMuted }]}>{provider}</Text>
            {models
              .filter((model) => model.provider === provider)
              .map((model) => (
                <Pressable
                  key={`${model.providerID}/${model.modelID}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sameModel(value, model) }}
                  onPress={() => {
                    onPick({ providerID: model.providerID, modelID: model.modelID });
                    onClose();
                  }}
                  style={({ pressed }) => [styles.modelRow, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
                  <Text style={[styles.modelName, { color: palette.text }]} numberOfLines={1}>
                    {model.name}
                  </Text>
                  {sameModel(value, model) ? <Icon name="check" size={18} color={palette.link} strokeWidth={2} /> : null}
                </Pressable>
              ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Where you write to OpenCode: the text, which model and agent answer, and send, or stop while
 * it works. `onSend` resolves true when the prompt went out, which clears the text.
 */
export function OcComposer({
  working,
  models,
  model,
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
  const current = models.find((item) => model && sameModel(model, item));

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
        <Pressable accessibilityRole="button" accessibilityLabel={`Model: ${current?.name ?? 'default'}`} onPress={() => setPicking(true)} style={[styles.chip, styles.modelChip, { borderColor: palette.border }]}>
          <Icon name="cpu-chip" size={14} color={palette.textMuted} />
          <Text style={[styles.chipText, { color: palette.text }]} numberOfLines={1}>
            {current?.name ?? 'Default model'}
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
        {picking ? <ModelSheet models={models} value={model} onPick={onModel} onClose={() => setPicking(false)} /> : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, gap: 6 },
  input: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, maxHeight: 180, minHeight: 24 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flex: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  modelChip: { flexShrink: 1 },
  chipText: { fontFamily: fonts.medium, fontSize: 13 },
  send: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 16, marginBottom: 4, marginHorizontal: 16 },
  modelRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  modelName: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
});
