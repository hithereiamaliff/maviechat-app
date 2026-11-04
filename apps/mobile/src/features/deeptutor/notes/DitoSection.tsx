import { acceptableHere, deleteNoteThread, DtHttpError, firstBlockId, reviewNoteSuggestion, type DtNotePage, type DtNoteSuggestion, type DtNoteThread } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { MenuButton } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { shortWhen } from '@/features/deeptutor/partners/labels';
import { describeError } from '@/lib/errors';
import { Markdown } from '@/markdown/Markdown';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { editOnWeb } from './actions';
import { useNoteSuggestions, useNoteThreads, useNotesRefresh } from './queries';

const OPERATIONS: Record<DtNoteSuggestion['operation'], string> = { insert: 'Add after a line', replace: 'Change a line', delete: 'Remove a line', comment: 'A comment' };

/**
 * Dito on a page: its suggested edits waiting for you (accept, dismiss, or review on the web
 * when one needs turning into blocks first), its conversations about the page (open, delete),
 * and asking it something new.
 */
export function DitoSection({ page }: { page: DtNotePage }) {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const threads = useNoteThreads(page.id);
  const suggestions = useNoteSuggestions(page.id);
  const refresh = useNotesRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const pending = (suggestions.data ?? []).filter((suggestion) => suggestion.status === 'pending');
  const canAsk = Boolean(page.blocks?.length && firstBlockId(page));

  const review = async (suggestion: DtNoteSuggestion, accept: boolean) => {
    setBusy(suggestion.id);
    try {
      const next = await reviewNoteSuggestion(client, page.id, suggestion, accept);
      queryClient.setQueryData([DT_QUERY_ROOT, session.baseUrl, 'notes', 'page', page.id], next);
      refresh();
      toast(accept ? 'Accepted: the page changed' : 'Dismissed');
    } catch (error) {
      toast(error instanceof DtHttpError && error.status === 409 ? 'That line changed since Dito suggested this: ask it to suggest again.' : `Couldn’t do that: ${describeError(error)}`, 'error');
    } finally {
      setBusy(null);
    }
  };
  const remove = (thread: DtNoteThread) =>
    Alert.alert('Delete this conversation?', 'Its chat goes to DeepTutor’s recycle bin.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteNoteThread(client, page.id, thread.sessionId).then(refresh, (error: unknown) => toast(`Couldn’t delete it: ${describeError(error)}`, 'error')) },
    ]);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.section, { color: palette.textMuted }]}>Dito</Text>
      {canAsk ? (
        <Button label="Ask Dito About This Page" variant="secondary" onPress={() => router.push({ pathname: '/learn/notes/ask', params: { id: page.id } })} />
      ) : (
        <Text style={[styles.note, { color: palette.textFaint }]}>{page.blocks === null ? 'Dito works on pages of blocks: open this one on the web once to turn it into blocks.' : 'Write something on the page first, then ask Dito about it.'}</Text>
      )}
      {pending.map((suggestion) => (
        <View key={suggestion.id} style={[styles.card, { borderColor: palette.border, backgroundColor: palette.surface }]}>
          <Text style={[styles.label, { color: palette.textMuted }]}>{`Suggested: ${OPERATIONS[suggestion.operation]}`}</Text>
          {suggestion.markdown.trim() && suggestion.operation !== 'delete' ? <Markdown text={suggestion.markdown} /> : null}
          {suggestion.explanation ? <Text style={[styles.note, { color: palette.textMuted }]}>{`Why: ${suggestion.explanation}`}</Text> : null}
          <View style={styles.buttons}>
            {acceptableHere(suggestion) ? (
              <View style={styles.flex}>
                <Button label={suggestion.operation === 'comment' ? 'Done' : 'Accept'} loading={busy === suggestion.id} disabled={busy !== null} onPress={() => void review(suggestion, true)} />
              </View>
            ) : (
              <View style={styles.flex}>
                <Button label="Review on the Web" variant="secondary" onPress={() => editOnWeb(page)} />
              </View>
            )}
            <View style={styles.flex}>
              <Button label="Dismiss" variant="secondary" disabled={busy !== null} onPress={() => void review(suggestion, false)} />
            </View>
          </View>
        </View>
      ))}
      {threads.data?.length ? <Text style={[styles.sub, { color: palette.textMuted }]}>Conversations</Text> : null}
      {threads.data?.map((thread) => (
        <Pressable
          key={thread.sessionId}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/learn/[id]', params: { id: thread.sessionId } })}
          style={({ pressed }) => [styles.row, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : 'transparent' }]}>
          <Icon name={thread.status === 'running' ? 'signal' : 'chat-bubble-left-right'} size={16} color={palette.textMuted} />
          <View style={styles.text}>
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
              {thread.title || thread.quote || 'Conversation'}
            </Text>
            {thread.lastMessage ? (
              <Text style={[styles.note, { color: palette.textMuted }]} numberOfLines={2}>
                {thread.lastMessage}
              </Text>
            ) : null}
            <Text style={[styles.meta, { color: palette.textFaint }]}>{[thread.status === 'running' ? 'Answering…' : '', shortWhen(thread.updatedAt), thread.messages ? `${thread.messages} messages` : ''].filter(Boolean).join(' · ')}</Text>
          </View>
          <MenuButton label="Options for this conversation" size={18} color={palette.textMuted} items={[{ key: 'delete', label: 'Delete', icon: 'trash', destructive: true, onPress: () => remove(thread) }]} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 12, marginLeft: 4 },
  sub: { fontFamily: fonts.medium, fontSize: 12, marginTop: 4, marginLeft: 4 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  card: { gap: 8, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  label: { fontFamily: fonts.medium, fontSize: 12 },
  buttons: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.medium, fontSize: 15 },
  meta: { fontFamily: fonts.regular, fontSize: 11 },
});
