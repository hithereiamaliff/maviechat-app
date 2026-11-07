import {
  createFolder,
  getFolder,
  isAtLeast,
  knowledgeMeta,
  knowledgeRefsOf,
  pickerModels,
  updateFolder,
  type FolderData,
  type FolderDetail,
  type KnowledgeRef,
} from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { usePictureMaker } from '@/features/settings/PictureMaker';
import { KnowledgePicker } from '@/features/workspace/ModelSections';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useModels } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

/** A new folder (at the top, or inside `parentId`) or one to edit. */
export type FolderSheetTarget = { mode: 'create'; parentId: string | null; parentName?: string } | { mode: 'edit'; folderId: string };

/** A picture behind the folder's page is kept to this size across and down: plenty for a phone, and the web, behind a page. */
const BACKGROUND_SIDE = 1920;
const PHOTO: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9, base64: true, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };

/**
 * A folder's settings, as the web's folder form keeps them: its name, the system prompt and
 * knowledge every chat in it gets (the server adds them), and a picture behind its page. Servers
 * from 0.12 also keep a description and the model its new chats start with.
 */
export function FolderSheet({ target, onClose, onSaved }: { target: FolderSheetTarget | null; onClose: () => void; onSaved: (folder: FolderDetail, target: FolderSheetTarget) => void }) {
  const palette = usePalette();
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target ? (
        <Loader key={target.mode === 'edit' ? target.folderId : `new:${target.parentId ?? ''}`} target={target} onClose={onClose} onSaved={onSaved} />
      ) : (
        <View style={{ backgroundColor: palette.background }} />
      )}
    </Modal>
  );
}

function Loader({ target, onClose, onSaved }: { target: FolderSheetTarget; onClose: () => void; onSaved: (folder: FolderDetail, target: FolderSheetTarget) => void }) {
  const palette = usePalette();
  const { client } = useAuthed();
  const folderId = target.mode === 'edit' ? target.folderId : null;
  const folder = useQuery({ queryKey: ['folder', folderId], queryFn: () => getFolder(client, folderId ?? ''), enabled: folderId !== null });
  if (folderId === null) return <Editor folder={null} target={target} onClose={onClose} onSaved={onSaved} />;
  if (folder.data) return <Editor folder={folder.data} target={target} onClose={onClose} onSaved={onSaved} />;
  return (
    <View style={[styles.sheet, styles.center, { backgroundColor: palette.background }]}>
      {folder.isError ? (
        <>
          <Text style={[styles.hint, { color: palette.textMuted }]}>{`Couldn’t open the folder: ${describeError(folder.error)}`}</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={[styles.action, { color: palette.link }]}>Close</Text>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator color={palette.textMuted} />
      )}
    </View>
  );
}

