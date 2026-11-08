import { needsConnect, oauthToolOf, usableTools, type FeatureToggles, type FileItem, type OAuthTool, type QueuedMessage, type ToolItem } from '@maviechat/owui-protocol';
import { useSyncExternalStore } from 'react';

/**
 * What's in a chat's input bar: text, attachments, switched-on toggles and tools, and
 * messages queued behind a running reply. Kept per chat while the app runs, as the web
 * keeps each chat's input for the session.
 */
export interface Draft {
  text: string;
  files: FileItem[];
  /** On-device previews of photos, by `itemId`; never sent. */
  previews: Record<string, string>;
  toggles: FeatureToggles;
  toolIds: string[];
  /**
   * The model's own tools that wait for you to connect them (sign in to their service): a
   * message waits for them, and each goes on once it's connected, as on the web.
   */
  pendingToolIds: string[];
  /** Skills switched on (`skill_ids`), from the model's own at first. */
  skillIds: string[];
  /** The model's switchable filters turned on (`filter_ids`), from its defaults at first. */
  filterIds: string[];
  /** The model whose defaults the toggles and tools came from; picking another model applies its own. */
  defaultsFor: string | null;
  queue: QueuedMessage[];
  /** Picked with `@`: every message goes to this one model until you take it off, as on the web. */
  atModel?: string | null;
}

/** The new-chat screen's draft. */
export const NEW_CHAT = 'new';

const EMPTY: Draft = { text: '', files: [], previews: {}, toggles: {}, toolIds: [], pendingToolIds: [], skillIds: [], filterIds: [], defaultsFor: null, queue: [] };
const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();

export function getDraft(key: string): Draft {
  return drafts.get(key) ?? EMPTY;
}

export function updateDraft(key: string, change: (draft: Draft) => Draft): void {
  drafts.set(key, change(getDraft(key)));
  for (const listener of listeners) listener();
}

export function patchFile(key: string, itemId: string, item: FileItem): void {
  updateDraft(key, (draft) => ({ ...draft, files: draft.files.map((file) => (file.itemId === itemId ? item : file)) }));
}

export function removeFile(key: string, itemId: string): void {
  updateDraft(key, (draft) => {
    const { [itemId]: _removed, ...previews } = draft.previews;
    return { ...draft, files: draft.files.filter((file) => file.itemId !== itemId), previews };
  });
}

/** The first message created the chat: it keeps the toggles, tools and `@` model, and the new-chat input starts over. */
export function carryOver(from: string, to: string): void {
  const { toggles, toolIds, pendingToolIds, skillIds, filterIds, defaultsFor, atModel } = getDraft(from);
  drafts.delete(from);
  updateDraft(to, (draft) => ({ ...draft, toggles, toolIds, pendingToolIds, skillIds, filterIds, defaultsFor, atModel }));
}

/**
 * The tools a message from this draft takes (the switched-on ones you can use, and the model's
 * own once connected), and the model's own that still wait for you to connect them.
 */
export function draftTools(draft: Pick<Draft, 'toolIds' | 'pendingToolIds'>, tools: ToolItem[]): { toolIds: string[]; waiting: OAuthTool[] } {
  const usable = new Set(usableTools(tools).map((tool) => tool.id));
  const toolIds = [...new Set([...draft.toolIds, ...draft.pendingToolIds])].filter((id) => usable.has(id));
  const waiting = draft.pendingToolIds.flatMap((id) => {
    const tool = tools.find((item) => item.id === id);
    const oauth = tool && needsConnect(tool) ? oauthToolOf(tool) : null;
    return oauth ? [oauth] : [];
  });
  return { toolIds, waiting };
}

/** What a message waits for while tools need connecting, as a toast. */
export const connectFirst = (waiting: OAuthTool[]): string =>
  `Connect ${waiting.map((tool) => tool.name).join(', ')} first: tap ${waiting.length > 1 ? 'each' : 'it'} beside the + button.`;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDraft(key: string): Draft {
  return useSyncExternalStore(subscribe, () => getDraft(key));
}

/** Only the text, for screens that react to typing (the new-chat suggestions). */
export function useDraftText(key: string): string {
  return useSyncExternalStore(subscribe, () => getDraft(key).text);
}

/** Only the queue, so a chat screen doesn't re-render on every keystroke. */
export function useQueue(key: string): QueuedMessage[] {
  return useSyncExternalStore(subscribe, () => getDraft(key).queue);
}
