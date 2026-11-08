import {
  defaultSuggestionsOf,
  getConfig,
  getModelsConfig,
  modelDefaultsChanges,
  modelDefaultsOf,
  sameSuggestions,
  saveDefaultSuggestions,
  saveModelsConfig,
  translatedLanguages,
  withModelDefaults,
  type DefaultSuggestions,
  type ModelDefaults,
  type SuggestedPrompt,
} from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { Note } from '@/features/settings/rows';
import { plural } from '@/features/workspace/EditorParts';
import { CapabilitiesSection, ParamsSection, SuggestionsSection } from '@/features/workspace/ModelSections';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, usePalette } from '@/theme';
import { reviewChanges, useSettingsRefresh } from './AdminConfigPage';

type Tree = Record<string, unknown>;

interface Loaded {
  defaults: ModelDefaults;
  suggestions: DefaultSuggestions;
}

const noTerminal = () => undefined;

/** Prompts in a few words, for the list a save shows first. */
const promptsInWords = (prompts: SuggestedPrompt[] | null): string => (prompts === null ? 'Open WebUI’s built-in ones' : plural(prompts.filter((prompt) => prompt.content.trim()).length, 'prompt'));

/**
 * Model Defaults (the web's panel above its admin model list): what every model starts with, its
 * capabilities, the features new chats start with, its built-in tools and its parameters, plus
 * the prompt suggestions new chats offer where a model has none of its own. A model's own
 * settings win. Saved over the server's settings as they are then, only what you changed.
 */
export function ModelDefaultsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Loader onClose={onClose} /> : null}
    </Modal>
  );
}

function Loader({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const { client } = useAuthed();
  // Read as the sheet opens, so the changes go over what's saved now.
  const loaded = useQuery({
    queryKey: ['admin', 'model-defaults'],
    queryFn: async (): Promise<Loaded> => {
      const [config, server] = await Promise.all([getModelsConfig(client), getConfig(client)]);
      return { defaults: modelDefaultsOf(config), suggestions: defaultSuggestionsOf(server as Tree) };
    },
    staleTime: 0,
    // Dropped on close, so opening again starts from a fresh read, never a cached one.
    gcTime: 0,
  });
  if (loaded.data) return <Form initial={loaded.data} onClose={onClose} />;
  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <Header onCancel={onClose} />
      {loaded.error ? (
        <Pressable accessibilityRole="button" onPress={() => void loaded.refetch()} style={styles.loading}>
          <Text style={[styles.hint, { color: palette.danger }]}>{`Couldn’t load them: ${describeError(loaded.error)}. Tap to try again.`}</Text>
        </Pressable>
      ) : (
        <ActivityIndicator style={styles.loading} color={palette.textMuted} />
      )}
    </View>
  );
}

function Header({ onCancel, save }: { onCancel: () => void; save?: { ready: boolean; busy: boolean; onPress: () => void } }) {
  const palette = usePalette();
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={10}>
        <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
      </Pressable>
      <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header" numberOfLines={1}>
        Model Defaults
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

function Form({ initial, onClose }: { initial: Loaded; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const refresh = useSettingsRefresh();
  // As the sheet opened: a reload behind it doesn't move the start.
  const [start] = useState(initial);
  const [defaults, setDefaults] = useState(initial.defaults);
  const [prompts, setPrompts] = useState(initial.suggestions.prompts);
  const [busy, setBusy] = useState(false);
  const changes = modelDefaultsChanges(start.defaults, defaults);
  const suggestionsChanged = !sameSuggestions(start.suggestions.prompts, prompts);
  const lines = [...changes.map((change) => `${change.label}: ${change.from} → ${change.to}`), ...(suggestionsChanged ? [`Prompt suggestions: ${promptsInWords(start.suggestions.prompts)} → ${promptsInWords(prompts)}`] : [])];
  const ready = !busy && lines.length > 0;
  // 0.12 can leave the suggestions to Open WebUI's built-in ones; 0.11 always keeps a list.
  const twelve = start.suggestions.translations !== null;
  const translated = translatedLanguages(start.suggestions);

  const run = async () => {
    setBusy(true);
    let savedDefaults = false;
    try {
      if (changes.length) {
        await saveModelsConfig(client, withModelDefaults(await getModelsConfig(client), start.defaults, defaults));
        savedDefaults = true;
      }
      if (suggestionsChanged) {
        // Translations as they are now, which a save without them would wipe.
        const now = defaultSuggestionsOf((await getConfig(client)) as Tree);
        await saveDefaultSuggestions(client, { prompts, translations: now.translations });
      }
      refresh();
      // Every model's capabilities and the new chat's suggestions follow these.
      void queryClient.invalidateQueries({ queryKey: ['models'] });
      toast('Model defaults saved');
      onClose();
    } catch (error) {
      toast(savedDefaults ? `The defaults were saved, but not the suggestions: ${describeError(error)}` : `Couldn’t save them: ${describeError(error)}`, 'error');
      if (savedDefaults) refresh();
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    if (!ready) return;
    reviewChanges('Save the model defaults?', [...lines, '', 'Every model starts with these, on the web and here; a model’s own settings win.'], [], () => void run());
  };

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <Header onCancel={onClose} save={{ ready, busy, onPress: save }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Note>What every model on this server starts with. A model’s own settings win: its capabilities one by one, the rest where it has its own.</Note>
        <CapabilitiesSection
          caps={defaults.capabilities}
          setCaps={(capabilities) => setDefaults((current) => ({ ...current, capabilities }))}
          features={defaults.featureIds}
          setFeatures={(featureIds) => setDefaults((current) => ({ ...current, featureIds }))}
          builtin={defaults.builtinTools}
          setBuiltin={(builtinTools) => setDefaults((current) => ({ ...current, builtinTools }))}
          terminals={[]}
          terminalId=""
          setTerminalId={noTerminal}
          readOnly={false}
          note="What every model can do, and what new chats start with, unless a model says otherwise."
        />
        <ParamsSection
          params={defaults.params}
          setParams={(params) => setDefaults((current) => ({ ...current, params }))}
          custom={defaults.custom}
          setCustom={(custom) => setDefaults((current) => ({ ...current, custom }))}
          readOnly={false}
          note="Every model starts with these; a model’s own, then a chat’s, win. Left at Default, none is set."
        />
        <SuggestionsSection
          prompts={prompts}
          setPrompts={setPrompts}
          readOnly={false}
          summary={prompts === null ? 'Open WebUI’s built-in ones.' : `${plural(prompts.length, 'prompt')} for new chats with a model that has none of its own.`}
          toggle={twelve ? { label: 'Your own list', note: 'Off: Open WebUI’s built-in ones, which the web shows in each person’s language.' } : null}
        />
        {translated.length ? <Note>{`Translations of the suggestions for ${plural(translated.length, 'language')} are kept as they are; change them on the web.`}</Note> : null}
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
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
