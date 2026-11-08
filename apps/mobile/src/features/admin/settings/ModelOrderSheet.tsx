import { fullModelOrder, getModelsConfig, saveModelsConfig, withListedOrder, withModelOrder, type AdminModel } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Modal } from '@/components/Modal';
import { ReorderPanel, type ReorderItem } from '@/components/ReorderSheet';
import { useToast } from '@/components/Toast';
import { ModelAvatar } from '@/features/chat/ModelAvatar';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, usePalette } from '@/theme';

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
  const toast = useToast();
  const { client } = useAuthed();
  // Read again as the sheet opens, so the order starts from what's saved now.
  const config = useQuery({ queryKey: ['admin', 'models-config'], queryFn: () => getModelsConfig(client), staleTime: 0 });
  if (config.data) {
    const byId = new Map(models.map((model) => [model.id, model]));
    const items = fullModelOrder(config.data, [...byId.keys()]).flatMap((id): ReorderItem[] => {
      const model = byId.get(id);
      return model ? [{ id, label: model.name, hint: model.name !== id ? id : undefined, leading: <ModelAvatar modelId={id} size={28} rounded={8} />, dim: !model.isActive }] : [];
    });
    const save = async (order: string[]) => {
      const fresh = await getModelsConfig(client);
      await saveModelsConfig(client, withModelOrder(fresh, withListedOrder(fullModelOrder(fresh, [...byId.keys()]), order)));
      onSaved();
      toast('Order saved: everyone’s model pickers follow it');
      return true;
    };
    return <ReorderPanel title="Order in Pickers" note="Everyone’s model pickers show models in this order, on the web and here. Move one with its arrows, or with … to the top or the bottom, then Save." items={items} onSave={save} onClose={onClose} />;
  }
  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
          Order in Pickers
        </Text>
        <View style={styles.side} />
      </View>
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

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  side: { minWidth: 48 },
  loading: { padding: 32, alignItems: 'center' },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
