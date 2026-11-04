import { clearMemories, deleteMemory, filterMemories, listMemories, memoryOn, OwuiHttpError, type Memory } from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { MenuButton } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed, useServerConfig, useUserSettings } from '@/lib/server';
import { useCanSaveSettings, useSaveUiSettings } from '@/lib/uiSettings';
import { fonts, radius, usePalette } from '@/theme';
import { MemoryEditor, MEMORY_TYPE_LABELS } from './MemoryEditor';
import { ActionRow, Group, Note, rowStyles, SectionTitle, SwitchRow } from './rows';

const day = (seconds: number) => (seconds ? new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function problemText(error: unknown): string {
  if (error instanceof OwuiHttpError && error.status === 404) return 'Memories are turned off on this server.';
  if (error instanceof OwuiHttpError && error.status === 403) return 'Your admin doesn’t let this account use memories.';
  return `Couldn’t load your memories: ${describeError(error)}`;
}

/**
 * Open WebUI's Personalization tab: the Memory switch (saved with your account at once) and, while
 * it's on, the things you've asked models to remember: search, add, edit, remove, or clear them all.
 */
export function PersonalizationSettings() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const settings = useUserSettings();
  const config = useServerConfig();
  const save = useSaveUiSettings();
  const canSave = useCanSaveSettings();
  const on = memoryOn(settings.data?.ui, config.data);
  const memories = useQuery({ queryKey: ['memories'], queryFn: () => listMemories(client), enabled: on });
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Memory | 'new' | null>(null);
  const all = memories.data ?? [];
  const shown = filterMemories(all, query);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['memories'] });
  const remove = (memory: Memory) =>
    Alert.alert('Delete this memory?', memory.content.length > 200 ? `${memory.content.slice(0, 200)}…` : memory.content, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteMemory(client, memory.id).then(
            () => {
              refresh();
              toast('Memory deleted');
            },
            (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error'),
          );
        },
      },
    ]);
  const clearAll = () =>
    Alert.alert('Clear all memories?', `All ${all.length} are deleted, and models won’t know them any more. This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear All',
        style: 'destructive',
        onPress: () => {
          clearMemories(client).then(
            () => {
              refresh();
              toast('Memories cleared');
            },
            (error: unknown) => toast(`Couldn’t clear them: ${describeError(error)}`, 'error'),
          );
        },
      },
    ]);

  return (
    <ScrollView contentContainerStyle={rowStyles.content} keyboardShouldPersistTaps="handled">
      <Group>
        <SwitchRow
          label="Memory"
          hint="Models get what you’ve asked them to remember, in every chat."
          value={on}
          disabled={!canSave}
          onChange={(value) => void save({ memory: value })}
        />
      </Group>
      {!canSave ? <Note>Your admin doesn’t let this account change its settings.</Note> : null}
      {on ? (
        <>
          <View style={styles.heading}>
            <SectionTitle title={memories.data ? `Memories (${all.length})` : 'Memories'} />
            <Pressable accessibilityRole="button" accessibilityLabel="Add a memory" onPress={() => setEditing('new')} hitSlop={8} style={styles.add}>
              <Icon name="plus" size={15} color={palette.link} />
              <Text style={[styles.addText, { color: palette.link }]}>Add</Text>
            </Pressable>
          </View>
          {all.length > 3 ? (
            <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search memories"
                placeholderTextColor={palette.textFaint}
                maxLength={500}
                clearButtonMode="while-editing"
                accessibilityLabel="Search memories"
                style={[styles.searchInput, { color: palette.text }]}
              />
            </View>
          ) : null}
          {memories.isLoading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
          {memories.isError ? <Note>{problemText(memories.error)}</Note> : null}
          {memories.data && !all.length ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: palette.textMuted }]}>Nothing yet. Add something models should know about you, or keep in mind.</Text>
              <Button label="Add a Memory" variant="secondary" onPress={() => setEditing('new')} />
            </View>
          ) : null}
          {all.length && !shown.length ? <Note>No memories match.</Note> : null}
          {shown.length ? (
            <Group>
              {shown.map((memory) => (
                <Pressable
                  key={memory.id}
                  accessibilityRole="button"
                  accessibilityHint="Edits this memory"
                  onPress={() => setEditing(memory)}
                  style={({ pressed }) => [styles.memory, pressed && { backgroundColor: palette.surface }]}>
                  <View style={styles.memoryText}>
                    <Text style={[styles.content, { color: palette.text }]} numberOfLines={6}>
                      {memory.content}
                    </Text>
                    <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                      {[MEMORY_TYPE_LABELS[memory.type], memory.path, day(memory.updated_at)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <MenuButton
                    label="Memory options"
                    size={18}
                    color={palette.textMuted}
                    items={[
                      { key: 'edit', label: 'Edit', icon: 'pencil', onPress: () => setEditing(memory) },
                      { key: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: () => remove(memory) },
                    ]}
                  />
                </Pressable>
              ))}
            </Group>
          ) : null}
          {all.length ? (
            <View style={styles.clear}>
              <Group>
                <ActionRow label="Clear All Memories" destructive onPress={clearAll} />
              </Group>
            </View>
          ) : null}
        </>
      ) : (
        <Note>While Memory is off, models don’t see your memories. They stay saved for when you turn it on.</Note>
      )}
      <MemoryEditor memory={editing} onClose={() => setEditing(null)} onSaved={refresh} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingBottom: 1, paddingRight: 4 },
  addText: { fontFamily: fonts.medium, fontSize: 14 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 38, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  loading: { marginTop: 16 },
  empty: { gap: 12, paddingVertical: 8 },
  emptyText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginHorizontal: 4 },
  memory: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingLeft: 14, paddingRight: 4, paddingVertical: 10 },
  memoryText: { flex: 1, gap: 4 },
  content: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
  clear: { marginTop: 12 },
});
