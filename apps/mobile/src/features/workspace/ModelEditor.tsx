import {
  builtinToolsMeta,
  builtinToolsOf,
  capabilitiesOf,
  createWorkspaceModel,
  customParamsOf,
  defaultFeaturesOf,
  getModelDefaults,
  knowledgeMeta,
  knowledgeRefsOf,
  listServerVoices,
  listTerminals,
  modelFormBody,
  modelFormOf,
  modelIdFromName,
  modelParamsToSave,
  promptVariables,
  suggestionsMeta,
  suggestionsOf,
  tagNames,
  terminalIdOf,
  ttsVoiceOf,
  updateWorkspaceModel,
  withTerminalAndVoice,
  type ModelForm,
  type ModelItem,
  type WorkspaceModel,
} from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { useAnchoredMenu } from '@/components/Menu';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { ModelAvatar } from '@/features/chat/ModelAvatar';
import { usePictureMaker } from '@/features/settings/PictureMaker';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useModels } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import { AttachmentsSection, CapabilitiesSection, ParamsSection, Section, SuggestionsSection, VoiceSection } from './ModelSections';
import { useWorkspaceModel, useWorkspaceRefresh } from './queries';

/**
 * What the editor opens on: a new model, one to change, or a copy of one; for admins also a
 * connection's model (`base`: its own settings, saved here, with no model under it) and a new
 * workspace model built on one, copying its settings (`build`: the admin list's Clone). For those
 * two, `saved` says whether settings are saved for it already (else there's nothing to load).
 */
export type ModelEditorTarget =
  | { kind: 'new' }
  | { kind: 'edit'; id: string }
  | { kind: 'clone'; id: string }
  | { kind: 'base'; id: string; name: string; saved: boolean }
  | { kind: 'build'; id: string; name: string; saved: boolean };

/** The model to load first, if any. */
const loadIdOf = (target: ModelEditorTarget | null): string | null => {
  if (!target || target.kind === 'new') return null;
  if (target.kind === 'base' || target.kind === 'build') return target.saved ? target.id : null;
  return target.id;
};

const DEFAULT_PICTURE = '/static/favicon.png';
const PHOTO: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7, base64: true, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };

/** Models a workspace model can be built on: no other workspace model, arena or direct connection; hidden ones only for admins (or the one already chosen). */
function baseChoices(models: ModelItem[], admin: boolean, chosen: string): ModelItem[] {
  return models.filter((model) => {
    const info = (model.info ?? {}) as { base_model_id?: unknown };
    if (model.preset === true || info.base_model_id || model.owned_by === 'arena' || model.connection_type === 'direct' || model.direct === true) return false;
    return admin || model.id === chosen || !model.info?.meta?.hidden;
  });
}

/**
 * A workspace model's identity and instructions, as Open WebUI's editor has them: picture, name,
 * id (new ones only), the base model, description, tags and system prompt. Everything else the
 * model has (parameters, capabilities, knowledge, tools…) is kept as it is; new ones are private.
 */
