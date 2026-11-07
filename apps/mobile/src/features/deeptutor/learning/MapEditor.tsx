import { DT_POINT_TYPES, mapInput, mapProblems, saveMasteryMap, type DtMapModuleInput, type DtMasteryTopic } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { POINT_TYPES } from './PointSheet';

/** The path's modules and knowledge points, to rename, reorder, add or remove; saved together. */
export function MapEditor({ topic, visible, onClose }: { topic: DtMasteryTopic; visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <EditorBody topic={topic} onClose={onClose} /> : null}
    </Modal>
  );
}

const move = <T,>(list: T[], from: number, to: number): T[] => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
};

function EditorBody({ topic, onClose }: { topic: DtMasteryTopic; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const empty = topic.modules.length === 0;
  const [modules, setModules] = useState<DtMapModuleInput[]>(() => (empty ? [{ name: 'Module 1', points: [{ name: '', type: 'concept' }] }] : mapInput(topic)));
  const [saving, setSaving] = useState(false);
  const existing = new Set(topic.modules.map((module) => module.id));
  const problems = mapProblems(modules, existing);

  const update = (index: number, change: (module: DtMapModuleInput) => DtMapModuleInput) => setModules((list) => list.map((module, at) => (at === index ? change(module) : module)));

  const save = async () => {
    if (problems.length) {
      Alert.alert("Can't save yet", problems.join('\n'));
      return;
    }
    setSaving(true);
    try {
      const saved = await saveMasteryMap(client, topic.pathId, modules);
      queryClient.setQueryData([DT_QUERY_ROOT, session.baseUrl, 'mastery', 'topic', topic.pathId], saved);
      void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'mastery'] });
      toast('Modules saved', 'success');
      onClose();
    } catch (error) {
      toast(`Couldn't save: ${describeError(error)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const input = [styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }];
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={[styles.link, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {empty ? 'Write the Modules' : 'Edit Modules'}
        </Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.note, { color: palette.textMuted }]}>
          {empty
            ? 'Name the modules and the points to learn in each. You can also let the tutor design them in an Outline chat.'
            : "Renaming keeps a point's progress. Removing one removes its progress and reviews."}
        </Text>
        {modules.map((module, index) => (
          <View key={module.id ?? `new-${index}`} style={[styles.module, { borderColor: palette.border }]}>
            <View style={styles.moduleHead}>
              <Text style={[styles.label, { color: palette.textMuted }]}>{`Module ${index + 1}`}</Text>
              <IconButton icon="chevron-up" label="Move module up" size={16} disabled={index === 0} onPress={() => setModules((list) => move(list, index, index - 1))} />
              <IconButton icon="chevron-down" label="Move module down" size={16} disabled={index === modules.length - 1} onPress={() => setModules((list) => move(list, index, index + 1))} />
              <IconButton icon="trash" label="Remove module" size={16} disabled={modules.length === 1} onPress={() => setModules((list) => list.filter((_, at) => at !== index))} />
            </View>
            <TextInput value={module.name} onChangeText={(name) => update(index, (item) => ({ ...item, name }))} placeholder="Module name" placeholderTextColor={palette.textFaint} maxLength={200} style={input} accessibilityLabel={`Module ${index + 1} name`} />
            {module.points.map((point, pointIndex) => (
              <View key={point.id ?? `p-${index}-${pointIndex}`} style={styles.point}>
                <TextInput
                  value={point.name}
                  onChangeText={(name) => update(index, (item) => ({ ...item, points: item.points.map((entry, at) => (at === pointIndex ? { ...entry, name } : entry)) }))}
                  placeholder="Knowledge point"
                  placeholderTextColor={palette.textFaint}
                  maxLength={200}
                  style={input}
                  accessibilityLabel={`Point ${pointIndex + 1} in module ${index + 1}`}
                />
                <View style={styles.pointTools}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.types} keyboardShouldPersistTaps="handled">
                    {DT_POINT_TYPES.map((type) => {
                      const on = point.type === type;
                      return (
                        <Pressable
                          key={type}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on }}
                          onPress={() => update(index, (item) => ({ ...item, points: item.points.map((entry, at) => (at === pointIndex ? { ...entry, type } : entry)) }))}
                          style={[styles.type, { borderColor: on ? palette.text : palette.border }]}>
                          <Text style={[styles.typeText, { color: on ? palette.text : palette.textMuted }]}>{POINT_TYPES[type]}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <IconButton icon="chevron-up" label="Move point up" size={15} disabled={pointIndex === 0} onPress={() => update(index, (item) => ({ ...item, points: move(item.points, pointIndex, pointIndex - 1) }))} />
                  <IconButton
                    icon="chevron-down"
                    label="Move point down"
                    size={15}
                    disabled={pointIndex === module.points.length - 1}
                    onPress={() => update(index, (item) => ({ ...item, points: move(item.points, pointIndex, pointIndex + 1) }))}
                  />
                  <IconButton
                    icon="x-mark"
                    label="Remove point"
                    size={15}
                    disabled={module.points.length === 1}
                    onPress={() => update(index, (item) => ({ ...item, points: item.points.filter((_, at) => at !== pointIndex) }))}
                  />
                </View>
              </View>
            ))}
            <Pressable accessibilityRole="button" onPress={() => update(index, (item) => ({ ...item, points: [...item.points, { name: '', type: 'concept' }] }))} style={styles.add} hitSlop={4}>
              <Icon name="plus" size={15} color={palette.link} />
              <Text style={[styles.addText, { color: palette.link }]}>Add Knowledge Point</Text>
            </Pressable>
          </View>
        ))}
        {modules.length < 20 ? (
          <Pressable accessibilityRole="button" onPress={() => setModules((list) => [...list, { name: `Module ${list.length + 1}`, points: [{ name: '', type: 'concept' }] }])} style={styles.add} hitSlop={4}>
            <Icon name="plus" size={16} color={palette.link} />
            <Text style={[styles.addText, { color: palette.link }]}>Add Module</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        <Button label="Save" onPress={() => void save()} loading={saving} disabled={saving} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  link: { fontFamily: fonts.medium, fontSize: 16, minWidth: 60 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  spacer: { minWidth: 60 },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  module: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 12, gap: 8 },
  moduleHead: { flexDirection: 'row', alignItems: 'center' },
  label: { flex: 1, fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  point: { gap: 4, paddingLeft: 8 },
  pointTools: { flexDirection: 'row', alignItems: 'center' },
  types: { gap: 6, paddingRight: 6 },
  type: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  typeText: { fontFamily: fonts.medium, fontSize: 12 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  addText: { fontFamily: fonts.medium, fontSize: 14 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
});
