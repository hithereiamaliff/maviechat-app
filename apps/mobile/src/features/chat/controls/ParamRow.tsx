import { choiceIndex, parseParamNumber, stepParam, type ParamSpec } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { IconButton } from '@/components/IconButton';
import { fonts, radius, usePalette } from '@/theme';

interface ParamRowProps {
  spec: ParamSpec;
  value: unknown;
  /** `undefined` returns it to Default. */
  onChange: (value: unknown) => void;
}

/** A fresh copy, so a list value (reasoning tags) is never shared between chats. */
const fresh = (value: unknown) => (Array.isArray(value) ? [...(value as unknown[])] : value);

/** One advanced parameter: Default, or Custom with the value to send. */
export function ParamRow({ spec, value, onChange }: ParamRowProps) {
  const palette = usePalette();
  const custom = value !== null && value !== undefined;
  return (
    <View style={[styles.row, { borderBottomColor: palette.border }]}>
      <View style={styles.top}>
        <View style={styles.titles}>
          <Text style={[styles.label, { color: palette.text }]}>{spec.label}</Text>
          <Text style={[styles.help, { color: palette.textMuted }]}>{spec.help}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${spec.label}: ${custom ? 'Custom' : 'Default'}`}
          accessibilityHint={custom ? 'Returns it to the default' : 'Lets you set it for this chat'}
          onPress={() => onChange(custom ? undefined : fresh(spec.initial))}
          style={[styles.mode, { borderColor: palette.border }, custom && { backgroundColor: palette.surfaceStrong }]}>
          <Text style={[styles.modeText, { color: custom ? palette.text : palette.textMuted }]}>{custom ? 'Custom' : 'Default'}</Text>
        </Pressable>
      </View>
      {custom ? <ParamEditor spec={spec} value={value} onChange={onChange} /> : null}
    </View>
  );
}

function ParamEditor({ spec, value, onChange }: ParamRowProps) {
  const palette = usePalette();
  const input = [styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];
  if (spec.kind === 'number' || spec.kind === 'integer') return <NumberEditor key={String(value)} spec={spec} value={value} onChange={onChange} />;
  if (spec.kind === 'switch') {
    return (
      <View style={styles.switchRow}>
        <Text style={[styles.help, { color: palette.textMuted }]}>{value === true ? 'On' : 'Off'}</Text>
        <Switch value={value === true} onValueChange={onChange} accessibilityLabel={spec.label} />
      </View>
    );
  }
  if (spec.kind === 'text') {
    return (
      <TextInput
        value={typeof value === 'string' ? value : JSON.stringify(value)}
        onChangeText={onChange}
        placeholder={spec.label}
        placeholderTextColor={palette.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={spec.key === 'format'}
        style={input}
        accessibilityLabel={spec.label}
      />
    );
  }
  const selected = choiceIndex(spec, value);
  const choice = spec.choices?.[selected];
  return (
    <View style={styles.choiceWrap}>
      <View style={styles.choices}>
        {(spec.choices ?? []).map((option, index) => (
          <Pressable
            key={option.label}
            accessibilityRole="radio"
            accessibilityState={{ checked: index === selected }}
            onPress={() => index !== selected && onChange(fresh(option.value))}
            style={[styles.choice, { borderColor: palette.border }, index === selected && { backgroundColor: palette.active, borderColor: palette.active }]}>
            <Text style={[styles.choiceText, { color: index === selected ? palette.onActive : palette.text }]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      {choice?.edit === 'text' ? (
        <TextInput
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          placeholder="e.g. low, medium or high"
          placeholderTextColor={palette.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={input}
          accessibilityLabel={`${spec.label} level`}
        />
      ) : null}
      {choice?.edit === 'pair' && Array.isArray(value) ? (
        <View style={styles.pair}>
          {[0, 1].map((index) => (
            <TextInput
              key={index}
              value={String((value as unknown[])[index] ?? '')}
              onChangeText={(text) => onChange((value as unknown[]).map((part, i) => (i === index ? text : part)))}
              placeholder={index === 0 ? 'Start tag' : 'End tag'}
              placeholderTextColor={palette.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={[input, styles.pairInput]}
              accessibilityLabel={index === 0 ? 'Start tag' : 'End tag'}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A number: type it, or step it with − and +, kept within the parameter's range. */
function NumberEditor({ spec, value, onChange }: ParamRowProps) {
  const palette = usePalette();
  const [text, setText] = useState(String(value));
  const current = typeof value === 'number' ? value : Number(value);
  const base = Number.isFinite(current) ? current : Number(spec.initial);
  const commit = () => {
    const parsed = parseParamNumber(spec, text);
    if (parsed === null || parsed === value) setText(String(value));
    else onChange(parsed);
  };
  return (
    <View style={styles.number}>
      <IconButton icon="minus" label={`Lower ${spec.label}`} size={18} disabled={spec.min !== undefined && base <= spec.min} onPress={() => onChange(stepParam(spec, base, -1))} />
      <TextInput
        value={text}
        onChangeText={setText}
        onEndEditing={commit}
        keyboardType="numbers-and-punctuation"
        returnKeyType="done"
        selectTextOnFocus
        style={[styles.input, styles.numberInput, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
        accessibilityLabel={spec.label}
      />
      <IconButton icon="plus" label={`Raise ${spec.label}`} size={18} disabled={spec.max !== undefined && base >= spec.max} onPress={() => onChange(stepParam(spec, base, 1))} />
      {spec.min !== undefined || spec.max !== undefined ? (
        <Text style={[styles.range, { color: palette.textFaint }]}>{`${spec.min ?? '…'} to ${spec.max ?? '…'}`}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titles: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.medium, fontSize: 15 },
  help: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  mode: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  modeText: { fontFamily: fonts.medium, fontSize: 12 },
  input: { minHeight: 40, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8, fontFamily: fonts.regular, fontSize: 15 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  choiceWrap: { gap: 8 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  choiceText: { fontFamily: fonts.medium, fontSize: 13 },
  pair: { flexDirection: 'row', gap: 8 },
  pairInput: { flex: 1 },
  number: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  numberInput: { width: 96, textAlign: 'center' },
  range: { fontFamily: fonts.regular, fontSize: 12, marginLeft: 6 },
});