function Editor({
  folder,
  target,
  onClose,
  onSaved,
}: {
  folder: FolderDetail | null;
  target: FolderSheetTarget;
  onClose: () => void;
  onSaved: (folder: FolderDetail, target: FolderSheetTarget) => void;
}) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const models = useModels();
  const picture = usePictureMaker();
  const newer = isAtLeast(capabilities?.version, '0.12.0');
  const promptAllowed = (capabilities?.isAdmin ?? false) || (capabilities?.can('chat.system_prompt', true) ?? false);
  const data = folder?.data ?? {};
  const [name, setName] = useState(folder?.name ?? '');
  const [description, setDescription] = useState(typeof data.description === 'string' ? data.description : '');
  const [systemPrompt, setSystemPrompt] = useState(typeof data.system_prompt === 'string' ? data.system_prompt : '');
  const [knowledge, setKnowledge] = useState<KnowledgeRef[]>(() => knowledgeRefsOf({ knowledge: Array.isArray(data.files) ? data.files : [] }));
  const [background, setBackground] = useState<string | null>(typeof folder?.meta?.background_image_url === 'string' ? folder.meta.background_image_url : null);
  const [modelIds, setModelIds] = useState<string[]>(Array.isArray(data.model_ids) ? data.model_ids.filter((id): id is string => typeof id === 'string') : []);
  const [pickingKnowledge, setPickingKnowledge] = useState(false);
  const [pickingModel, setPickingModel] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length > 0 && !busy;
  const modelName = (id: string) => models.data?.find((model) => model.id === id)?.name ?? id;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const nextData: FolderData = {
        ...(promptAllowed ? { system_prompt: systemPrompt } : {}),
        files: knowledgeMeta(knowledge),
        ...(newer ? { description: description.trim(), model_ids: modelIds } : {}),
      };
      const meta = { background_image_url: background };
      const saved = folder
        ? await updateFolder(client, folder.id, { name: name.trim(), data: nextData, meta })
        : await createFolder(client, { name: name.trim(), parentId: target.mode === 'create' ? target.parentId : null, data: nextData, meta });
      onSaved(saved, target);
      toast(folder ? 'Folder saved' : 'Folder created');
      onClose();
    } catch (error) {
      toast(`Couldn’t save the folder: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const pickBackground = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync(PHOTO);
      const asset = result.canceled ? undefined : result.assets[0];
      if (asset?.base64) setBackground(await picture.maker.fit(`data:image/jpeg;base64,${asset.base64}`, BACKGROUND_SIDE));
    } catch (error) {
      toast(`Couldn’t use the photo: ${describeError(error)}`, 'error');
    }
  };

  const title = folder ? 'Edit Folder' : target.mode === 'create' && target.parentName ? `New Folder in ${target.parentName}` : 'New Folder';
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {busy ? (
          <ActivityIndicator color={palette.textMuted} />
        ) : (
          <Pressable accessibilityRole="button" onPress={() => void save()} disabled={!ready} hitSlop={10}>
            <Text style={[styles.action, styles.strong, { color: ready ? palette.link : palette.textFaint }]}>{folder ? 'Save' : 'Create'}</Text>
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: palette.textMuted }]}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Folder name"
          placeholderTextColor={palette.textFaint}
          autoFocus={!folder}
          accessibilityLabel="Folder name"
          style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
        />

        {newer ? (
          <>
            <Text style={[styles.label, { color: palette.textMuted }]}>Description</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="What this folder is for"
              placeholderTextColor={palette.textFaint}
              multiline
              accessibilityLabel="Description"
              style={[styles.input, styles.short, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
            />
            <Text style={[styles.label, { color: palette.textMuted }]}>Default model</Text>
            <View style={[styles.row, styles.box, { borderColor: palette.border, backgroundColor: palette.surface }]}>
              <Pressable accessibilityRole="button" accessibilityHint="Chooses the model new chats in this folder start with" onPress={() => setPickingModel(true)} style={styles.flex}>
                <Text style={[styles.value, { color: modelIds.length ? palette.text : palette.textMuted }]} numberOfLines={1}>
                  {modelIds.length ? modelIds.map(modelName).join(', ') : 'Use default'}
                </Text>
              </Pressable>
              {modelIds.length ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Use the default model" onPress={() => setModelIds([])} hitSlop={8}>
                  <Icon name="x-mark" size={16} color={palette.textMuted} />
                </Pressable>
              ) : (
                <Icon name="chevron-right" size={14} color={palette.textFaint} />
              )}
            </View>
          </>
        ) : null}

        {promptAllowed ? (
          <>
            <Text style={[styles.label, { color: palette.textMuted }]}>System prompt</Text>
            <TextInput
              value={systemPrompt}
              onChangeText={setSystemPrompt}
              placeholder="Write a system prompt for every chat in this folder"
              placeholderTextColor={palette.textFaint}
              multiline
              textAlignVertical="top"
              accessibilityLabel="System prompt"
              style={[styles.input, styles.long, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
            />
          </>
        ) : null}

        <Text style={[styles.label, { color: palette.textMuted }]}>Knowledge</Text>
        <Text style={[styles.hint, { color: palette.textFaint }]}>Every chat in this folder can use it.</Text>
        {knowledge.map((ref) => (
          <View key={ref.id} style={[styles.row, styles.box, { borderColor: palette.border }]}>
            <Icon name={ref.type === 'file' ? 'document-text' : 'circle-stack'} size={16} color={palette.textMuted} />
            <View style={styles.flex}>
              <Text style={[styles.value, { color: palette.text }]} numberOfLines={1}>
                {ref.name}
              </Text>
              <Text style={[styles.hint, styles.flush, { color: palette.textMuted }]}>{ref.full ? 'Whole document in the prompt' : 'Searched for what’s relevant'}</Text>
            </View>
            <Switch
              accessibilityLabel={`${ref.name}: whole document`}
              value={ref.full}
              onValueChange={(full) => setKnowledge(knowledge.map((item) => (item.id === ref.id ? { ...item, full } : item)))}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${ref.name}`} onPress={() => setKnowledge(knowledge.filter((item) => item.id !== ref.id))} hitSlop={8}>
              <Icon name="x-mark" size={16} color={palette.textMuted} />
            </Pressable>
          </View>
        ))}
        <Pressable accessibilityRole="button" onPress={() => setPickingKnowledge(true)} hitSlop={6} style={styles.linkRow}>
          <Text style={[styles.link, { color: palette.link }]}>Add Knowledge</Text>
        </Pressable>

        <Text style={[styles.label, { color: palette.textMuted }]}>Background picture</Text>
        {background ? <Image source={{ uri: background }} style={[styles.preview, { backgroundColor: palette.surface }]} contentFit="cover" accessibilityLabel="Background picture" /> : null}
        <View style={styles.linkRow}>
          <Pressable accessibilityRole="button" onPress={() => void pickBackground()} hitSlop={6}>
            <Text style={[styles.link, { color: palette.link }]}>{background ? 'Choose Another' : 'Choose Photo'}</Text>
          </Pressable>
          {background ? (
            <Pressable accessibilityRole="button" onPress={() => setBackground(null)} hitSlop={6}>
              <Text style={[styles.link, { color: palette.danger }]}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={[styles.hint, { color: palette.textFaint }]}>Shown faintly behind the folder’s page.</Text>
      </ScrollView>
      <KnowledgePicker visible={pickingKnowledge} chosen={knowledge.map((ref) => ref.id)} onPick={(ref) => setKnowledge([...knowledge, ref])} onClose={() => setPickingKnowledge(false)} />
      <ModelChoice visible={pickingModel} chosen={modelIds[0] ?? null} onPick={(id) => setModelIds(id ? [id] : [])} onClose={() => setPickingModel(false)} />
      {picture.element}
    </KeyboardAvoidingView>
  );
}

