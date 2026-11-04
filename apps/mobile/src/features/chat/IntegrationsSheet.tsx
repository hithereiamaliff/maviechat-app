import type { FeatureToggles, ToggleKey, ToolItem } from '@maviechat/owui-protocol';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/Icon';
import { fonts, radius, usePalette } from '@/theme';

export const TOGGLE_INFO: Record<ToggleKey, { label: string; hint: string; icon: IconName }> = {
  webSearch: { label: 'Web Search', hint: 'Search the internet', icon: 'globe-alt' },
  imageGeneration: { label: 'Image', hint: 'Generate an image', icon: 'photo' },
  codeInterpreter: { label: 'Code Interpreter', hint: 'Execute code for analysis', icon: 'command-line' },
};

const ORDER: ToggleKey[] = ['webSearch', 'imageGeneration', 'codeInterpreter'];

const APPROVAL_MODES: { value: 'full' | 'ask'; label: string; hint: string; icon: IconName }[] = [
  { value: 'full', label: 'Full access', hint: 'Tools run without asking.', icon: 'bolt' },
  { value: 'ask', label: 'Ask for approval', hint: 'The reply stops before each tool until you allow or deny it.', icon: 'shield-check' },
];

/** The web app's integrations menu as a bottom sheet: web search, image, code interpreter and tools. */
export function IntegrationsSheet({
  visible,
  onClose,
  available,
  toggles,
  onToggle,
  tools,
  toolIds,
  onToggleTool,
  approval,
  always = [],
}: {
  visible: boolean;
  onClose: () => void;
  available: Record<ToggleKey, boolean>;
  toggles: FeatureToggles;
  onToggle: (key: ToggleKey, on: boolean) => void;
  tools: ToolItem[];
  toolIds: string[];
  onToggleTool: (id: string, on: boolean) => void;
  /** Tool permissions, when the server allows them. */
  approval?: { mode: 'full' | 'ask'; onChange: (mode: 'full' | 'ask') => void };
  /** On for every message by your settings ("always search the web"): shown on, not switchable here. */
  always?: ToggleKey[];
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const shown = ORDER.filter((key) => available[key]);

  const row = (key: string, icon: IconName, label: string, hint: string | null | undefined, on: boolean, change: (on: boolean) => void, locked = false) => (
    <View key={key} style={styles.row}>
      <Icon name={icon} size={20} color={palette.textMuted} />
      <View style={styles.rowText}>
        <Text style={[styles.label, { color: palette.text }]} numberOfLines={1}>
          {label}
        </Text>
        {hint ? (
          <Text style={[styles.hint, { color: palette.textMuted }]} numberOfLines={2}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch value={on} onValueChange={change} accessibilityLabel={label} disabled={locked} />
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} onPress={onClose} accessibilityLabel="Close integrations" />
      <View style={[styles.sheet, { backgroundColor: palette.menu, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]}>Integrations</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={[styles.done, { color: palette.link }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.list}>
          {shown.map((key) =>
            always.includes(key)
              ? row(key, TOGGLE_INFO[key].icon, TOGGLE_INFO[key].label, 'Always on, by your Interface settings', true, () => undefined, true)
              : row(key, TOGGLE_INFO[key].icon, TOGGLE_INFO[key].label, TOGGLE_INFO[key].hint, Boolean(toggles[key]), (on) => onToggle(key, on)),
          )}
          {tools.length > 0 ? (
            <>
              <Text style={[styles.section, { color: palette.textFaint }]}>Tools</Text>
              {tools.map((tool) =>
                row(tool.id, 'wrench-screwdriver', tool.name || tool.id, tool.meta?.description, toolIds.includes(tool.id), (on) =>
                  onToggleTool(tool.id, on),
                ),
              )}
            </>
          ) : null}
          {approval ? (
            <>
              <Text style={[styles.section, { color: palette.textFaint }]}>Tool permissions</Text>
              {APPROVAL_MODES.map((mode) => {
                const on = approval.mode === mode.value;
                return (
                  <Pressable key={mode.value} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => approval.onChange(mode.value)} style={styles.row}>
                    <Icon name={mode.icon} size={20} color={palette.textMuted} />
                    <View style={styles.rowText}>
                      <Text style={[styles.label, { color: palette.text }]}>{mode.label}</Text>
                      <Text style={[styles.hint, { color: palette.textMuted }]}>{mode.hint}</Text>
                    </View>
                    {on ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
                  </Pressable>
                );
              })}
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '75%',
    borderTopLeftRadius: radius.lg * 1.5,
    borderTopRightRadius: radius.lg * 1.5,
    paddingTop: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  list: { paddingHorizontal: 20, paddingBottom: 8 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 14, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  rowText: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.medium, fontSize: 15 },
  hint: { fontFamily: fonts.regular, fontSize: 13 },
});
