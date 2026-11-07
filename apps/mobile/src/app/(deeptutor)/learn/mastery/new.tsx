import {
  createMasteryTopic,
  DT_GOAL_MAX,
  DT_PATH_EMBLEMS,
  getNotebook,
  listedUnder,
  notebookMaterial,
  openingMessage,
  sessionTitle,
  type DtMasterySourceInput,
} from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { SideScroll } from '@/components/SideScroll';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useStartPathChat } from '@/features/deeptutor/learning/pathChat';
import { useDtKnowledgeMaterials, useDtNotebooks, useDtSessions } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

type Tab = 'knowledge' | 'notebooks' | 'chats';
const TABS: { key: Tab; label: string }[] = [
  { key: 'knowledge', label: 'Knowledge Bases' },
  { key: 'notebooks', label: 'Favorites' },
  { key: 'chats', label: 'Chats' },
];

interface Choice {
  key: string;
  tab: Tab;
  id: string;
  label: string;
  detail: string;
  available: boolean;
}

/**
 * A new mastery path, as DeepTutor's wizard makes one: your goal and an emblem, then (if you
 * like) materials for the tutor to read. The outline is designed with the tutor in a chat that
 * starts straight away.
 */
export default function NewMasteryPath() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const startChat = useStartPathChat();
  const [step, setStep] = useState<'goal' | 'materials'>('goal');
  const [goal, setGoal] = useState('');
  const [emoji, setEmoji] = useState<string>(DT_PATH_EMBLEMS[0]);
  const [tab, setTab] = useState<Tab>('knowledge');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Choice[]>([]);
  const [creating, setCreating] = useState(false);
  const materials = step === 'materials';
  const knowledge = useDtKnowledgeMaterials(materials);
  const notebooks = useDtNotebooks(materials);
  const chats = useDtSessions('');

  const choices: Choice[] =
    tab === 'knowledge'
      ? (knowledge.data ?? []).map((item) => ({ key: `k:${item.id}`, tab, id: item.id, label: item.label, detail: '', available: item.available }))
      : tab === 'notebooks'
        ? (notebooks.data ?? []).map((item) => ({
            key: `n:${item.id}`,
            tab,
            id: item.id,
            label: item.name || 'Notebook',
            detail: typeof item.record_count === 'number' ? `${item.record_count} saved` : '',
            available: item.unreadable !== true,
          }))
        : (chats.data ?? [])
            .filter((item) => listedUnder(item) === 'conversations')
            .map((item) => ({ key: `c:${item.id}`, tab, id: item.id, label: sessionTitle(item), detail: typeof item.last_message === 'string' ? item.last_message : '', available: true }));
  const shown = choices.filter((choice) => `${choice.label} ${choice.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const loading = tab === 'knowledge' ? knowledge.isLoading : tab === 'notebooks' ? notebooks.isLoading : chats.isLoading;
  const isPicked = (choice: Choice) => picked.some((item) => item.key === choice.key);
  const toggle = (choice: Choice) => setPicked((list) => (isPicked(choice) ? list.filter((item) => item.key !== choice.key) : list.length >= 15 ? list : [...list, choice]));

  /** What the tutor gets of each pick, as DeepTutor's wizard sends it. */
  const sourceOf = async (choice: Choice): Promise<DtMasterySourceInput> => {
    if (choice.tab === 'knowledge') return { kind: 'knowledge_base', sourceId: choice.id, label: choice.label, available: choice.available, metadata: { content_workspace_id: '' } };
    if (choice.tab === 'chats') return { kind: 'chat', sourceId: choice.id, label: choice.label, excerpt: choice.detail.slice(0, 4000), metadata: { content_workspace_id: '' } };
    try {
      return notebookMaterial(await getNotebook(client, choice.id));
    } catch {
      return { kind: 'notebook', sourceId: choice.id, label: choice.label, available: false, metadata: { unavailable_during_generation: true, content_workspace_id: '' } };
    }
  };

  const create = async () => {
    if (!goal.trim() || creating) return;
    setCreating(true);
    try {
      const sources = await Promise.all(picked.map(sourceOf));
      const topic = await createMasteryTopic(client, { goal, emoji, sources });
      void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'mastery'] });
      void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'learning-index'] });
      // As on DeepTutor: straight into designing the outline with the tutor.
      const started = await startChat(topic.pathId, 'outline', openingMessage('outline'), true);
      if (!started) setCreating(false);
    } catch (error) {
      toast(`Couldn't make the path: ${describeError(error)}`, 'error');
      setCreating(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="New Mastery Path" />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        {step === 'goal' ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={[styles.heading, { color: palette.text }]}>What do you want to master?</Text>
            <Text style={[styles.note, { color: palette.textMuted }]}>Say it the way you would to a tutor: the subject, how far you want to get, and why if it helps.</Text>
            <TextInput
              value={goal}
              onChangeText={setGoal}
              placeholder="For example: read music well enough to play simple piano pieces"
              placeholderTextColor={palette.textFaint}
              multiline
              autoFocus
              maxLength={DT_GOAL_MAX}
              textAlignVertical="top"
              style={[styles.goal, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
              accessibilityLabel="Your goal"
            />
            <Text style={[styles.label, { color: palette.textMuted }]}>Emblem</Text>
            <View style={styles.emblems}>
              {DT_PATH_EMBLEMS.map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: item === emoji }}
                  accessibilityLabel={`Emblem ${item}`}
                  onPress={() => setEmoji(item)}
                  style={[styles.emblem, { borderColor: item === emoji ? palette.text : palette.border }]}>
                  <Text style={styles.emblemText}>{item}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : (
          <View style={styles.screen}>
            <View style={styles.pickerTop}>
              <Text style={[styles.note, { color: palette.textMuted }]}>Anything the tutor should read while it designs the outline. You can pick none.</Text>
              <SideScroll showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} keyboardShouldPersistTaps="handled">
                {TABS.map((item) => {
                  const on = item.key === tab;
                  const count = picked.filter((choice) => choice.tab === item.key).length;
                  return (
                    <Pressable
                      key={item.key}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                      onPress={() => setTab(item.key)}
                      style={[styles.tab, { borderColor: palette.border }, on && { backgroundColor: palette.active, borderColor: palette.active }]}>
                      <Text style={[styles.tabText, { color: on ? palette.onActive : palette.textMuted }]}>{count ? `${item.label} · ${count}` : item.label}</Text>
                    </Pressable>
                  );
                })}
              </SideScroll>
              <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search"
                  placeholderTextColor={palette.textFaint}
                  autoCorrect={false}
                  style={[styles.searchInput, { color: palette.text }]}
                  accessibilityLabel="Search materials"
                />
              </View>
            </View>
            <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
              {loading ? <ActivityIndicator color={palette.textMuted} /> : null}
              {!loading && shown.length === 0 ? <Text style={[styles.note, { color: palette.textMuted }]}>Nothing here.</Text> : null}
              {shown.map((choice) => {
                const on = isPicked(choice);
                return (
                  <Pressable
                    key={choice.key}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: !choice.available }}
                    disabled={!choice.available}
                    onPress={() => toggle(choice)}
                    style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }, !choice.available && { opacity: 0.5 }]}>
                    <View style={styles.rowText}>
                      <Text style={[styles.rowLabel, { color: palette.text }]} numberOfLines={1}>
                        {choice.label}
                      </Text>
                      {choice.detail ? (
                        <Text style={[styles.rowDetail, { color: palette.textMuted }]} numberOfLines={1}>
                          {choice.detail}
                        </Text>
                      ) : null}
                    </View>
                    {on ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
        <View style={[styles.footer, { borderTopColor: palette.border }]}>
          {step === 'goal' ? (
            <Button label="Next" onPress={() => setStep('materials')} disabled={!goal.trim()} />
          ) : (
            <>
              <Button label={picked.length ? `Design the Outline · ${picked.length} picked` : 'Design the Outline With the Tutor'} onPress={() => void create()} loading={creating} disabled={creating} />
              <Pressable accessibilityRole="button" onPress={() => setStep('goal')} disabled={creating} style={styles.back} hitSlop={6}>
                <Text style={[styles.backText, { color: palette.link }]}>Back to the goal</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10 },
  heading: { fontFamily: fonts.semibold, fontSize: 20 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  goal: { minHeight: 130, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: 12, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 8 },
  emblems: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  emblem: { width: 48, height: 48, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  emblemText: { fontSize: 24 },
  pickerTop: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  tabs: { gap: 6 },
  tab: { height: 32, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  tabText: { fontFamily: fonts.medium, fontSize: 13 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 40, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  list: { paddingHorizontal: 16, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 15 },
  rowDetail: { fontFamily: fonts.regular, fontSize: 13 },
  footer: { padding: 16, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  back: { alignSelf: 'center', paddingVertical: 6 },
  backText: { fontFamily: fonts.medium, fontSize: 14 },
});
