import {
  customStart,
  getUserValves,
  getUserValvesSpec,
  listFunctions,
  updateUserValves,
  valveFields,
  valvesFromForm,
  valvesToForm,
  type ValveField,
  type ValvesOwner,
} from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { describeError } from '@/lib/errors';
import { useAuthed, useTools } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

/**
 * Valves, as in the web's Controls: pick a tool or function, then set its valves for your
 * account. Changes save half a second after you stop.
 */
export function ValvesPanel() {
  const palette = usePalette();
  const { client } = useAuthed();
  const tools = useTools();
  const functions = useQuery({ queryKey: ['functions'], queryFn: () => listFunctions(client), staleTime: 5 * 60_000 });
  const [owner, setOwner] = useState<ValvesOwner>('tools');
  const [selected, setSelected] = useState<string | null>(null);
  const list = owner === 'tools' ? tools : functions;
  // Tool servers have no valves here, as on the web.
  const items = (list.data ?? [])
    .filter((item) => !(owner === 'tools' && item.id.startsWith('server:')))
    .map((item) => ({ id: item.id, name: item.name || item.id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <View style={styles.panel}>
      <View style={styles.tabs}>
        {(['tools', 'functions'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: value === owner }}
            onPress={() => {
              setOwner(value);
              setSelected(null);
            }}
            style={[styles.tab, { borderColor: palette.border }, value === owner && { backgroundColor: palette.surfaceStrong }]}>
            <Text style={[styles.tabText, { color: value === owner ? palette.text : palette.textMuted }]}>{value === 'tools' ? 'Tools' : 'Functions'}</Text>
          </Pressable>
        ))}
      </View>
      {list.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {!list.isLoading && items.length === 0 ? (
        <Text style={[styles.note, { color: palette.textMuted }]}>
          {list.isError ? `Couldn't load them: ${describeError(list.error)}` : owner === 'tools' ? 'No tools on this server.' : 'No functions on this server.'}
        </Text>
      ) : null}
      {items.map((item) => (
        <View key={item.id}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: item.id === selected }}
            onPress={() => setSelected(item.id === selected ? null : item.id)}
            style={({ pressed }) => [styles.item, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <Icon name={owner === 'tools' ? 'wrench-screwdriver' : 'bolt'} size={18} color={palette.textMuted} />
            <Text style={[styles.itemText, { color: palette.text }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Icon name={item.id === selected ? 'chevron-up' : 'chevron-down'} size={14} color={palette.textFaint} />
          </Pressable>
          {item.id === selected ? <ValvesForm key={`${owner}:${item.id}`} owner={owner} id={item.id} /> : null}
        </View>
      ))}
    </View>
  );
}

function ValvesForm({ owner, id }: { owner: ValvesOwner; id: string }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const spec = useQuery({ queryKey: ['valves-spec', owner, id], queryFn: () => getUserValvesSpec(client, owner, id) });
  const values = useQuery({ queryKey: ['valves', owner, id], queryFn: () => getUserValves(client, owner, id) });
  if (spec.isLoading || values.isLoading) return <ActivityIndicator style={styles.loading} color={palette.textMuted} />;
  if (spec.isError || values.isError) return <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't load its valves: ${describeError(spec.error ?? values.error)}`}</Text>;
  const fields = valveFields(spec.data);
  if (fields.length === 0) return <Text style={[styles.note, { color: palette.textMuted }]}>It has no settings for you.</Text>;
  return <ValvesFields owner={owner} id={id} fields={fields} initial={valvesToForm(fields, values.data ?? {})} />;
}

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

function ValvesFields({ owner, id, fields, initial }: { owner: ValvesOwner; id: string; fields: ValveField[]; initial: Record<string, unknown> }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initial);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, unknown> | null>(null);

  const save = (next: Record<string, unknown>) => {
    pending.current = null;
    const { values, invalid } = valvesFromForm(fields, next);
    if (invalid.length > 0) {
      setState({ kind: 'error', message: `Not a number: ${invalid.join(', ')}` });
      return;
    }
    setState({ kind: 'saving' });
    updateUserValves(client, owner, id, values)
      .then((saved) => {
        queryClient.setQueryData(['valves', owner, id], saved);
        setState({ kind: 'saved' });
      })
      .catch((error: unknown) => setState({ kind: 'error', message: `Couldn't save: ${describeError(error)}` }));
  };

  // Leaving with a change not yet saved saves it.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) save(pending.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const change = (key: string, value: unknown) => {
    const next = { ...form, [key]: value };
    setForm(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), 500);
  };

  return (
    <View style={styles.fields}>
      {fields.map((field) => (
        <ValveRow key={field.key} field={field} value={form[field.key]} onChange={(value) => change(field.key, value)} />
      ))}
      <Text style={[styles.note, { color: state.kind === 'error' ? palette.danger : palette.textFaint }]}>
        {state.kind === 'saving' ? 'Saving…' : state.kind === 'saved' ? 'Saved for your account.' : state.kind === 'error' ? state.message : 'Changes save as you make them.'}
      </Text>
    </View>
  );
}

