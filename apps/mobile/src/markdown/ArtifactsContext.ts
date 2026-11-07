import { createContext } from 'react';

/**
 * Given by an Open WebUI chat: a code block's Preview opens the chat's artifacts at the version
 * made from that code, answering false when none was (the block then shows its own preview).
 */
export const ArtifactsContext = createContext<((code: string) => boolean) | null>(null);
