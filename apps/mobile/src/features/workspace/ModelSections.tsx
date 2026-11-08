import {
  BUILTIN_TOOLS,
  DEFAULT_FEATURES,
  functionChoices,
  knowledgeRefFrom,
  listFunctions,
  listSkillChoices,
  MODEL_CAPABILITIES,
  paramsFor,
  searchKnowledgeBases,
  searchKnowledgeFiles,
  terminalLabel,
  voiceSuggestions,
  type CustomParam,
  type KnowledgeRef,
  type ServerVoice,
  type SuggestedPrompt,
  type TerminalServer,
  type WorkspaceCapability,
} from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { CustomParams } from '@/features/chat/controls/CustomParams';
import { ParamRow } from '@/features/chat/controls/ParamRow';
import { useDebounced } from '@/lib/useDebounced';
import { useAuthed, useTools } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

type Setter<T> = (value: T) => void;

/** A part of the editor that opens and closes. */
export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.section, { borderColor: palette.border }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.sectionHead} hitSlop={4}>
        <View style={styles.flex}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>{title}</Text>
          {note ? <Text style={[styles.note, { color: palette.textMuted }]}>{note}</Text> : null}
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={palette.textMuted} />
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

function SwitchRow({ label, note, value, disabled, onChange }: { label: string; note?: string; value: boolean; disabled?: boolean; onChange: Setter<boolean> }) {
  const palette = usePalette();
  return (
    <View style={styles.switchRow}>
      <View style={styles.flex}>
        <Text style={[styles.label, { color: disabled ? palette.textMuted : palette.text }]}>{label}</Text>
        {note ? <Text style={[styles.note, { color: palette.textMuted }]}>{note}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange} />
    </View>
  );
}

/** Its parameters (Default, or a value of its own) and custom ones by name. */
export function ParamsSection({
  params,
  setParams,
  custom,
  setCustom,
  readOnly,
  note = 'Left at Default, a chat uses the user’s or the server’s.',
}: {
  params: Record<string, unknown>;
  setParams: Setter<Record<string, unknown>>;
  custom: CustomParam[];
  setCustom: Setter<CustomParam[]>;
  readOnly: boolean;
  note?: string;
}) {
  return (
    <Section title="Parameters" note={note}>
      <View pointerEvents={readOnly ? 'none' : 'auto'} style={styles.gap}>
        {paramsFor(true).map((spec) => (
          <ParamRow
            key={spec.key}
            spec={spec}
            value={params[spec.key]}
            onChange={(value) => {
              const next = { ...params };
              if (value === undefined || value === null) delete next[spec.key];
              else next[spec.key] = value;
              setParams(next);
            }}
          />
        ))}
        <CustomParams rows={custom} onChange={setCustom} readOnly={readOnly} />
      </View>
    </Section>
  );
}

/** What it can do, what new chats start with, and Open WebUI's own tools it may use. */
export function CapabilitiesSection({
  caps,
  setCaps,
  features,
  setFeatures,
  builtin,
  setBuiltin,
  terminals,
  terminalId,
  setTerminalId,
  readOnly,
  note = 'What it can do, and what new chats with it start with.',
}: {
  caps: Record<WorkspaceCapability, boolean>;
  setCaps: Setter<Record<WorkspaceCapability, boolean>>;
  features: string[];
  setFeatures: Setter<string[]>;
  builtin: Record<string, boolean>;
  setBuiltin: Setter<Record<string, boolean>>;
  /** The systems (terminal servers) this account may use; the choice shows only when there are some. */
  terminals: TerminalServer[];
  terminalId: string;
  setTerminalId: Setter<string>;
  readOnly: boolean;
  note?: string;
}) {
  const palette = usePalette();
  const offered = DEFAULT_FEATURES.filter((item) => caps[item.key]);
  return (
    <Section title="Capabilities" note={note}>
      {MODEL_CAPABILITIES.filter((item) => item.key !== 'file_context' || caps.file_upload).map((item) => (
        <SwitchRow key={item.key} label={item.label} note={item.note || undefined} value={caps[item.key]} disabled={readOnly} onChange={(on) => setCaps({ ...caps, [item.key]: on })} />
      ))}
      {offered.length ? <Text style={[styles.sub, { color: palette.textMuted }]}>On in new chats</Text> : null}
      {offered.map((item) => (
        <SwitchRow key={item.key} label={item.label} value={features.includes(item.key)} disabled={readOnly} onChange={(on) => setFeatures(on ? [...features, item.key] : features.filter((key) => key !== item.key))} />
      ))}
      {caps.builtin_tools ? <Text style={[styles.sub, { color: palette.textMuted }]}>Built-in tools it may use</Text> : null}
      {caps.builtin_tools
        ? BUILTIN_TOOLS.map((tool) => <SwitchRow key={tool.key} label={tool.label} value={builtin[tool.key] !== false} disabled={readOnly} onChange={(on) => setBuiltin({ ...builtin, [tool.key]: on })} />)
        : null}
      {caps.terminal && terminals.length ? <TerminalChoice terminals={terminals} terminalId={terminalId} setTerminalId={setTerminalId} readOnly={readOnly} /> : null}
    </Section>
  );
}

