import {
  matchesModelFilter,
  modelFilterOptions,
  modelSizeLabel,
  modelTags,
  OwuiHttpError,
  pickerModels,
  saveDefaultModels,
  type ModelItem,
} from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import { ModelAvatar } from './ModelAvatar';
import { searchModels } from './search';

interface ModelPickerProps {
  visible: boolean;
  models: ModelItem[];
  selectedId: string | null;
  defaultId: string | null;
  onSelect: (model: ModelItem) => void;
  onClose: () => void;
}

/**
 * Choose the model for the next message, as in the web's selector: fuzzy search, a filter
 * (All, Local, External or a tag), hidden models left out. "Set as default" saves the pick for new chats.
 */
export function ModelPicker({ visible, models, selectedId, defaultId, onSelect, onClose }: ModelPickerProps) {
  const palette = usePalette();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const listed = useMemo(() => pickerModels(models), [models]);
  const filters = useMemo(() => modelFilterOptions(listed), [listed]);
  const activeFilter = filters.some((option) => option.value === filter) ? filter : '';
  const shown = useMemo(
    () => searchModels(listed, query).filter((model) => matchesModelFilter(model, activeFilter)),
    [listed, query, activeFilter],
  );

  const setDefault = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await saveDefaultModels(client, [selectedId]);
      await queryClient.invalidateQueries({ queryKey: ['user-settings'] });
      toast('Default model saved', 'success');
    } catch (error) {
      toast(
        error instanceof OwuiHttpError && error.status === 403
          ? 'Your account may not change its default model.'
          : "Couldn't save the default model.",
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]}>Models</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
            <Text style={[styles.done, { color: palette.link }]}>Done</Text>
          </Pressable>
        </View>
        <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search a model"
            placeholderTextColor={palette.textFaint}
            autoCorrect={false}
            autoCapitalize="none"
            style={[styles.searchInput, { color: palette.text }]}
          />
        </View>
        {filters.length > 0 ? (
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.filters}>
              {[{ value: '', label: 'All' }, ...filters].map((option) => {
                const selected = option.value === activeFilter;
                return (
                  <Pressable
                    key={option.value || 'all'}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setFilter(option.value)}
                    style={[styles.filter, { borderColor: palette.border }, selected && { backgroundColor: palette.surfaceStrong }]}>
                    <Text style={[styles.filterText, { color: selected ? palette.text : palette.textMuted }]}>{capitalise(option.label)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {shown.map((model) => {
            const selected = model.id === selectedId;
            const description = model.info?.meta?.description;
            const size = modelSizeLabel(model);
            const tags = modelTags(model);
            return (
              <Pressable
                key={model.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={[model.name, size, model.loaded ? 'loaded' : null, tags.length ? `tags ${tags.join(', ')}` : null].filter(Boolean).join(', ')}
                onPress={() => {
                  onSelect(model);
                  onClose();
                }}
                style={({ pressed }) => [styles.row, (pressed || selected) && { backgroundColor: palette.surface }]}>
                <ModelAvatar modelId={model.id} size={24} />
                <View style={styles.rowText}>
                  <View style={styles.nameLine}>
                    <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                      {model.name}
                    </Text>
                    {size ? <Text style={[styles.meta, { color: palette.textFaint }]}>{size}</Text> : null}
                    {model.loaded ? <View style={[styles.loaded, { backgroundColor: palette.success }]} /> : null}
                    {tags.length > 0 ? <Icon name="tag" size={13} color={palette.textFaint} /> : null}
                    {model.connection_type === 'external' ? <Icon name="link" size={13} color={palette.textFaint} /> : null}
                    {model.id === defaultId ? <Text style={[styles.meta, { color: palette.textFaint }]}>default</Text> : null}
                  </View>
                  {description ? (
                    <Text style={[styles.description, { color: palette.textMuted }]} numberOfLines={1}>
                      {description}
                    </Text>
                  ) : null}
                </View>
                {selected ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
              </Pressable>
            );
          })}
          {shown.length === 0 ? <Text style={[styles.empty, { color: palette.textMuted }]}>No models found</Text> : null}
        </ScrollView>
        {selectedId && selectedId !== defaultId ? (
          <View style={styles.footer}>
            <Button label="Set as default" variant="secondary" loading={saving} onPress={() => void setDefault()} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 18 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  filters: { gap: 6, paddingHorizontal: 16, paddingBottom: 6 },
  filter: { height: 30, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth },
  filterText: { fontFamily: fonts.medium, fontSize: 13 },
  list: { paddingHorizontal: 8, paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 11, borderRadius: radius.md },
  rowText: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 15 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  loaded: { width: 6, height: 6, borderRadius: 3 },
  description: { fontFamily: fonts.regular, fontSize: 13 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 24 },
  footer: { paddingHorizontal: 16, paddingBottom: 28, paddingTop: 8 },
});

/** Tags are stored in lower case; the web shows them capitalised. */
function capitalise(label: string): string {
  return label.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}