/** One model, or none ("Use default"), for new chats in the folder. */
function ModelChoice({ visible, chosen, onPick, onClose }: { visible: boolean; chosen: string | null; onPick: (id: string | null) => void; onClose: () => void }) {
  const palette = usePalette();
  const models = useModels();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return pickerModels(models.data ?? []).filter((model) => !wanted || (model.name ?? model.id).toLowerCase().includes(wanted) || model.id.toLowerCase().includes(wanted));
  }, [models.data, query]);
  const pick = (id: string | null) => {
    onPick(id);
    onClose();
  };
  const row = (key: string, label: string, selected: boolean, onPress: () => void) => (
    <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.row, styles.choice, pressed && { backgroundColor: palette.surface }]}>
      <Text style={[styles.value, styles.flex, { color: palette.text }]} numberOfLines={1}>
        {label}
      </Text>
      {selected ? <Icon name="check" size={16} color={palette.link} /> : null}
    </Pressable>
  );
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <View style={styles.side} />
          <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
            Default Model
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} style={styles.side}>
            <Text style={[styles.action, styles.strong, styles.end, { color: palette.link }]}>Done</Text>
          </Pressable>
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search models"
          placeholderTextColor={palette.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search models"
          style={[styles.input, styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
        />
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {query.trim() ? null : row('default', 'Use default', chosen === null, () => pick(null))}
          {models.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
          {shown.map((model) => row(model.id, model.name ?? model.id, model.id === chosen, () => pick(model.id)))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  end: { textAlign: 'right' },
  side: { width: 60 },
  content: { padding: 16, gap: 8, paddingBottom: 48 },
  label: { fontFamily: fonts.medium, fontSize: 13, marginTop: 10, marginLeft: 4 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginHorizontal: 4 },
  flush: { marginHorizontal: 0 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  short: { minHeight: 64, textAlignVertical: 'top' },
  long: { minHeight: 120, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  flex: { flex: 1 },
  value: { fontFamily: fonts.regular, fontSize: 15 },
  linkRow: { flexDirection: 'row', gap: 20, paddingHorizontal: 4, paddingVertical: 4 },
  link: { fontFamily: fonts.medium, fontSize: 15 },
  preview: { height: 120, borderRadius: radius.md },
  search: { marginHorizontal: 16, marginBottom: 8 },
  list: { paddingHorizontal: 8, paddingBottom: 48 },
  choice: { minHeight: 46, paddingHorizontal: 12, borderRadius: radius.md },
});
