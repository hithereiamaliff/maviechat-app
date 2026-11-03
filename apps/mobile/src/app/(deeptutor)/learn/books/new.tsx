import {
  bookMaterial,
  createBook,
  DT_BOOK_DEPTHS,
  DT_BOOK_LANGUAGES,
  DT_BOOK_SOURCES_MAX,
  getBookSpine,
  getNotebook,
  listedUnder,
  notebookMaterial,
  sessionTitle,
  type DtBookDepth,
  type DtMasterySourceInput,
} from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { bookErrorText, DEPTH_LABELS } from '@/features/deeptutor/books/labels';
import { useBookRefresh, useBookSocket } from '@/features/deeptutor/books/useBooks';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useDtBooks, useDtKnowledgeMaterials, useDtNotebooks, useDtSessions } from '@/features/deeptutor/queries';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

type Tab = 'knowledge' | 'notebooks' | 'chats' | 'books';
const TABS: { key: Tab; label: string }[] = [
  { key: 'knowledge', label: 'Knowledge Bases' },
  { key: 'notebooks', label: 'Favorites' },
  { key: 'chats', label: 'Chats' },
  { key: 'books', label: 'Books' },
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
 * A new book, as DeepTutor's creator makes one: what you want to learn, the language and depth,
 * then (if you like) sources to write it from. DeepTutor answers with a proposal to review.
 */
export default function NewBook() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const socket = useBookSocket();
  const refresh = useBookRefresh();
  const [step, setStep] = useState<'intent' | 'sources'>('intent');
  const [intent, setIntent] = useState('');
  const [language, setLanguage] = useState('auto');
  const [depth, setDepth] = useState<DtBookDepth>('standard');
  const [tab, setTab] = useState<Tab>('knowledge');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Choice[]>([]);
  const [creating, setCreating] = useState(false);
  const sources = step === 'sources';
  const knowledge = useDtKnowledgeMaterials(sources);
  const notebooks = useDtNotebooks(sources);
  const chats = useDtSessions('');
  const books = useDtBooks();

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
        : tab === 'chats'
          ? (chats.data ?? [])
              .filter((item) => listedUnder(item) === 'conversations')
              .map((item) => ({ key: `c:${item.id}`, tab, id: item.id, label: sessionTitle(item), detail: typeof item.last_message === 'string' ? item.last_message : '', available: true }))
          : (books.data?.books ?? [])
              .filter((item) => item.status !== 'draft')
              .map((item) => ({ key: `b:${item.id}`, tab, id: item.id, label: item.title || 'Untitled book', detail: item.description, available: true }));
  const shown = choices.filter((choice) => `${choice.label} ${choice.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const loading = tab === 'knowledge' ? knowledge.isLoading : tab === 'notebooks' ? notebooks.isLoading : tab === 'chats' ? chats.isLoading : books.isLoading;
  const isPicked = (choice: Choice) => picked.some((item) => item.key === choice.key);
  const toggle = (choice: Choice) =>
    setPicked((list) => (isPicked(choice) ? list.filter((item) => item.key !== choice.key) : list.length >= DT_BOOK_SOURCES_MAX ? list : [...list, choice]));

  /** What DeepTutor reads of each pick, as its creator sends it; one that can't be read goes as unavailable. */
  const sourceOf = async (choice: Choice): Promise<DtMasterySourceInput> => {
    const unavailable = (kind: DtMasterySourceInput['kind']): DtMasterySourceInput => ({ kind, sourceId: choice.id, label: choice.label, available: false, metadata: { content_workspace_id: '' } });
    if (choice.tab === 'knowledge') return { kind: 'knowledge_base', sourceId: choice.id, label: choice.label, available: choice.available, metadata: { content_workspace_id: '' } };
    if (choice.tab === 'chats') return { kind: 'chat', sourceId: choice.id, label: choice.label, excerpt: choice.detail.slice(0, 4000), metadata: { content_workspace_id: '' } };
    if (choice.tab === 'notebooks') return getNotebook(client, choice.id).then(notebookMaterial, () => unavailable('notebook'));
    return getBookSpine(client, choice.id).then(
      (spine) => bookMaterial({ id: choice.id, title: choice.label }, spine),
      () => unavailable('book'),
    );
  };

  const create = async () => {
    if (!intent.trim() || creating) return;
    setCreating(true);
    try {
      const refs = await Promise.all(picked.map(sourceOf));
      const book = await createBook(socket, {
        intent,
        sources: refs,
        knowledgeBases: picked.filter((choice) => choice.tab === 'knowledge').map((choice) => choice.id),
        language,
        fallbackLanguage: 'en',
        depth,
      });
      refresh(book.id);
      router.replace({ pathname: '/learn/books/[id]', params: { id: book.id } });
    } catch (error) {
      setCreating(false);
      toast(`Couldn't write the proposal: ${bookErrorText(error)}`, 'error');
    }
  };

  const chip = (on: boolean, label: string, onPress: () => void, hint?: string) => (
    <Pressable
      key={label}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityHint={hint}
      onPress={onPress}
      disabled={creating}
      style={[styles.tab, { borderColor: palette.border }, on && { backgroundColor: palette.active, borderColor: palette.active }]}>
      <Text style={[styles.tabText, { color: on ? palette.onActive : palette.textMuted }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="New Book" />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        {creating ? (
          <View style={styles.writing}>
            <ActivityIndicator color={palette.textMuted} />
            <Text style={[styles.heading, { color: palette.text }]}>Writing the proposal</Text>
            <Text style={[styles.note, styles.center, { color: palette.textMuted }]}>
              DeepTutor reads what you picked and suggests a title, scope and chapters. It takes up to a minute.
            </Text>
          </View>
        ) : step === 'intent' ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={[styles.heading, { color: palette.text }]}>What do you want to learn?</Text>
            <Text style={[styles.note, { color: palette.textMuted }]}>The subject, how far you want to go, and anything the book should focus on.</Text>
            <TextInput
              value={intent}
              onChangeText={setIntent}
              placeholder="For example: how vaccines train the immune system, for someone without a biology background"
              placeholderTextColor={palette.textFaint}
              multiline
              autoFocus
              textAlignVertical="top"
              style={[styles.intent, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
              accessibilityLabel="What you want to learn"
            />
            <Text style={[styles.label, { color: palette.textMuted }]}>Depth</Text>
            <View style={styles.chips}>{DT_BOOK_DEPTHS.map((item) => chip(item === depth, DEPTH_LABELS[item].label, () => setDepth(item), DEPTH_LABELS[item].hint))}</View>
            <Text style={[styles.hint, { color: palette.textFaint }]}>{DEPTH_LABELS[depth].hint}</Text>
            <Text style={[styles.label, { color: palette.textMuted }]}>Language</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              {DT_BOOK_LANGUAGES.map((item) => chip(item.code === language, item.label, () => setLanguage(item.code)))}
            </ScrollView>
            {language === 'auto' ? <Text style={[styles.hint, { color: palette.textFaint }]}>Written in the language you asked in.</Text> : null}
          </ScrollView>
        ) : (
          <View style={styles.screen}>
            <View style={styles.pickerTop}>
              <Text style={[styles.note, { color: palette.textMuted }]}>
                {`Anything DeepTutor should write from (up to ${DT_BOOK_SOURCES_MAX}). Knowledge bases are also searched while each page is written. You can pick none.`}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
                {TABS.map((item) => {
                  const count = picked.filter((choice) => choice.tab === item.key).length;
                  return chip(item.key === tab, count ? `${item.label} · ${count}` : item.label, () => setTab(item.key));
                })}
              </ScrollView>
              <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search"
                  placeholderTextColor={palette.textFaint}
                  autoCorrect={false}
                  style={[styles.searchInput, { color: palette.text }]}
                  accessibilityLabel="Search sources"
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
        {creating ? null : (
          <View style={[styles.footer, { borderTopColor: palette.border }]}>
            {step === 'intent' ? (
              <Button label="Next" onPress={() => setStep('sources')} disabled={!intent.trim()} />
            ) : (
              <>
                <Button label={picked.length ? `Write the Proposal · ${picked.length} picked` : 'Write the Proposal'} onPress={() => void create()} />
                <Pressable accessibilityRole="button" onPress={() => setStep('intent')} style={styles.back} hitSlop={6}>
                  <Text style={[styles.backText, { color: palette.link }]}>Back</Text>
                </Pressable>
              </>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10 },
  heading: { fontFamily: fonts.semibold, fontSize: 20 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  center: { textAlign: 'center' },
  hint: { fontFamily: fonts.regular, fontSize: 12 },
  intent: { minHeight: 130, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: 12, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tab: { height: 32, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  tabText: { fontFamily: fonts.medium, fontSize: 13 },
  pickerTop: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 40, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  list: { paddingHorizontal: 16, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 15 },
  rowDetail: { fontFamily: fonts.regular, fontSize: 13 },
  writing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  footer: { padding: 16, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  back: { alignSelf: 'center', paddingVertical: 6 },
  backText: { fontFamily: fonts.medium, fontSize: 14 },
});