/** The system new chats with the model start on (the web's Terminal choice): none, or one of the account's. */
function TerminalChoice({ terminals, terminalId, setTerminalId, readOnly }: { terminals: TerminalServer[]; terminalId: string; setTerminalId: Setter<string>; readOnly: boolean }) {
  const palette = usePalette();
  // One saved that this account can't see is kept, and shown by its id.
  const options = [{ id: '', label: 'None' }, ...terminals.map((terminal) => ({ id: terminal.id, label: terminalLabel(terminal) })), ...(terminalId && !terminals.some((terminal) => terminal.id === terminalId) ? [{ id: terminalId, label: terminalId }] : [])];
  return (
    <>
      <Text style={[styles.sub, { color: palette.textMuted }]}>Terminal</Text>
      <Text style={[styles.note, { color: palette.textMuted }]}>The system new chats with it work on, as if chosen in the input bar.</Text>
      {options.map((option) => {
        const on = option.id === terminalId;
        return (
          <Pressable key={option.id || 'none'} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: readOnly }} disabled={readOnly} onPress={() => setTerminalId(option.id)} style={styles.switchRow} hitSlop={4}>
            <Text style={[styles.label, styles.flex, { color: palette.text }]} numberOfLines={1}>
              {option.label}
            </Text>
            {on ? <Icon name="check" size={16} color={palette.link} /> : null}
          </Pressable>
        );
      })}
    </>
  );
}

