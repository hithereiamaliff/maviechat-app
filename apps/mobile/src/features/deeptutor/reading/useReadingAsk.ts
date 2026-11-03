import { readingTurnFields } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { useToast } from '@/components/Toast';
import { useDtLive } from '@/features/deeptutor/chat/DtLiveProvider';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { readingPlaces } from './readingContext';

/**
 * Asks the tutor about what you're reading, as DeepTutor's reader does: in the chat you used last
 * in this collection (else a new one), with the material, the page and the passage. Opens the chat.
 */
export function useReadingAsk() {
  const live = useDtLive();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { session } = useDtAuthed();
  return useCallback(
    async (collectionId: string, content: string, selection?: string) => {
      const place = readingPlaces.get(collectionId);
      const chatId = place?.chatId;
      const fields = readingTurnFields({
        collectionId,
        materialId: place?.materialId || null,
        revision: place?.revision,
        viewport: { locator: place?.locator, selection, timeSeconds: place?.timeSeconds },
      });
      try {
        if (chatId) live.turns.begin(chatId, content);
        const sessionId = await live.send({ content, ...(chatId ? { sessionId: chatId } : {}), ...fields });
        if (!chatId) live.turns.setPrompt(sessionId, content);
        readingPlaces.update(collectionId, { chatId: sessionId });
        void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading', 'chats', collectionId] });
        router.push({ pathname: '/learn/[id]', params: { id: sessionId } });
        return true;
      } catch (error) {
        if (chatId) live.turns.remove(chatId);
        toast(`Couldn't ask the tutor: ${describeError(error)}`, 'error');
        return false;
      }
    },
    [live, toast, queryClient, session.baseUrl],
  );
}

/** Opens a chat about the collection with a passage to ask about: the one you used last, else a new one. */
export function openReadingChat(collectionId: string, selection?: string): void {
  if (selection) readingPlaces.update(collectionId, { selection });
  const chatId = readingPlaces.get(collectionId)?.chatId;
  if (chatId) router.push({ pathname: '/learn/[id]', params: { id: chatId } });
  else router.push({ pathname: '/learn/reading/chat', params: { collection: collectionId } });
}

/** The languages offered for "Translate", in our words. */
export const TRANSLATE_LANGUAGES = ['English', 'Malay', 'Chinese', 'Tamil', 'Japanese', 'Korean', 'Spanish', 'French', 'German', 'Arabic'];
