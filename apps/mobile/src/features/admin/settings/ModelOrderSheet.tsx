import { fullModelOrder, getModelsConfig, movedInList, saveModelsConfig, withListedOrder, withModelOrder, type AdminModel } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { IconButton } from '@/components/IconButton';
import { MenuButton } from '@/components/Menu';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { ModelAvatar } from '@/features/chat/ModelAvatar';
import { Note } from '@/features/settings/rows';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

/**
 * The order everyone's model pickers show models in (the web drags them; here each moves with its
 * arrows, or to the top or the bottom). Saved as a whole over the server's settings as they are
 * then; ids of models not listed now (a connection away) keep their places.
 */
export function ModelOrderSheet({ visible, models, onClose, onSaved }: { visible: boolean; models: AdminModel[]; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Loader models={models} onClose={onClose} onSaved={onSaved} /> : null}
    </Modal>
  );
}

function Loader({ models, onClose, onSaved }: { models: AdminModel[]; onClose: () => void; onSaved: () => void }) {
  const palette = usePalette();
  const { client } = useAuthed();
  // Read again as the sheet opens, so the order starts from what's saved now.
  const config = useQuery({ queryKey: ['admin', 'models-config'], queryFn: () => getModelsConfig(client), staleTime: 0 });
  if (config.data) {
    const byId = new Map(models.map((model) => [model.id, model]));
    const initial = fullModelOrder(config.data, [...byId.keys()]).filter((id) => byId.has(id));
    return <Order initial={initial} byId={byId} onClose={onClose} onSaved={onSaved} />;
  }
  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <Header title="Order in Pickers" onCancel={onClose} />
      {config.error ? (
        <Pressable accessibilityRole="button" onPress={() => void config.refetch()} style={styles.loading}>
          <Text style={[styles.hint, { color: palette.danger }]}>{`Couldn’t load it: ${describeError(config.error)}. Tap to try again.`}</Text>
        </Pressable>
      ) : (
        <ActivityIndicator style={styles.loading} color={palette.textMuted} />
      )}
    </View>
  );
}

function Header({ title, onCancel, save }: { title: string; onCancel: () => void; save?: { ready: boolean; busy: boolean; onPress: () => void } }) {
  const palette = usePalette();
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={10}>
        <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
      </Pressable>
      <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      {save?.busy ? (
        <ActivityIndicator color={palette.textMuted} />
      ) : (
        <Pressable accessibilityRole="button" onPress={save?.onPress} disabled={!save?.ready} hitSlop={10}>
          <Text style={[styles.action, styles.strong, { color: save?.ready ? palette.link : palette.textFaint }]}>Save</Text>
        </Pressable>
      )}
    </View>
  );
}

function Order({ initial, byId, onClose, onSaved }: { initial: string[]; byId: Map<string, AdminModel>; onClose: () => void; onSaved: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  // As the sheet opened: a reload behind it (the app coming back) doesn't move the start.
  const [start] = useState(initial);
  const [order, setOrder] = useState(initial);
  const [busy, setBusy] = useState(false);
  const changed = order.some((id, index) => id !== start[index]);
  const move = (from: number, to: number) => setOrder((current) => movedInList(current, from, to));

  const save = async () => {
    setBusy(true);
    try {
      const fresh = await getModelsConfig(client);
      await saveModelsConfig(client, withModelOrder(fresh, withListedOrder(fullModelOrder(fresh, [...byId.keys()]), order)));
      onSaved();
      toast('Order saved: everyone’s model pickers follow it');
      onClose();
    } catch (error) {
      toast(`Couldn’t save it: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <Header title="Order in Pickers" onCancel={onClose} save={{ ready: changed && !busy, busy, onPress: () => void save() }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Note>Everyone’s model pickers show models in this order, on the web and here. Move one with its arrows, or with … to the top or the bottom, then Save.</Note>
        {order.length ? null : <Note>There are no models to order.</Note>}
        {order.map((id, index) => {
          const model = byId.get(id);
          const name = model?.name ?? id;
          return (
            <View key={id} style={[styles.row, { borderColor: palette.border, opacity: model?.isActive === false ? 0.6 : 1 }]}>
              <Text style={[styles.place, { color: palette.textFaint }]}>{index + 1}</Text>
              <ModelAvatar modelId={id} size={28} rounded={8} />
              <View style={styles.grow}>
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                  {name}
                </Text>
                {name !== id ? (
                  <Text style={[styles.hint, { color: palette.textFaint }]} numberOfLines={1}>
                    {id}
                  </Text>
                ) : null}
              </View>
              <IconButton icon="chevron-up" label={`Move ${name} up`} size={18} color={palette.textMuted} disabled={index === 0} onPress={() => move(index, index - 1)} />
              <IconButton icon="chevron-down" label={`Move ${name} down`} size={18} color={palette.textMuted} disabled={index === order.length - 1} onPress={() => move(index, index + 1)} />
              <MenuButton
                label={`More for ${name}`}
                size={18}
                color={palette.textMuted}
                items={[
                  { key: 'top', label: 'Move to Top', icon: 'bars-arrow-up', onPress: () => move(index, 0) },
                  { key: 'bottom', label: 'Move to Bottom', icon: 'bars-arrow-down', onPress: () => move(index, order.length - 1) },
                ]}
              />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  strong: { fontFamily: fonts.semibold },
  loading: { padding: 32, alignItems: 'center' },
  content: { padding: 16, gap: 8, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  place: { fontFamily: fonts.mono, fontSize: 12, minWidth: 22, textAlign: 'right' },
  grow: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
