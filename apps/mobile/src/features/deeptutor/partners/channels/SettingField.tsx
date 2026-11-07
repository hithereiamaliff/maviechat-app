import { linesToList, shownSetting, type DtChannelField } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { showActionSheet } from '@/components/dialogs';
import { fonts, radius, usePalette } from '@/theme';

/** Our words for the settings every chat app has; the rest keep DeepTutor's. */
const LABELS: Record<string, { label: string; help?: string }> = {
  enabled: { label: 'On', help: 'It listens in this app while the partner runs.' },
  allow_from: { label: 'Who may talk to it', help: 'Their IDs in this app, one a line; * lets anyone. Needed while it’s on.' },
  send_progress: { label: 'Send its progress', help: 'Its narration while it works, as messages.' },
  send_tool_hints: { label: 'Send tool hints', help: 'A line when it uses a tool.' },
  streaming: { label: 'Stream replies', help: 'Edit the reply in place as it’s written (needs its progress on).' },
};

type Tree = Record<string, unknown>;

/**
 * One setting of a chat app, drawn from DeepTutor's schema: a switch, a choice, a list (a line
 * each), a number, text (secrets hidden until shown), a group of settings, or JSON for the rest.
 */
export function SettingField({ field, config, onChange }: { field: DtChannelField; config: Tree; onChange: (path: string, value: unknown) => void }) {
  const palette = usePalette();
  const words = LABELS[field.key];
  const label = words?.label ?? field.label;
  const help = words?.help ?? field.help;
  const value = shownSetting(config, field);
  const [revealed, setRevealed] = useState(false);
  const [jsonDraft, setJsonDraft] = useState<string | null>(null);
  const [numberDraft, setNumberDraft] = useState<string | null>(null);
  const [linesDraft, setLinesDraft] = useState<string | null>(null);

  const caption = (
    <>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      {help ? <Text style={[styles.help, { color: palette.textMuted }]}>{help}</Text> : null}
    </>
  );

  switch (field.kind) {
    case 'boolean':
      return (
        <View style={styles.switchRow}>
          <View style={styles.flex}>{caption}</View>
          <Switch accessibilityLabel={label} value={value === true} onValueChange={(on) => onChange(field.path, on)} />
        </View>
      );
    case 'choice':
      return (
        <View style={styles.field}>
          {caption}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${String(value ?? '')}`}
            onPress={() =>
              showActionSheet({ title: label, options: [...field.options, 'Cancel'], cancelButtonIndex: field.options.length }, (index) => {
                const picked = field.options[index];
                if (picked !== undefined) onChange(field.path, picked);
              })
            }
            style={[styles.input, styles.choice, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Text style={[styles.value, { color: palette.text }]}>{value === null || value === undefined ? 'Default' : String(value)}</Text>
            <Icon name="chevron-down" size={14} color={palette.textMuted} />
          </Pressable>
        </View>
      );
    case 'lines': {
      const list = Array.isArray(value) ? value.map(String) : [];
      return (
        <View style={styles.field}>
          {caption}
          <TextInput
            value={linesDraft ?? list.join('\n')}
            onChangeText={(text) => {
              setLinesDraft(text);
              onChange(field.path, linesToList(text));
            }}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={label}
            style={[styles.input, styles.multiline, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
        </View>
      );
    }
    case 'integer':
    case 'number':
      return (
        <View style={styles.field}>
          {caption}
          <TextInput
            value={numberDraft ?? (value === null || value === undefined ? '' : String(value))}
            onChangeText={(text) => {
              setNumberDraft(text);
              const parsed = field.kind === 'integer' ? Number.parseInt(text, 10) : Number.parseFloat(text);
              onChange(field.path, text.trim() === '' ? (field.nullable ? null : 0) : Number.isFinite(parsed) ? parsed : value);
            }}
            keyboardType={field.kind === 'integer' ? 'number-pad' : 'decimal-pad'}
            accessibilityLabel={label}
            style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
        </View>
      );
    case 'group':
      return (
        <View style={[styles.group, { borderColor: palette.border }]}>
          {caption}
          {field.fields.map((child) => (
            <SettingField key={child.path} field={child} config={config} onChange={onChange} />
          ))}
        </View>
      );
    case 'json': {
      let problem = '';
      if (jsonDraft !== null) {
        try {
          JSON.parse(jsonDraft);
        } catch {
          problem = 'This isn’t valid JSON yet: it isn’t kept until it is.';
        }
      }
      return (
        <View style={styles.field}>
          {caption}
          <TextInput
            value={jsonDraft ?? JSON.stringify(value ?? field.fallback, null, 2)}
            onChangeText={(text) => {
              setJsonDraft(text);
              try {
                onChange(field.path, JSON.parse(text));
              } catch {
                // kept as typed until it's valid
              }
            }}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={label}
            style={[styles.input, styles.multiline, styles.mono, { color: palette.text, borderColor: problem ? palette.danger : palette.border, backgroundColor: palette.surface }]}
          />
          {problem ? <Text style={[styles.help, { color: palette.danger }]}>{problem}</Text> : null}
        </View>
      );
    }
    default:
      return (
        <View style={styles.field}>
          {caption}
          <View style={[styles.input, styles.textRow, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <TextInput
              value={value === null || value === undefined ? '' : String(value)}
              onChangeText={(text) => onChange(field.path, text === '' && field.nullable ? null : text)}
              secureTextEntry={field.secret && !revealed}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={label}
              style={[styles.flex, styles.value, { color: palette.text }]}
            />
            {field.secret ? (
              <Pressable accessibilityRole="button" accessibilityLabel={revealed ? `Hide ${label}` : `Show ${label}`} onPress={() => setRevealed(!revealed)} hitSlop={8}>
                <Icon name={revealed ? 'eye-slash' : 'eye'} size={16} color={palette.textMuted} />
              </Pressable>
            ) : null}
          </View>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  field: { gap: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontFamily: fonts.medium, fontSize: 14 },
  help: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  mono: { fontFamily: fonts.mono, fontSize: 13 },
  choice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  textRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 0, minHeight: 42 },
  value: { fontFamily: fonts.regular, fontSize: 15 },
  group: { gap: 10, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
});