/** The voice the web reads the model's answers aloud in: typed, or picked from the server's voices. */
export function VoiceSection({ voice, setVoice, voices, readOnly }: { voice: string; setVoice: Setter<string>; voices: ServerVoice[]; readOnly: boolean }) {
  const palette = usePalette();
  const suggestions = voiceSuggestions(voices, voice).filter((item) => item.id !== voice.trim());
  return (
    <Section title="Voice" note={voice.trim() ? voice.trim() : 'The server’s, or each person’s own'}>
      <Text style={[styles.note, { color: palette.textMuted }]}>The voice Read Aloud uses for its answers on the web, from the server’s speech settings. MavieChat reads aloud with your phone’s voices (Settings → Audio).</Text>
      <TextInput value={voice} onChangeText={setVoice} editable={!readOnly} placeholder="e.g. alloy, echo, shimmer" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Voice" style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
      {!readOnly && suggestions.length ? (
        <View style={styles.chips}>
          {suggestions.map((item) => (
            <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Use ${item.name}`} onPress={() => setVoice(item.id)} style={[styles.chip, { borderColor: palette.border }]}>
              <Text style={[styles.chipText, { color: palette.text }]} numberOfLines={1}>
                {item.name === item.id ? item.id : `${item.name} · ${item.id}`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Section>
  );
}

const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((item) => item !== id));

/** What it brings to every chat: knowledge, tools, skills, filters and actions. */
export function AttachmentsSection({
  knowledge,
  setKnowledge,
  toolIds,
  setToolIds,
  skillIds,
  setSkillIds,
  filterIds,
  setFilterIds,
  defaultFilterIds,
  setDefaultFilterIds,
  actionIds,
  setActionIds,
  readOnly,
}: {
  knowledge: KnowledgeRef[];
  setKnowledge: Setter<KnowledgeRef[]>;
  toolIds: string[];
  setToolIds: Setter<string[]>;
  skillIds: string[];
  setSkillIds: Setter<string[]>;
  filterIds: string[];
  setFilterIds: Setter<string[]>;
  defaultFilterIds: string[];
  setDefaultFilterIds: Setter<string[]>;
  actionIds: string[];
  setActionIds: Setter<string[]>;
  readOnly: boolean;
}) {
  const palette = usePalette();
  const { client } = useAuthed();
  const tools = useTools();
  const functions = useQuery({ queryKey: ['functions'], queryFn: () => listFunctions(client), staleTime: 5 * 60_000 });
  const skills = useQuery({ queryKey: ['workspace', 'skill-choices'], queryFn: () => listSkillChoices(client), staleTime: 60_000 });
  const filters = functionChoices(functions.data ?? [], 'filter');
  const actions = functionChoices(functions.data ?? [], 'action');
  const [picking, setPicking] = useState(false);
  return (
    <Section title="Knowledge, tools and more" note="What it brings to every chat.">
      <Text style={[styles.sub, { color: palette.textMuted }]}>Knowledge</Text>
      {knowledge.map((ref) => (
        <View key={ref.id} style={styles.switchRow}>
          <Icon name={ref.type === 'file' ? 'document-text' : 'circle-stack'} size={16} color={palette.textMuted} />
          <View style={styles.flex}>
            <Text style={[styles.label, { color: palette.text }]} numberOfLines={1}>
              {ref.name}
            </Text>
            <Text style={[styles.note, { color: palette.textMuted }]}>{ref.full ? 'Whole document in the prompt' : 'Searched for what’s relevant'}</Text>
          </View>
          <Switch accessibilityLabel={`${ref.name}: whole document`} value={ref.full} disabled={readOnly} onValueChange={(full) => setKnowledge(knowledge.map((item) => (item.id === ref.id ? { ...item, full } : item)))} />
          {readOnly ? null : (
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${ref.name}`} onPress={() => setKnowledge(knowledge.filter((item) => item.id !== ref.id))} hitSlop={8}>
              <Icon name="x-mark" size={16} color={palette.textMuted} />
            </Pressable>
          )}
        </View>
      ))}
      {readOnly ? null : (
        <Pressable accessibilityRole="button" onPress={() => setPicking(true)} hitSlop={6}>
          <Text style={[styles.link, { color: palette.link }]}>Add Knowledge</Text>
        </Pressable>
      )}
      <Text style={[styles.sub, { color: palette.textMuted }]}>Tools</Text>
      {tools.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {(tools.data ?? []).map((tool) => (
        <SwitchRow key={tool.id} label={tool.name || tool.id} value={toolIds.includes(tool.id)} disabled={readOnly} onChange={(on) => setToolIds(toggle(toolIds, tool.id, on))} />
      ))}
      {tools.data && !tools.data.length ? <Text style={[styles.note, { color: palette.textFaint }]}>No tools you can use.</Text> : null}
      <Text style={[styles.sub, { color: palette.textMuted }]}>Skills</Text>
      {(skills.data ?? []).filter((skill) => skill.active).map((skill) => (
        <SwitchRow key={skill.id} label={skill.name} note={skill.description || undefined} value={skillIds.includes(skill.id)} disabled={readOnly} onChange={(on) => setSkillIds(toggle(skillIds, skill.id, on))} />
      ))}
      {skills.data && !skills.data.some((skill) => skill.active) ? <Text style={[styles.note, { color: palette.textFaint }]}>No skills you can use.</Text> : null}
      {filters.length ? <Text style={[styles.sub, { color: palette.textMuted }]}>Filters</Text> : null}
      {filters.map((filter) => {
        const on = filter.global || filterIds.includes(filter.id);
        return (
          <View key={filter.id}>
            <SwitchRow label={filter.name} note={filter.global ? 'On for every chat (your admin’s)' : undefined} value={on} disabled={readOnly || filter.global} onChange={(next) => setFilterIds(toggle(filterIds, filter.id, next))} />
            {on && filter.toggle ? <SwitchRow label="On by default" value={defaultFilterIds.includes(filter.id)} disabled={readOnly} onChange={(next) => setDefaultFilterIds(toggle(defaultFilterIds, filter.id, next))} /> : null}
          </View>
        );
      })}
      {actions.length ? <Text style={[styles.sub, { color: palette.textMuted }]}>Actions</Text> : null}
      {actions.map((action) => (
        <SwitchRow key={action.id} label={action.name} note={action.global ? 'On for every chat (your admin’s)' : undefined} value={action.global || actionIds.includes(action.id)} disabled={readOnly || action.global} onChange={(on) => setActionIds(toggle(actionIds, action.id, on))} />
      ))}
      <KnowledgePicker visible={picking} chosen={knowledge.map((ref) => ref.id)} onPick={(ref) => setKnowledge([...knowledge, ref])} onClose={() => setPicking(false)} />
    </Section>
  );
}