export function ModelEditor({ target, onClose, onSaved }: { target: ModelEditorTarget | null; onClose: () => void; onSaved?: () => void }) {
  const palette = usePalette();
  const id = loadIdOf(target);
  const model = useWorkspaceModel(id);
  const { client } = useAuthed();
  // The admin's defaults for every model, which a model's own capabilities start from.
  const defaults = useQuery({ queryKey: ['workspace', 'model-defaults'], queryFn: () => getModelDefaults(client), enabled: target !== null, staleTime: 5 * 60_000 });
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target === null ? null : (id && !model.data) || defaults.isLoading ? (
        <View style={[styles.sheet, styles.center, { backgroundColor: palette.background }]}>
          {model.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t open it: ${describeError(model.error)}`}</Text> : <ActivityIndicator color={palette.textMuted} />}
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={[styles.action, { color: palette.link }]}>Close</Text>
          </Pressable>
        </View>
      ) : (
        <Form key={`${target.kind}:${'id' in target ? target.id : ''}`} target={target} model={model.data ?? null} defaults={defaults.data ?? {}} onClose={onClose} onSaved={onSaved} />
      )}
    </Modal>
  );
}

function Form({ target, model, defaults, onClose, onSaved }: { target: ModelEditorTarget; model: WorkspaceModel | null; defaults: Record<string, unknown>; onClose: () => void; onSaved?: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useAuthed();
  const capabilities = useCapabilities();
  const models = useModels();
  const refresh = useWorkspaceRefresh();
  const picture = usePictureMaker();
  // A connection's own model is changed in place, with no model under it; a copy is a new one.
  const own = target.kind === 'base';
  const copying = target.kind === 'clone' || target.kind === 'build';
  const editing = target.kind === 'edit' || own;
  const readOnly = editing && model !== null && !model.writeAccess;
  const sourceName = model?.name ?? (target.kind === 'base' || target.kind === 'build' ? target.name : '');
  const sourceId = model?.id ?? (target.kind === 'new' ? '' : target.id);
  const [name, setName] = useState(target.kind === 'new' ? '' : copying ? `${sourceName} (Clone)` : sourceName);
  const [modelId, setModelId] = useState(target.kind === 'new' ? '' : copying ? `${sourceId}-clone` : sourceId);
  const [idTouched, setIdTouched] = useState(target.kind !== 'new');
  // The admin list's Clone of a connection's model builds on that model.
  const [baseId, setBaseId] = useState(target.kind === 'build' ? target.id : own ? '' : (model?.baseModelId ?? ''));
  const [description, setDescription] = useState(model?.description ?? '');
  const [tags, setTags] = useState<string[]>(model ? tagNames(model.meta.tags) : []);
  const [newTag, setNewTag] = useState('');
  const [system, setSystem] = useState(typeof model?.params.system === 'string' ? model.params.system : '');
  const [image, setImage] = useState<string | null>(null);
  const meta0 = model?.meta ?? {};
  const params0 = model?.params ?? {};
  const [params, setParams] = useState<Record<string, unknown>>(() => {
    const { system: _system, custom_params: _custom, ...rest } = params0;
    return rest;
  });
  const [custom, setCustom] = useState(() => customParamsOf(params0));
  const [caps, setCaps] = useState(() => capabilitiesOf(meta0, defaults));
  const [features, setFeatures] = useState(() => defaultFeaturesOf(meta0, capabilitiesOf(meta0, defaults)));
  const [builtin, setBuiltin] = useState(() => builtinToolsOf(meta0));
  const [knowledge, setKnowledge] = useState(() => knowledgeRefsOf(meta0));
  const ids = (key: string) => (Array.isArray(meta0[key]) ? (meta0[key] as unknown[]).filter((item): item is string => typeof item === 'string') : []);
  const [toolIds, setToolIds] = useState(() => ids('toolIds'));
  const [skillIds, setSkillIds] = useState(() => ids('skillIds'));
  const [filterIds, setFilterIds] = useState(() => ids('filterIds'));
  const [defaultFilterIds, setDefaultFilterIds] = useState(() => ids('defaultFilterIds'));
  const [actionIds, setActionIds] = useState(() => ids('actionIds'));
  const [prompts, setPrompts] = useState(() => suggestionsOf(meta0));
  const [terminalId, setTerminalId] = useState(() => terminalIdOf(meta0));
  const [voice, setVoice] = useState(() => ttsVoiceOf(meta0));
  // What the editor offers: the systems this account may use, and the server's voices (none when it can't say).
  const terminals = useQuery({ queryKey: ['workspace', 'terminals'], queryFn: () => listTerminals(client), staleTime: 5 * 60_000 });
  const voices = useQuery({ queryKey: ['workspace', 'voices'], queryFn: () => listServerVoices(client).catch(() => []), staleTime: 5 * 60_000 });
  const [choosingBase, setChoosingBase] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const choices = baseChoices(models.data ?? [], capabilities?.isAdmin ?? false, baseId);
  const base = (models.data ?? []).find((item) => item.id === baseId);
  const variables = promptVariables(system);
  const taken = !editing && (models.data ?? []).some((item) => item.id === modelId.trim());
  const ready = Boolean(name.trim() && modelId.trim() && (baseId || own)) && !taken && !readOnly;

  const pickPhoto = async (camera: boolean) => {
    try {
      if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) return toast('Allow camera access for MavieChat in Settings to take a photo.', 'error');
      const result = camera ? await ImagePicker.launchCameraAsync(PHOTO) : await ImagePicker.launchImageLibraryAsync(PHOTO);
      const asset = result.canceled ? undefined : result.assets[0];
      if (asset?.base64) setImage(await picture.maker.square(`data:image/jpeg;base64,${asset.base64}`, 250));
    } catch (error) {
      toast(`Couldn’t use the photo: ${describeError(error)}`, 'error');
    }
  };
  const { ref: pictureRef, open: openPictureMenu, menu: pictureMenu } = useAnchoredMenu([
    { key: 'photos', label: 'Choose Photo', icon: 'photo', onPress: () => void pickPhoto(false) },
    { key: 'camera', label: 'Take Photo', icon: 'camera', onPress: () => void pickPhoto(true) },
    { key: 'reset', label: 'Default Picture', icon: 'arrow-path', onPress: () => setImage(DEFAULT_PICTURE) },
  ]);
  const addTag = () => {
    const tag = newTag.trim();
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setNewTag('');
  };
  /** The model as it would be saved: what the editor started from, with every change made here. */
  const formNow = (): ModelForm => {
    const start = model ? modelFormOf(model) : { id: '', baseModelId: '', name: '', meta: {}, params: {}, isActive: true };
    const meta = withTerminalAndVoice(
      {
        ...start.meta,
        description: description.trim() || null,
        tags: tags.map((tag) => ({ name: tag })),
        ...(image ? { profile_image_url: image } : {}),
        // Capabilities always go whole, as the web saves them; the rest only when set (empties are dropped).
        capabilities: caps,
        defaultFeatureIds: features.filter((key) => caps[key as keyof typeof caps]),
        builtinTools: builtinToolsMeta(builtin),
        knowledge: knowledgeMeta(knowledge),
        toolIds,
        skillIds,
        filterIds,
        defaultFilterIds: defaultFilterIds.filter((key) => filterIds.includes(key)),
        actionIds,
        suggestion_prompts: suggestionsMeta(prompts),
      },
      terminalId,
      voice,
    );
    const form = { ...start, id: modelId.trim(), baseModelId: own ? '' : baseId, name: name.trim(), meta, params: modelParamsToSave({ ...params, system: system.trim() ? system : null }, custom) };
    // A connection's model with nothing saved gets its first row: on, as it was, and private (as
    // before: with no row only admins see it).
    if (own && !target.saved) return { ...form, isActive: true, accessGrants: [] };
    return editing ? form : { ...form, isActive: true, accessGrants: [] };
  };
  const save = async () => {
    if (!ready) return setProblem(taken ? 'A model has that id already.' : own ? 'It needs a name.' : 'It needs a name, an id and a base model.');
    setBusy(true);
    setProblem('');
    try {
      const form = formNow();
      if (editing && !(own && !target.saved)) await updateWorkspaceModel(client, form);
      else await createWorkspaceModel(client, form);
      refresh();
      onSaved?.();
      toast(own ? 'Settings saved' : editing ? 'Model saved' : 'Model made (private)');
      onClose();
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const shownBase = choices.filter((item) => !query.trim() || `${item.name ?? ''} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      {picture.element}
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>{readOnly ? 'Done' : 'Cancel'}</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
          {editing ? (model?.name ?? sourceName) || 'Model' : copying ? 'Copy of a Model' : 'New Model'}
        </Text>
        {readOnly ? (
          <View style={styles.placeholder} />
        ) : busy ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : (
          <Pressable accessibilityRole="button" disabled={!ready} onPress={() => void save()} hitSlop={10}>
            <Text style={[styles.action, styles.strong, { color: ready ? palette.link : palette.textFaint }]}>Save</Text>
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {readOnly ? <Text style={[styles.note, { color: palette.textMuted }]}>Shared with you to use: only its owner (or someone they let) can change it.</Text> : null}
        {own ? (
          <Text style={[styles.note, { color: palette.textMuted }]}>
            {target.saved
              ? 'A model from a connection: these are the settings saved for it here, which everyone who may use it gets.'
              : 'A model from a connection, with nothing saved for it yet: saving makes its settings here. It stays private (only admins see it) until you share it.'}
          </Text>
        ) : null}
        {problem ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{problem}</Text> : null}
        <View style={styles.identity}>
          <Pressable ref={pictureRef} accessibilityRole="button" accessibilityLabel="Change the picture" disabled={readOnly} onPress={openPictureMenu}>
            {image ? <Image source={{ uri: image.startsWith('data:') ? image : `${session.baseUrl}${image}` }} style={styles.picture} /> : model || own ? <ModelAvatar modelId={model?.id ?? sourceId} size={64} rounded={16} /> : <View style={[styles.picture, { backgroundColor: palette.surfaceStrong }]} />}
          </Pressable>
          <View style={styles.flex}>
            <TextInput
              value={name}
              onChangeText={(value) => {
                setName(value);
                if (!idTouched) setModelId(modelIdFromName(value));
              }}
              editable={!readOnly}
              placeholder="Name"
              placeholderTextColor={palette.textFaint}
              accessibilityLabel="Name"
              style={[styles.input, styles.name, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
            />
            <TextInput
              value={modelId}
              onChangeText={(value) => {
                setIdTouched(true);
                setModelId(value);
              }}
              editable={!editing}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="model-id"
              placeholderTextColor={palette.textFaint}
              accessibilityLabel="Model id"
              style={[styles.input, styles.mono, { color: editing ? palette.textMuted : palette.text, borderColor: taken ? palette.danger : palette.border, backgroundColor: palette.surface }]}
            />
            {taken ? <Text style={[styles.note, { color: palette.danger }]}>A model has that id already.</Text> : null}
          </View>
        </View>
        {pictureMenu}
        {own ? null : (
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>Base model</Text>
          <Pressable accessibilityRole="button" disabled={readOnly} onPress={() => setChoosingBase(!choosingBase)} style={[styles.input, styles.choice, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Text style={[styles.value, { color: baseId ? palette.text : palette.textFaint }]} numberOfLines={1}>
              {base?.name ?? (baseId || 'Choose the model it builds on')}
            </Text>
            <Icon name={choosingBase ? 'chevron-up' : 'chevron-down'} size={14} color={palette.textMuted} />
          </Pressable>
          {choosingBase ? (
            <View style={[styles.choices, { borderColor: palette.border }]}>
              <TextInput value={query} onChangeText={setQuery} placeholder="Search models" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Search models" style={[styles.search, { color: palette.text, borderBottomColor: palette.border }]} />
              {shownBase.slice(0, 50).map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => {
                    setBaseId(item.id);
                    setChoosingBase(false);
                  }}
                  style={({ pressed }) => [styles.choiceRow, pressed && { backgroundColor: palette.surface }]}>
                  <ModelAvatar modelId={item.id} size={22} />
                  <Text style={[styles.value, styles.flex, { color: palette.text }]} numberOfLines={1}>
                    {item.name ?? item.id}
                  </Text>
                  {item.id === baseId ? <Icon name="check" size={14} color={palette.link} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
        )}
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>Description</Text>
          <TextInput value={description} onChangeText={setDescription} editable={!readOnly} multiline placeholder="What it’s for (shown under its name)" placeholderTextColor={palette.textFaint} accessibilityLabel="Description" style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>Tags</Text>
          {tags.length ? (
            <View style={styles.tags}>
              {tags.map((tag) => (
                <Pressable key={tag} accessibilityRole="button" accessibilityLabel={`Remove ${tag}`} disabled={readOnly} onPress={() => setTags(tags.filter((item) => item !== tag))} style={[styles.tag, { borderColor: palette.border }]}>
                  <Text style={[styles.tagText, { color: palette.text }]}>{tag}</Text>
                  {readOnly ? null : <Icon name="x-mark" size={11} color={palette.textMuted} />}
                </Pressable>
              ))}
            </View>
          ) : null}
          {readOnly ? null : <TextInput value={newTag} onChangeText={setNewTag} onSubmitEditing={addTag} returnKeyType="done" placeholder="Add a tag" placeholderTextColor={palette.textFaint} accessibilityLabel="Add a tag" style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />}
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text }]}>System prompt</Text>
          <TextInput
            value={system}
            onChangeText={setSystem}
            editable={!readOnly}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            placeholder="How the model should behave"
            placeholderTextColor={palette.textFaint}
            accessibilityLabel="System prompt"
            style={[styles.input, styles.system, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
          {variables.chat.length || variables.user.length ? (
            <Text style={[styles.note, { color: palette.textMuted }]}>
              {[variables.chat.length ? `Asks each chat for: ${variables.chat.join(', ')}.` : '', variables.user.length ? `Each person sets: ${variables.user.join(', ')}.` : ''].filter(Boolean).join(' ')}
            </Text>
          ) : null}
        </View>
        <ParamsSection params={params} setParams={setParams} custom={custom} setCustom={setCustom} readOnly={readOnly} />
        <CapabilitiesSection caps={caps} setCaps={setCaps} features={features} setFeatures={setFeatures} builtin={builtin} setBuiltin={setBuiltin} terminals={terminals.data ?? []} terminalId={terminalId} setTerminalId={setTerminalId} readOnly={readOnly} />
        <AttachmentsSection
          knowledge={knowledge}
          setKnowledge={setKnowledge}
          toolIds={toolIds}
          setToolIds={setToolIds}
          skillIds={skillIds}
          setSkillIds={setSkillIds}
          filterIds={filterIds}
          setFilterIds={setFilterIds}
          defaultFilterIds={defaultFilterIds}
          setDefaultFilterIds={setDefaultFilterIds}
          actionIds={actionIds}
          setActionIds={setActionIds}
          readOnly={readOnly}
        />
        <SuggestionsSection prompts={prompts} setPrompts={setPrompts} readOnly={readOnly} />
        <VoiceSection voice={voice} setVoice={setVoice} voices={voices.data ?? []} readOnly={readOnly} />
        <Section title="JSON Preview" note="What Save sends, as on the web">
          <JsonPreview body={modelFormBody(formNow())} />
        </Section>
        <Text style={[styles.note, { color: palette.textFaint }]}>{editing ? 'Its sharing stays as it is.' : 'New models are private: only you (and admins) can use them.'}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** The model as Save sends it, to read or copy; a picture's data is shortened here (not in what's saved). */
function JsonPreview({ body }: { body: Record<string, unknown> }) {
  const palette = usePalette();
  const toast = useToast();
  const json = JSON.stringify(body, null, 2);
  const shown = json.replace(/"data:([\w/+.-]+);base64,[A-Za-z0-9+/=]{48,}"/g, (whole, type: string) => `"data:${type};base64,… (${Math.round(whole.length / 1365)} KB)"`);
  return (
    <View style={styles.field}>
      <Text selectable style={[styles.json, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}>
        {shown}
      </Text>
      <Pressable accessibilityRole="button" onPress={() => void Clipboard.setStringAsync(json).then(() => toast('JSON copied'))} hitSlop={6} style={styles.copy}>
        <Text style={[styles.action, { color: palette.link }]}>Copy JSON</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  placeholder: { width: 40 },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  problem: { padding: 10, borderWidth: 1, borderRadius: radius.md, fontSize: 13 },
  identity: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  picture: { width: 64, height: 64, borderRadius: 16 },
  flex: { flex: 1, gap: 8 },
  field: { gap: 6 },
  label: { fontFamily: fonts.medium, fontSize: 14 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  name: { fontFamily: fonts.semibold },
  mono: { fontFamily: fonts.mono, fontSize: 13 },
  value: { fontFamily: fonts.regular, fontSize: 15 },
  choice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  choices: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  search: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, fontFamily: fonts.regular, fontSize: 14 },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  tagText: { fontFamily: fonts.regular, fontSize: 13 },
  system: { minHeight: 180, fontFamily: fonts.mono, fontSize: 13, lineHeight: 19, textAlignVertical: 'top' },
  json: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: 10, fontFamily: fonts.mono, fontSize: 12, lineHeight: 17 },
  copy: { alignSelf: 'flex-start' },
});