/** One valve: Default (or None) until switched to Custom, then the input its kind needs (secrets hidden). */
export function ValveRow({ field, value, onChange }: { field: ValveField; value: unknown; onChange: (value: unknown) => void }) {
  const palette = usePalette();
  const custom = value !== null && value !== undefined;
  const input = [styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];
  let editor = null;
  if (custom) {
    if (field.kind === 'boolean') {
      editor = (
        <View style={styles.switchRow}>
          <Text style={[styles.note, { color: palette.textMuted }]}>{value === true ? 'Enabled' : 'Disabled'}</Text>
          <Switch value={value === true} onValueChange={onChange} accessibilityLabel={field.title} />
        </View>
      );
    } else if (field.kind === 'select' || field.kind === 'multiselect') {
      const chosen = field.kind === 'multiselect' ? (Array.isArray(value) ? value.map(String) : []) : [String(value)];
      editor = (
        <View style={styles.options}>
          {field.options.map((option) => {
            const on = chosen.includes(option.value);
            return (
              <Pressable
                key={option.value}
                accessibilityRole={field.kind === 'multiselect' ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: on }}
                onPress={() =>
                  onChange(field.kind === 'multiselect' ? (on ? chosen.filter((item) => item !== option.value) : [...chosen, option.value]) : option.value)
                }
                style={[styles.option, { borderColor: palette.border }, on && { backgroundColor: palette.active, borderColor: palette.active }]}>
                <Text style={[styles.optionText, { color: on ? palette.onActive : palette.text }]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      );
    } else {
      editor = (
        <View style={styles.inputRow}>
          {field.kind === 'color' && /^#[0-9a-f]{3,8}$/i.test(String(value)) ? <View style={[styles.swatch, { backgroundColor: String(value), borderColor: palette.border }]} /> : null}
          <TextInput
            value={String(value)}
            onChangeText={onChange}
            secureTextEntry={field.kind === 'password'}
            keyboardType={field.kind === 'number' || field.kind === 'integer' ? 'numbers-and-punctuation' : 'default'}
            multiline={field.kind === 'text'}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={field.kind === 'list' ? 'Separate items with commas' : field.kind === 'color' ? '#FF0000' : field.title}
            placeholderTextColor={palette.textFaint}
            style={[input, styles.flex]}
            accessibilityLabel={field.title}
          />
        </View>
      );
    }
  }
  return (
    <View style={styles.valve}>
      <View style={styles.valveTop}>
        <Text style={[styles.valveTitle, { color: palette.text }]}>
          {field.title}
          {field.required ? <Text style={{ color: palette.textFaint }}> (required)</Text> : null}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${field.title}: ${custom ? 'Custom' : field.required ? 'None' : 'Default'}`}
          onPress={() => onChange(custom ? null : customStart(field))}
          style={[styles.mode, { borderColor: palette.border }, custom && { backgroundColor: palette.surfaceStrong }]}>
          <Text style={[styles.modeText, { color: custom ? palette.text : palette.textMuted }]}>{custom ? 'Custom' : field.required ? 'None' : 'Default'}</Text>
        </Pressable>
      </View>
      {field.description ? <Text style={[styles.note, { color: palette.textMuted }]}>{field.description}</Text> : null}
      {editor}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 6 },
  tabs: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  tab: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  tabText: { fontFamily: fonts.medium, fontSize: 13 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  loading: { marginVertical: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  itemText: { flex: 1, fontFamily: fonts.medium, fontSize: 14 },
  fields: { gap: 14, paddingVertical: 12, paddingLeft: 4 },
  valve: { gap: 6 },
  valveTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  valveTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 14 },
  mode: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  modeText: { fontFamily: fonts.medium, fontSize: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  optionText: { fontFamily: fonts.medium, fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { minHeight: 40, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8, fontFamily: fonts.regular, fontSize: 14 },
  flex: { flex: 1 },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
});
