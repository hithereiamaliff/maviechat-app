import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { SideScroll } from '@/components/SideScroll';
import { fonts, radius, usePalette } from '@/theme';

/** A chip in the composer's row of things going with the next message. */
export interface ExtraChip {
  key: string;
  icon: IconName;
  label: string;
  /** A photo's thumbnail. */
  image?: string | null;
  onRemove: () => void;
}

/** The photos, files and references going with the next message, each removable. */
export function DtExtrasStrip({ chips }: { chips: ExtraChip[] }) {
  const palette = usePalette();
  if (chips.length === 0) return null;
  return (
    <SideScroll showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} keyboardShouldPersistTaps="handled">
      {chips.map((chip) =>
        chip.image ? (
          <View key={chip.key} style={styles.thumbWrap}>
            <Image source={{ uri: chip.image }} style={[styles.thumb, { backgroundColor: palette.surface }]} contentFit="cover" accessibilityLabel={chip.label} />
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${chip.label}`} onPress={chip.onRemove} hitSlop={8} style={[styles.thumbRemove, { backgroundColor: palette.text }]}>
              <Icon name="x-mark" size={11} color={palette.background} strokeWidth={2.4} />
            </Pressable>
          </View>
        ) : (
          <View key={chip.key} style={[styles.chip, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Icon name={chip.icon} size={14} color={palette.textMuted} />
            <Text style={[styles.chipText, { color: palette.text }]} numberOfLines={1}>
              {chip.label}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${chip.label}`} onPress={chip.onRemove} hitSlop={8}>
              <Icon name="x-mark" size={13} color={palette.textMuted} strokeWidth={2} />
            </Pressable>
          </View>
        ),
      )}
    </SideScroll>
  );
}

export interface PickItem {
  id: string;
  label: string;
  hint?: string;
}

/** A list to pick notebooks, earlier chats or knowledge bases from. */
export function DtPickSheet({
  visible,
  title,
  note,
  items,
  selected,
  loading,
  empty,
  onToggle,
  onClose,
}: {
  visible: boolean;
  title: string;
  note?: string;
  items: PickItem[];
  selected: string[];
  loading: boolean;
  empty: string;
  onToggle: (item: PickItem) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: palette.background }]}>
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: palette.text }]} accessibilityRole="header">
            {title}
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
            <Text style={[styles.done, { color: palette.link }]}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetContent}>
          {note ? <Text style={[styles.note, { color: palette.textMuted }]}>{note}</Text> : null}
          {loading ? (
            <ActivityIndicator style={styles.loading} color={palette.textMuted} />
          ) : items.length === 0 ? (
            <Text style={[styles.note, { color: palette.textMuted }]}>{empty}</Text>
          ) : (
            <View style={[styles.group, { borderColor: palette.border }]}>
              {items.map((item, index) => {
                const on = selected.includes(item.id);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    onPress={() => onToggle(item)}
                    style={({ pressed }) => [
                      styles.row,
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
                      pressed && { backgroundColor: palette.surface },
                    ]}>
                    <View style={styles.rowText}>
                      <Text style={[styles.rowLabel, { color: palette.text }]} numberOfLines={2}>
                        {item.label}
                      </Text>
                      {item.hint ? <Text style={[styles.rowHint, { color: palette.textFaint }]}>{item.hint}</Text> : null}
                    </View>
                    {on ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** A photo or file a message went with: a thumbnail (loaded signed in) or a chip. */
export interface SentAttachment {
  key: string;
  type: string;
  filename: string;
  /** Where to load a photo from; headers carry the sign-in for DeepTutor's own address. */
  uri: string | null;
  headers?: Record<string, string>;
}

/** Under your message: what it went with. */
export function DtSentExtras({ attachments, references }: { attachments: SentAttachment[]; references: { key: string; icon: IconName; label: string }[] }) {
  const palette = usePalette();
  if (attachments.length === 0 && references.length === 0) return null;
  const chip = (key: string, icon: IconName, label: string): ReactNode => (
    <View key={key} style={[styles.sentChip, { borderColor: palette.border }]}>
      <Icon name={icon} size={13} color={palette.textMuted} />
      <Text style={[styles.sentChipText, { color: palette.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
  return (
    <View style={styles.sent}>
      {attachments.map((attachment) =>
        attachment.type === 'image' && attachment.uri ? (
          <Image
            key={attachment.key}
            source={{ uri: attachment.uri, headers: attachment.headers }}
            style={[styles.sentImage, { backgroundColor: palette.surface }]}
            contentFit="cover"
            accessibilityLabel={attachment.filename}
          />
        ) : (
          chip(attachment.key, 'document-text', attachment.filename)
        ),
      )}
      {references.map((reference) => chip(reference.key, reference.icon, reference.label))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { gap: 8, paddingBottom: 6, alignItems: 'center' },
  thumbWrap: { width: 52, height: 52 },
  thumb: { width: 52, height: 52, borderRadius: radius.md },
  thumbRemove: { position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 220, height: 34, paddingHorizontal: 10, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth },
  chipText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 13 },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  sheetTitle: { fontFamily: fonts.semibold, fontSize: 17 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  sheetContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginHorizontal: 4 },
  loading: { marginTop: 24 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 14, paddingVertical: 8 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: fonts.regular, fontSize: 15 },
  rowHint: { fontFamily: fonts.regular, fontSize: 12 },
  sent: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, marginTop: 6 },
  sentImage: { width: 120, height: 120, borderRadius: radius.lg },
  sentChip: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 240, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  sentChipText: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 12 },
});
