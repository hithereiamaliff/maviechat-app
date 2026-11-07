import { deleteSession, organizeSession, renameSession } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { useToast } from '@/components/Toast';
import { showPrompt } from '@/components/dialogs';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { useDtLive } from './chat/DtLiveProvider';

/** Rename, pin, archive and delete for a DeepTutor chat, from the sidebar, the chat's own menu or Archived Chats. */
export function useDtChatActions() {
  const { client, session } = useDtAuthed();
  const queryClient = useQueryClient();
  const toast = useToast();
  const live = useDtLive();

  const refresh = (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'sessions'] });
    if (id) void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'session', id] });
  };

  const rename = (id: string, current: string) =>
    showPrompt(
      'Rename chat',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          onPress: (value?: string) => {
            const title = value?.trim();
            if (!title) return;
            void renameSession(client, id, title)
              .then(() => refresh(id))
              .catch((error: unknown) => toast(`Couldn't rename: ${describeError(error)}`, 'error'));
          },
        },
      ],
      'plain-text',
      current,
    );

  const organize = (id: string, change: { pinned?: boolean; archived?: boolean }, done: string, after?: () => void) =>
    void organizeSession(client, id, change)
      .then(() => {
        refresh(id);
        toast(done);
        after?.();
      })
      .catch((error: unknown) => toast(`Couldn't change the chat: ${describeError(error)}`, 'error'));

  const setPinned = (id: string, pinned: boolean) => organize(id, { pinned }, pinned ? 'Pinned' : 'Unpinned');
  /** Archived chats leave the sidebar for Settings → Archived Chats; `after` runs once it's done. */
  const setArchived = (id: string, archived: boolean, after?: () => void) => organize(id, { archived }, archived ? 'Archived' : 'Restored to your chats', after);

  /** `after` runs once it's gone (leave the chat if it's on screen). */
  const remove = (id: string, after?: () => void) =>
    Alert.alert('Delete this chat?', 'It moves to the recycle bin in DeepTutor.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteSession(client, id)
            .then(() => {
              refresh();
              live.turns.remove(id);
              after?.();
            })
            .catch((error: unknown) => toast(`Couldn't delete: ${describeError(error)}`, 'error')),
      },
    ]);

  return { rename, setPinned, setArchived, remove };
}