export function KnowledgePicker({ visible, chosen, onPick, onClose }: { visible: boolean; chosen: string[]; onPick: Setter<KnowledgeRef>; onClose: () => void }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const bases = useQuery({ queryKey: ['workspace', 'kb-choices', debounced], queryFn: () => searchKnowledgeBases(client, debounced), enabled: visible });
  const files = useQuery({ queryKey: ['workspace', 'kb-file-choices', debounced], queryFn: () => searchKnowledgeFiles(client, debounced), enabled: visible && debounced.length > 0 });
  const rows = [...(bases.data ?? []), ...(files.data ?? [])].filter((choice) => choice.kind !== 'folder' && !chosen.includes(choice.id));
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <View style={styles.placeholder} />
          <Text style={[styles.title, { color: palette.text }]}>Add Knowledge</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={[styles.action, { color: palette.link }]}>Done</Text>
          </Pressable>
        </View>
        <View style={styles.searchWrap}>
          <TextInput value={query} onChangeText={setQuery} placeholder="Knowledge bases (type to find files too)" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search knowledge" style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        </View>
        <ScrollView contentContainerStyle={styles.pickList} keyboardShouldPersistTaps="handled">
          {bases.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
          {rows.map((choice) => (
            <Pressable
              key={`${choice.kind}:${choice.id}`}
              accessibilityRole="button"
              onPress={() => {
                onPick(knowledgeRefFrom(choice));
                onClose();
              }}
              style={({ pressed }) => [styles.pickRow, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <Icon name={choice.kind === 'file' ? 'document-text' : 'circle-stack'} size={16} color={palette.textMuted} />
              <View style={styles.flex}>
                <Text style={[styles.label, { color: palette.text }]} numberOfLines={1}>
                  {choice.name}
                </Text>
                {choice.description ? (
                  <Text style={[styles.note, { color: palette.textMuted }]} numberOfLines={1}>
                    {choice.description}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
          {bases.data && !rows.length ? <Text style={[styles.note, { color: palette.textMuted }]}>Nothing to add.</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Prompts offered on a new chat with it: the server's, or its own. */
export function SuggestionsSection({
  prompts,
  setPrompts,
  readOnly,
  summary,
  toggle = { label: 'Its own suggestions', note: 'Off: the server’s default ones.' },
}: {
  prompts: SuggestedPrompt[] | null;
  setPrompts: Setter<SuggestedPrompt[] | null>;
  readOnly: boolean;
  /** Under the title; by default what a model has. */
  summary?: string;
  /** The switch between a list and none of its own (null: always a list). */
  toggle?: { label: string; note: string } | null;
}) {
  const palette = usePalette();
  return (
    <Section title="Suggested prompts" note={summary ?? (prompts === null ? 'The server’s, for now.' : `${prompts.length} of its own.`)}>
      {toggle ? <SwitchRow label={toggle.label} note={toggle.note} value={prompts !== null} disabled={readOnly} onChange={(on) => setPrompts(on ? [] : null)} /> : null}
      {(prompts ?? []).map((prompt, index) => (
        <View key={index} style={[styles.prompt, { borderColor: palette.border }]}>
          <View style={styles.customRow}>
            <TextInput value={prompt.title} onChangeText={(title) => setPrompts((prompts ?? []).map((row, i) => (i === index ? { ...row, title } : row)))} editable={!readOnly} placeholder="Title" placeholderTextColor={palette.textFaint} accessibilityLabel="Title" style={[styles.input, styles.flex, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
            <TextInput value={prompt.subtitle} onChangeText={(subtitle) => setPrompts((prompts ?? []).map((row, i) => (i === index ? { ...row, subtitle } : row)))} editable={!readOnly} placeholder="Subtitle" placeholderTextColor={palette.textFaint} accessibilityLabel="Subtitle" style={[styles.input, styles.flex, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
          </View>
          <View style={styles.customRow}>
            <TextInput value={prompt.content} onChangeText={(content) => setPrompts((prompts ?? []).map((row, i) => (i === index ? { ...row, content } : row)))} editable={!readOnly} multiline placeholder="The prompt it sends" placeholderTextColor={palette.textFaint} accessibilityLabel="Prompt" style={[styles.input, styles.flex, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
            {readOnly ? null : (
              <Pressable accessibilityRole="button" accessibilityLabel="Remove" onPress={() => setPrompts((prompts ?? []).filter((_, i) => i !== index))} hitSlop={8}>
                <Icon name="x-mark" size={16} color={palette.textMuted} />
              </Pressable>
            )}
          </View>
        </View>
      ))}
      {prompts !== null && !readOnly ? (
        <Pressable accessibilityRole="button" onPress={() => setPrompts([...(prompts ?? []), { title: '', subtitle: '', content: '' }])} hitSlop={6}>
          <Text style={[styles.link, { color: palette.link }]}>Add a Prompt</Text>
        </Pressable>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  section: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  sectionTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  sectionBody: { gap: 10, paddingHorizontal: 12, paddingBottom: 12 },
  flex: { flex: 1 },
  gap: { gap: 10 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  label: { fontFamily: fonts.medium, fontSize: 14 },
  sub: { fontFamily: fonts.medium, fontSize: 12, marginTop: 6 },
  link: { fontFamily: fonts.medium, fontSize: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8, fontFamily: fonts.regular, fontSize: 14 },
  prompt: { gap: 6, padding: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, maxWidth: '100%' },
  chipText: { fontFamily: fonts.regular, fontSize: 13 },
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.semibold, fontSize: 16 },
  placeholder: { width: 40 },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  pickList: { paddingHorizontal: 16, paddingBottom: 48 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
