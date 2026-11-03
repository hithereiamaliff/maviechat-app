import { DT_COLLECTION_COLORS } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { fonts, radius, usePalette } from '@/theme';
import { COLLECTION_COLORS } from './labels';

/** A collection's name and colour, for a new collection or to change one. */
export function CollectionSheet({
  visible,
  title,
  initial,
  onClose,
  onSave,
}: {
  visible: boolean;
  title: string;
  initial: { name: string; color: string };
  onClose: () => void;
  onSave: (value: { name: string; color: string }) => Promise<void>;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Editor title={title} initial={initial} onClose={onClose} onSave={onSave} /> : null}
    </Modal>
  );
}

function Editor({ title, initial, onClose, onSave }: { title: string; initial: { name: string; color: string }; onClose: () => void; onSave: (value: { name: string; color: string }) => Promise<void> }) {
  const palette = usePalette();
  const dark = useColorScheme() === 'dark';
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [saving, setSaving] = useState(false);
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.link, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          {title}
        </Text>
        <View style={styles.spacer} />
      </View>
      <View style={styles.content}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name, e.g. Biology revision"
          placeholderTextColor={palette.textFaint}
          autoFocus
          maxLength={300}
          style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          accessibilityLabel="Collection name"
        />
        <Text style={[styles.label, { color: palette.textMuted }]}>Colour</Text>
        <View style={styles.colors}>
          {DT_COLLECTION_COLORS.map((item) => {
            const swatch = COLLECTION_COLORS[item] ?? COLLECTION_COLORS[''];
            const on = item === color;
            return (
              <Pressable
                key={item || 'plain'}
                accessibilityRole="radio"
                accessibilityLabel={swatch?.label}
                accessibilityState={{ checked: on }}
                onPress={() => setColor(item)}
                style={[styles.color, { backgroundColor: dark ? swatch?.dark : swatch?.light, borderColor: on ? palette.text : 'transparent' }]}>
                {on ? <Icon name="check" size={14} color="#ffffff" strokeWidth={2.4} /> : null}
              </Pressable>
            );
          })}
        </View>
        <Button
          label="Save"
          loading={saving}
          disabled={saving}
          onPress={() => {
            setSaving(true);
            void onSave({ name: name.trim(), color }).finally(() => setSaving(false));
          }}
        />
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
  content: { paddingHorizontal: 20, gap: 14 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, fontFamily: fonts.regular, fontSize: 16 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  color: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
