import { router } from 'expo-router';

/** Starts a new chat that searches this knowledge base: DeepTutor's home, with it picked. */
export function chatWithKnowledgeBase(name: string): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace({ pathname: '/learn', params: { kb: name } });
}
