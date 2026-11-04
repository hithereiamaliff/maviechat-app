import { getModelsConfig, idsOf, listAdminModels, saveModelsConfig, setAdminModelActive, setAdminModelHidden, withListedModel, type AdminModel } from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { MenuButton, type MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { ModelAvatar } from '@/features/chat/ModelAvatar';
import { Note } from '@/features/settings/rows';
import { AccessSheet, type AccessTarget } from '@/features/workspace/AccessSheet';
import { Chip } from '@/features/workspace/ListControls';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

type View_ = 'all' | 'on' | 'off' | 'hidden';
const VIEWS: { key: View_; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'on', label: 'On' },
  { key: 'off', label: 'Off' },
  { key: 'hidden', label: 'Hidden' },
];

/**
 * Every model on the server, for admins: on or off for everyone, hidden from pickers, what new
 * chats start with, what's pinned for everyone, and who may use a model with a saved row. Each
 * change reads the server first and changes only itself.
 */
export function ModelsPage() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const models = useQuery({ queryKey: ['admin', 'models'], queryFn: () => listAdminModels(client), staleTime: 15_000 });
  const config = useQuery({ queryKey: ['admin', 'models-config'], queryFn: () => getModelsConfig(client), staleTime: 0 });
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View_>('all');
  const [sharing, setSharing] = useState<AccessTarget | null>(null);
  const defaults = idsOf(config.data?.DEFAULT_MODELS);
  const pinned = idsOf(config.data?.DEFAULT_PINNED_MODELS);
  const wanted = query.trim().toLowerCase();
  const shown = (models.data ?? [])
    .filter((model) => (view === 'on' ? model.isActive : view === 'off' ? !model.isActive : view === 'hidden' ? model.hidden : true))
    .filter((model) => !wanted || `${model.name} ${model.id}`.toLowerCase().includes(wanted));
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
    void queryClient.invalidateQueries({ queryKey: ['models'] });
    void queryClient.invalidateQueries({ queryKey: ['config'] });
  };
  const run = (done: string, work: () => Promise<unknown>) =>
    void work().then(
      () => {
        refresh();
        toast(done);
      },
      (error: unknown) => toast(`Couldn’t save: ${describeError(error)}`, 'error'),
    );
  const listed = (model: AdminModel, key: 'DEFAULT_MODELS' | 'DEFAULT_PINNED_MODELS', on: boolean, done: string) => run(done, async () => saveModelsConfig(client, withListedModel(await getModelsConfig(client), key, model.id, on)));
  const menuFor = (model: AdminModel): MenuItem[] => [
    { key: 'hide', label: model.hidden ? 'Show in Pickers' : 'Hide from Pickers', icon: model.hidden ? 'eye' : 'eye-slash', onPress: () => run(model.hidden ? `${model.name} shown` : `${model.name} hidden from everyone’s picker`, () => setAdminModelHidden(client, model, !model.hidden)) },
    defaults.includes(model.id)
      ? { key: 'default', label: 'Stop Starting Chats With It', icon: 'chat-bubble-left', onPress: () => listed(model, 'DEFAULT_MODELS', false, `New chats no longer start with ${model.name}`) }
      : { key: 'default', label: 'Start New Chats With It', icon: 'chat-bubble-left', onPress: () => listed(model, 'DEFAULT_MODELS', true, `New chats start with ${model.name}`) },
    pinned.includes(model.id)
      ? { key: 'pin', label: 'Unpin for Everyone', icon: 'bookmark-slash', onPress: () => listed(model, 'DEFAULT_PINNED_MODELS', false, `${model.name} unpinned`) }
      : { key: 'pin', label: 'Pin for Everyone', icon: 'bookmark', onPress: () => listed(model, 'DEFAULT_PINNED_MODELS', true, `${model.name} pinned for everyone`) },
    ...(model.hasRow ? [{ key: 'share', label: 'Who May Use It…', icon: 'users' as const, onPress: () => setSharing({ area: 'models', id: model.id, name: model.name, grants: model.accessGrants }) }] : []),
  ];

  return (
    <View style={styles.page}>
      <Note>Every model on this server. Opening this asks each connection for its list, as the web does.</Note>
      {config.data ? (
        <Note>{`New chats start with: ${defaults.length ? defaults.join(', ') : 'each person’s own choice'}. Pinned for everyone: ${pinned.length ? pinned.join(', ') : 'none'}.`}</Note>
      ) : null}
      <TextInput value={query} onChangeText={setQuery} placeholder="Search models" placeholderTextColor={palette.textFaint} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search models" style={[styles.search, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
      <View style={styles.chips}>
        {VIEWS.map((item) => (
          <Chip key={item.key} label={item.label} on={view === item.key} onPress={() => setView(item.key)} />
        ))}
      </View>
      {models.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {models.isError ? <Note>{`Couldn’t load the models: ${describeError(models.error)}`}</Note> : null}
      {models.data && !shown.length ? <Note>Nothing matches.</Note> : null}
      {shown.map((model) => (
        <View key={model.id} style={[styles.item, { borderColor: palette.border, opacity: model.isActive ? 1 : 0.6 }]}>
          <ModelAvatar modelId={model.id} size={34} rounded={9} />
          <View style={styles.text}>
            <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
              {model.name}
            </Text>
            <Text style={[styles.meta, { color: palette.textFaint }]} numberOfLines={1}>
              {[model.id, model.preset ? 'workspace' : model.ownedBy, model.hidden ? 'hidden' : '', defaults.includes(model.id) ? 'new chats' : '', pinned.includes(model.id) ? 'pinned' : '', model.hasRow && !model.preset ? (model.accessGrants.some((grant) => grant.principal_id === '*') ? 'everyone' : model.accessGrants.length ? 'shared' : 'not shared') : ''].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Switch accessibilityLabel={`${model.name} on`} value={model.isActive} onValueChange={(on) => run(on ? `${model.name} is on` : `${model.name} is off for everyone`, () => setAdminModelActive(client, model, on))} />
          <MenuButton label={`Options for ${model.name}`} size={18} color={palette.textMuted} items={menuFor(model)} />
        </View>
      ))}
      <AccessSheet target={sharing} onClose={() => setSharing(null)} onSaved={refresh} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 10 },
  search: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.regular, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  meta: { fontFamily: fonts.regular, fontSize: 11 },
});
