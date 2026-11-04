import { createPersona, deletePersona, splitFrontMatter, updatePersona, type DtPersona } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { ResourceEditor, type ResourceDraft } from '@/features/deeptutor/personalization/ResourceEditor';
import { ResourceRow } from '@/features/deeptutor/personalization/ResourceRow';
import { ResourceViewer } from '@/features/deeptutor/personalization/ResourceViewer';
import { usePersonaFile, usePersonalizationRefresh, usePersonas } from '@/features/deeptutor/personalization/queries';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/**
 * Personas, as DeepTutor's page has them: voices a chat can answer in. Yours you can change; your
 * admin's are presets, read-only (one of yours with the same name takes a preset's place).
 */
export default function Personas() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const personas = usePersonas();
  const refresh = usePersonalizationRefresh();
  const [viewing, setViewing] = useState<DtPersona | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [editAfterView, setEditAfterView] = useState(false);
  // The persona being edited: '' for a new one, null when the editor is closed.
  const [editing, setEditing] = useState<string | null>(null);
  const viewFile = usePersonaFile(viewing?.name ?? null);
  const editFile = usePersonaFile(editing || null);
  const list = personas.data ?? [];
  const own = list.filter((persona) => !persona.preset);
  const presets = list.filter((persona) => persona.preset);

  const view = (persona: DtPersona) => {
    setViewing(persona);
    setViewerOpen(true);
  };
  const remove = (persona: DtPersona) =>
    Alert.alert(`Delete ${persona.name}?`, 'Chats that answer in it go back to the default voice.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deletePersona(client, persona.name).then(
            () => {
              refresh();
              toast('Persona deleted');
            },
            (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error'),
          ),
      },
    ]);
  const save = async (draft: ResourceDraft): Promise<string | null> => {
    try {
      if (!editing) await createPersona(client, { name: draft.name, description: draft.description, content: draft.body });
      else {
        const before = editFile.data ? splitFrontMatter(editFile.data.content).body : null;
        await updatePersona(client, editing, { description: draft.description, content: draft.body === before ? undefined : draft.body, renameTo: draft.name });
      }
      refresh();
      setEditing(null);
      toast('Persona saved');
      return null;
    } catch (error) {
      return describeError(error);
    }
  };
  const initial: ResourceDraft | null = editing && editFile.data ? { name: editFile.data.name, description: editFile.data.description, tags: [], header: '', body: splitFrontMatter(editFile.data.content).body } : null;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Personas" />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        <Text style={[styles.intro, { color: palette.textMuted }]}>Voices a chat can answer in: how it sounds, how long it goes on, what it never does. They’re yours in every workspace.</Text>
        <Button label="New Persona" onPress={() => setEditing('')} />
        {personas.isLoading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
        {personas.isError ? <Text style={[styles.empty, { color: palette.textMuted }]}>{`Couldn’t load your personas: ${describeError(personas.error)}`}</Text> : null}
        {personas.data && !list.length ? (
          <View style={[styles.emptyCard, { borderColor: palette.border }]}>
            <Icon name="identification" size={28} color={palette.textFaint} />
            <Text style={[styles.emptyTitle, { color: palette.text }]}>No personas yet</Text>
            <Text style={[styles.emptyText, { color: palette.textMuted }]}>Write one: a voice for a chat to answer in.</Text>
          </View>
        ) : null}
        {own.length ? <Text style={[styles.section, { color: palette.textMuted }]}>Yours</Text> : null}
        {own.map((persona) => (
          <ResourceRow
            key={persona.name}
            name={persona.name}
            description={persona.description}
            onPress={() => view(persona)}
            menu={[
              { key: 'edit', label: 'Edit', icon: 'pencil-square', onPress: () => setEditing(persona.name) },
              { key: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: () => remove(persona) },
            ]}
          />
        ))}
        {presets.length ? <Text style={[styles.section, { color: palette.textMuted }]}>Presets</Text> : null}
        {presets.map((persona) => (
          <ResourceRow key={persona.name} name={persona.name} description={persona.description} badge="Preset" onPress={() => view(persona)} />
        ))}
      </ScrollView>
      <ResourceViewer
        visible={viewerOpen}
        name={viewing?.name ?? ''}
        badge={viewing?.preset ? 'A preset from your admin: read-only' : undefined}
        description={viewing?.description ?? ''}
        file={viewFile.data?.content}
        error={viewFile.error}
        onEdit={
          viewing && !viewing.readOnly
            ? () => {
                setEditAfterView(true);
                setViewerOpen(false);
              }
            : undefined
        }
        onClose={() => setViewerOpen(false)}
        onDismiss={() => {
          if (editAfterView && viewing) setEditing(viewing.name);
          setEditAfterView(false);
        }}
      />
      <ResourceEditor kind="persona" open={editing !== null} initial={initial} loading={Boolean(editing) && !editFile.data} error={editing ? editFile.error : undefined} onSave={save} onClose={() => setEditing(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  intro: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  loading: { marginTop: 24 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 24 },
  emptyCard: { alignItems: 'center', gap: 6, padding: 24, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, borderStyle: 'dashed' },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  emptyText: { fontFamily: fonts.regular, fontSize: 13, textAlign: 'center' },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 10, marginLeft: 4 },
});
