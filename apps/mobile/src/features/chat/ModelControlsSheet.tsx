import { controlChoice, modelControls, withControlChoice, type ModelItem } from '@maviechat/owui-protocol';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useUserSettings } from '@/lib/server';
import { useSaveUiSettings } from '@/lib/uiSettings';
import { fonts, radius, usePalette } from '@/theme';

/**
 * The chosen models' knobs (Open WebUI 0.12's model controls), as the web's knobs button lists
 * them beside the model picker: each knob's options, or its default. A choice is saved with your
 * settings at once and goes with every message to that model.
 */
export function ModelControlsSheet({ visible, models, onClose }: { visible: boolean; models: ModelItem[]; onClose: () => void }) {
  const palette = usePalette();
  const settings = useUserSettings();
  const save = useSaveUiSettings();
  const ui = settings.data?.ui;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <View style={styles.side} />
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            Model Controls
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} style={styles.side}>
            <Text style={[styles.done, { color: palette.link }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {models.map((model) => (
            <View key={model.id} style={styles.model}>
              {models.length > 1 ? <Text style={[styles.modelName, { color: palette.textMuted }]}>{model.name ?? model.id}</Text> : null}
              {modelControls(model).map((control) => {
                const chosen = controlChoice(ui, model.id, control.key);
                const defaultLabel = control.options.find((option) => option.value === control.defaultValue)?.label;
                const pick = (value: string | null) => void save({ 'params.model_controls': withControlChoice(ui, model.id, control.key, value) });
                const row = (key: string, label: string, selected: boolean, onPress: () => void) => (
                  <Pressable
                    key={key}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={onPress}
                    style={({ pressed }) => [styles.option, (pressed || selected) && { backgroundColor: palette.surface }]}>
                    <Text style={[styles.optionText, { color: palette.text }]} numberOfLines={1}>
                      {label}
                    </Text>
                    {selected ? <Icon name="check" size={16} color={palette.text} strokeWidth={2} /> : null}
                  </Pressable>
                );
                return (
                  <View key={control.key} style={[styles.control, { borderColor: palette.border }]} accessibilityRole="radiogroup" accessibilityLabel={control.label}>
                    <Text style={[styles.label, { color: palette.text }]}>{control.label}</Text>
                    {control.description ? <Text style={[styles.description, { color: palette.textMuted }]}>{control.description}</Text> : null}
                    {row('default', defaultLabel ? `Default · ${defaultLabel}` : 'Default', chosen === null, () => pick(null))}
                    {control.options.map((option) => row(option.value, option.label, chosen === option.value, () => pick(option.value)))}
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  side: { width: 60 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  done: { textAlign: 'right', fontFamily: fonts.semibold, fontSize: 16 },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  model: { gap: 10 },
  modelName: { fontFamily: fonts.medium, fontSize: 13, marginLeft: 4 },
  control: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 12, gap: 4 },
  label: { fontFamily: fonts.semibold, fontSize: 15 },
  description: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginBottom: 4 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: 10, borderRadius: radius.md },
  optionText: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
});
