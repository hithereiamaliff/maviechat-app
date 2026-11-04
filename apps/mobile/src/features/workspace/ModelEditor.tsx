import { createWorkspaceModel, modelFormOf, modelIdFromName, promptVariables, tagNames, updateWorkspaceModel, type ModelItem, type WorkspaceModel } from '@maviechat/owui-protocol';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { useAnchoredMenu } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { ModelAvatar } from '@/features/chat/ModelAvatar';
import { usePictureMaker } from '@/features/settings/PictureMaker';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useModels } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import { useWorkspaceModel, useWorkspaceRefresh } from './queries';

/** What the editor opens on: a new model, one to change, or a copy of one. */
export type ModelEditorTarget = { kind: 'new' } | { kind: 'edit'; id: string } | { kind: 'clone'; id: string };

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
export function ModelEditor({ target, onClose }: { target: ModelEditorTarget | null; onClose: () => void }) {
  const palette = usePalette();
  const id = target && target.kind !== 'new' ? target.id : null;
  const model = useWorkspaceModel(id);
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target === null ? null : id && !model.data ? (
        <View style={[styles.sheet, styles.center, { backgroundColor: palette.background }]}>
          {model.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn’t open it: ${describeError(model.error)}`}</Text> : <ActivityIndicator color={palette.textMuted} />}
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={[styles.action, { color: palette.link }]}>Close</Text>
          </Pressable>
        </View>
      ) : (
        <Form key={`${target.kind}:${id ?? ''}`} target={target} model={model.data ?? null} onClose={onClose} />
      )}
    </Modal>
  );
}

function Form({ target, model, onClose }: { target: ModelEditorTarget; model: WorkspaceModel | null; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useAuthed();
  const capabilities = useCapabilities();
  const models = useModels();
  const refresh = useWorkspaceRefresh();
  const picture = usePictureMaker();
  const editing = target.kind === 'edit';
  const readOnly = editing && model !== null && !model.writeAccess;
  const [name, setName] = useState(model ? (target.kind === 'clone' ? `${model.name} (Clone)` : model.name) : '');
  const [modelId, setModelId] = useState(model ? (target.kind === 'clone' ? `${model.id}-clone` : model.id) : '');
  const [idTouched, setIdTouched] = useState(target.kind !== 'new');
  const [baseId, setBaseId] = useState(model?.baseModelId ?? '');
  const [description, setDescription] = useState(model?.description ?? '');
  const [tags, setTags] = useState<string[]>(model ? tagNames(model.meta.tags) : []);
  const [newTag, setNewTag] = useState('');
  const [system, setSystem] = useState(typeof model?.params.system === 'string' ? model.params.system : '');
  const [image, setImage] = useState<string | null>(null);
  const [choosingBase, setChoosingBase] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const choices = baseChoices(models.data ?? [], capabilities?.isAdmin ?? false, baseId);
  const base = (models.data ?? []).find((item) => item.id === baseId);
  const variables = promptVariables(system);
  const taken = !editing && (models.data ?? []).some((item) => item.id === modelId.trim());
  const ready = Boolean(name.trim() && modelId.trim() && baseId) && !taken && !readOnly;

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
  const save = async () => {
    if (!ready) return setProblem(taken ? 'A model has that id already.' : 'It needs a name, an id and a base model.');
    setBusy(true);
    setProblem('');
    try {
      const start = model ? modelFormOf(model) : { id: '', baseModelId: '', name: '', meta: {}, params: {}, isActive: true };
      const meta = { ...start.meta, description: description.trim() || null, tags: tags.map((tag) => ({ name: tag })), ...(image ? { profile_image_url: image } : {}) };
      const params = { ...start.params, system: system.trim() ? system : null };
      const form = { ...start, id: modelId.trim(), baseModelId: baseId, name: name.trim(), meta, params };
      if (editing) await updateWorkspaceModel(client, form);
      else await createWorkspaceModel(client, { ...form, isActive: true, accessGrants: [] });
      refresh();
      toast(editing ? 'Model saved' : 'Model made (private)');
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
          {editing ? (model?.name ?? 'Model') : target.kind === 'clone' ? 'Copy of a Model' : 'New Model'}
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
        {problem ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{problem}</Text> : null}
        <View style={styles.identity}>
          <Pressable ref={pictureRef} accessibilityRole="button" accessibilityLabel="Change the picture" disabled={readOnly} onPress={openPictureMenu}>
            {image ? <Image source={{ uri: image.startsWith('data:') ? image : `${session.baseUrl}${image}` }} style={styles.picture} /> : model ? <ModelAvatar modelId={model.id} size={64} rounded={16} /> : <View style={[styles.picture, { backgroundColor: palette.surfaceStrong }]} />}
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
        <Text style={[styles.note, { color: palette.textFaint }]}>{editing ? 'Its parameters, capabilities, knowledge, tools and sharing stay as they are.' : 'New models are private: only you (and admins) can use them.'}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
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
});
