import { imageCompressionSize } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Modal } from '@/components/Modal';
import { useServerConfig, useUserSettings } from '@/lib/server';
import { useSaveUiSettings } from '@/lib/uiSettings';
import { fonts, radius, usePalette } from '@/theme';
import { Note, rowStyles } from './rows';

/** The web's Image Compression size: the largest width and height photos are shrunk to. */
export function PhotoSizeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const palette = usePalette();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      {visible ? <Editor onClose={onClose} /> : <View style={{ backgroundColor: palette.background }} />}
    </Modal>
  );
}

/** A size as people read it: "1024 × 768", "1024 wide", "768 tall", or null with no limit. */
export function photoSizeLabel(size: { width: number | null; height: number | null }): string | null {
  if (size.width && size.height) return `${size.width} × ${size.height}`;
  if (size.width) return `${size.width} wide`;
  if (size.height) return `${size.height} tall`;
  return null;
}

function Editor({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const settings = useUserSettings();
  const config = useServerConfig();
  const save = useSaveUiSettings();
  const start = imageCompressionSize(settings.data?.ui);
  const [width, setWidth] = useState(start.width ? String(start.width) : '');
  const [height, setHeight] = useState(start.height ? String(start.height) : '');
  const [busy, setBusy] = useState(false);
  const limits = (config.data?.file as { image_compression?: { width?: unknown; height?: unknown } } | undefined)?.image_compression;
  const admin = photoSizeLabel({ width: typeof limits?.width === 'number' && limits.width > 0 ? limits.width : null, height: typeof limits?.height === 'number' && limits.height > 0 ? limits.height : null });
  const side = (text: string) => {
    const number = Number(text);
    return text.trim() && Number.isFinite(number) && number > 0 ? Math.round(number) : null;
  };

  const done = async () => {
    setBusy(true);
    const saved = await save({ imageCompressionSize: { width: side(width), height: side(height) } });
    setBusy(false);
    if (saved) onClose();
  };

  const field = (label: string, value: string, onChange: (text: string) => void) => (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(text) => onChange(text.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        placeholder="No limit"
        placeholderTextColor={palette.textFaint}
        accessibilityLabel={`${label} in pixels`}
        style={[styles.input, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} style={styles.side}>
          <Text style={[styles.headerAction, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Photo Size
        </Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void done()} hitSlop={10} style={[styles.side, styles.end]}>
          <Text style={[styles.headerAction, styles.save, { color: busy ? palette.textFaint : palette.link }]}>Save</Text>
        </Pressable>
      </View>
      <View style={rowStyles.content}>
        <View style={styles.fields}>
          {field('Width', width, setWidth)}
          <Text style={[styles.times, { color: palette.textMuted }]}>×</Text>
          {field('Height', height, setHeight)}
        </View>
        <Note>
          In pixels. Photos you attach are shrunk to fit, keeping their shape; leave one empty to limit only the other.
          {admin ? ` Your admin’s limit (${admin}) applies anyway.` : ''}
        </Note>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  side: { width: 64 },
  end: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  headerAction: { fontFamily: fonts.regular, fontSize: 16 },
  save: { fontFamily: fonts.semibold },
  fields: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  field: { flex: 1, gap: 4 },
  fieldLabel: { fontFamily: fonts.medium, fontSize: 13, marginLeft: 4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 16, textAlign: 'center' },
  times: { fontFamily: fonts.regular, fontSize: 18, paddingBottom: 10 },
});
