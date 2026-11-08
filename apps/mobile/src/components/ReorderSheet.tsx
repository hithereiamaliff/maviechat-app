import { movedInList } from '@maviechat/owui-protocol';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { IconButton } from '@/components/IconButton';
import { MenuButton } from '@/components/Menu';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { fonts, radius, usePalette } from '@/theme';

/** One thing to put in order. */
export interface ReorderItem {
  id: string;
  label: string;
  /** Under the label (an id, say). */
  hint?: string;
  /** Before the label: a picture or an icon. */
  leading?: ReactNode;
  /** Shown faint (switched off, say). */
  dim?: boolean;
}

/**
 * An order sheet's inside (the web drags these; here each moves with its arrows, or with … to the
 * top or the bottom): Cancel, the title and Save; a note; the items in order; with `switches`,
 * each also on or off (pinned, say), the order kept for all. Save hands over the new order (and
 * what's on); the sheet closes once that answers true, and stays (after a message) otherwise.
 */
export function ReorderPanel({
  title,
  note,
  items,
  switches,
  onSave,
  onClose,
}: {
  title: string;
  note: string;
  items: ReorderItem[];
  switches?: { label: (item: ReorderItem) => string; on: string[] };
  onSave: (order: string[], on: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const palette = usePalette();
  const toast = useToast();
  // As the sheet opened: a reload behind it doesn't move the start.
  const [start] = useState(() => ({ order: items.map((item) => item.id), on: switches?.on ?? [] }));
  const [order, setOrder] = useState(start.order);
  const [on, setOn] = useState(start.on);
  const [busy, setBusy] = useState(false);
  const byId = new Map(items.map((item) => [item.id, item]));
  const shown = order.filter((id) => byId.has(id));
  const changed = order.some((id, index) => id !== start.order[index]) || on.length !== start.on.length || on.some((id) => !start.on.includes(id));
  const move = (from: number, to: number) => setOrder((current) => movedInList(current, from, to));

  const save = async () => {
    setBusy(true);
    try {
      if (await onSave(order, order.filter((id) => on.includes(id)))) onClose();
    } catch (error) {
      toast(`Couldn’t save it: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
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
          <Pressable accessibilityRole="button" onPress={() => void save()} disabled={!changed} hitSlop={10}>
            <Text style={[styles.action, styles.strong, { color: changed ? palette.link : palette.textFaint }]}>Save</Text>
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.note, { color: palette.textFaint }]}>{note}</Text>
        {shown.length ? null : <Text style={[styles.note, { color: palette.textFaint }]}>There’s nothing to put in order.</Text>}
        {shown.map((id, index) => {
          const item = byId.get(id) as ReorderItem;
          const where = order.indexOf(id);
          const isOn = on.includes(id);
          return (
            <View key={id} style={[styles.row, { borderColor: palette.border, opacity: item.dim || (switches && !isOn) ? 0.6 : 1 }]}>
              <Text style={[styles.place, { color: palette.textFaint }]}>{index + 1}</Text>
              {item.leading}
              <View style={styles.grow}>
                <Text style={[styles.label, { color: palette.text }]} numberOfLines={1}>
                  {item.label}
                </Text>
                {item.hint ? (
                  <Text style={[styles.hint, { color: palette.textFaint }]} numberOfLines={1}>
                    {item.hint}
                  </Text>
                ) : null}
              </View>
              {switches ? <Switch accessibilityLabel={switches.label(item)} value={isOn} onValueChange={(value) => setOn((current) => (value ? [...current, id] : current.filter((other) => other !== id)))} /> : null}
              <IconButton icon="chevron-up" label={`Move ${item.label} up`} size={18} color={palette.textMuted} disabled={where === 0} onPress={() => move(where, where - 1)} />
              <IconButton icon="chevron-down" label={`Move ${item.label} down`} size={18} color={palette.textMuted} disabled={where === order.length - 1} onPress={() => move(where, where + 1)} />
              <MenuButton
                label={`More for ${item.label}`}
                size={18}
                color={palette.textMuted}
                items={[
                  { key: 'top', label: 'Move to Top', icon: 'bars-arrow-up', onPress: () => move(where, 0) },
                  { key: 'bottom', label: 'Move to Bottom', icon: 'bars-arrow-down', onPress: () => move(where, order.length - 1) },
                ]}
              />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** The panel in a sheet of its own. */
export function ReorderSheet({ visible, onClose, ...panel }: Omit<Parameters<typeof ReorderPanel>[0], 'onClose'> & { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <ReorderPanel {...panel} onClose={onClose} /> : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  content: { padding: 16, gap: 8, paddingBottom: 48 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  place: { fontFamily: fonts.mono, fontSize: 12, minWidth: 22, textAlign: 'right' },
  grow: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.semibold, fontSize: 15 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
