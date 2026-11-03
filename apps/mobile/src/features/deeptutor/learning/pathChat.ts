import { masteryTurnFields, type DtMasteryMode } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback } from 'react';
import { useToast } from '@/components/Toast';
import { useDtLive } from '@/features/deeptutor/chat/DtLiveProvider';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';

/**
 * Opens a chat on a mastery path. With an opening message (designing the outline, a review) the
 * chat starts at once with it, as DeepTutor does; without one you get a new chat to start
 * yourself. `replace` swaps the current screen (a new path's page) for the chat.
 */
export function useStartPathChat() {
  const live = useDtLive();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { session } = useDtAuthed();
  return useCallback(
    async (pathId: string, mode: DtMasteryMode, opening?: string | null, replace = false) => {
      if (!opening) {
        const target = { pathname: '/learn/mastery/chat' as const, params: { path: pathId, mode } };
        if (replace) router.replace(target);
        else router.push(target);
        return true;
      }
      try {
        const sessionId = await live.send({ content: opening, ...masteryTurnFields(pathId, mode) });
        live.turns.setPrompt(sessionId, opening);
        void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'mastery'] });
        const target = { pathname: '/learn/[id]' as const, params: { id: sessionId } };
        if (replace) router.replace(target);
        else router.push(target);
        return true;
      } catch (error) {
        toast(`Couldn't start the chat: ${describeError(error)}`, 'error');
        return false;
      }
    },
    [live, toast, queryClient, session.baseUrl],
  );
}

/** Our starters for a new path chat, by mode: tapping one sends it. */
export const PATH_STARTERS: Record<DtMasteryMode, string[]> = {
  outline: ['Draft an outline from my materials.', 'Ask me a few questions first, then propose an outline.', "Let's talk about how far I need to get."],
  study: ['Give me a quick check of what I already know.', 'Teach me from intuition, with one example.', 'Give me a hard question.'],
  review: ["Review what's due.", 'Go back over what I found hardest.', "Test me on everything I've mastered."],
};

export const MODE_LABELS: Record<DtMasteryMode, string> = { outline: 'Outline', study: 'Study', review: 'Review' };

/** What each mode is for, in a line. */
export const MODE_NOTES: Record<DtMasteryMode, string> = {
  outline: 'No teaching yet: you and the tutor agree what you will learn.',
  study: 'Work through the outline, one point at a time.',
  review: "Goes back over what you've learned. Nothing new is taught.",
};
