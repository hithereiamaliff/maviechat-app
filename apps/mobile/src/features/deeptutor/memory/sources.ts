import { describeMemoryRef, memoryDocLabel, type DtMemoryItem } from '@maviechat/deeptutor-protocol';
import type { Href } from 'expo-router';
import type { IconName } from '@/components/Icon';

/** Where tapping a source leads: one of the app's screens, DeepTutor's page, or a fact to look up. */
export type SourceTarget = { route: Href } | { web: string; title: string } | { fact: string } | null;

export interface SourceRow {
  icon: IconName;
  title: string;
  detail: string;
  target: SourceTarget;
}

const ICONS: Record<string, IconName> = {
  chat: 'chat-bubble-left',
  notebook: 'bookmark',
  quiz: 'question-mark-circle',
  kb: 'circle-stack',
  book: 'book-open',
  partner: 'user-group',
  cowriter: 'pencil-square',
};

/**
 * One source of a fact, named as well as the app can without heavy requests: chats by the titles
 * the chat list already has, other items by their area's list (asked when the sources are shown).
 */
export function sourceRow(ref: string, lookup: { chatTitle: (id: string) => string | undefined; item: (surface: string, id: string) => DtMemoryItem | undefined }): SourceRow {
  const source = describeMemoryRef(ref);
  switch (source.kind) {
    case 'sheet':
      return { icon: ICONS[source.surface] ?? 'document-text', title: `${memoryDocLabel('L2', source.surface)} fact sheet`, detail: 'Everything it learned there', target: { route: { pathname: '/learn/memory/sheet', params: { layer: 'L2', key: source.surface } } } };
    case 'fact':
      return { icon: 'light-bulb', title: 'A fact on a fact sheet', detail: 'Opens the sheet at that fact', target: { fact: source.id } };
    case 'turn':
      return { icon: ICONS[source.surface] ?? 'chat-bubble-left', title: 'Something you said in a chat', detail: 'Saved while you chatted', target: null };
    case 'unknown':
      return { icon: 'document-text', title: source.ref, detail: '', target: null };
    case 'item':
      break;
  }
  const { surface, id } = source;
  const icon = ICONS[surface] ?? 'document-text';
  if (id.startsWith('ws:')) return { icon, title: `${memoryDocLabel('L2', surface)}: in another workspace`, detail: '', target: null };
  const item = lookup.item(surface, id);
  switch (surface) {
    case 'chat':
      return { icon, title: lookup.chatTitle(id) ?? 'A chat', detail: 'Chat', target: { route: { pathname: '/learn/[id]', params: { id } } } };
    case 'quiz': {
      const session = id.split(':')[0] ?? '';
      return { icon, title: item?.label ?? 'A quiz question', detail: lookup.chatTitle(session) ? `In “${lookup.chatTitle(session)}”` : 'Quiz', target: session ? { route: { pathname: '/learn/[id]', params: { id: session } } } : null };
    }
    case 'notebook': {
      const notebook = typeof item?.meta.notebook_id === 'string' ? item.meta.notebook_id : '';
      return { icon, title: item?.label ?? 'A saved answer', detail: 'Favorites', target: notebook ? { route: { pathname: '/learn/notebook/[id]', params: { id: notebook } } } : null };
    }
    case 'kb':
      return { icon, title: id, detail: 'Knowledge base', target: { route: { pathname: '/learn/knowledge/[name]', params: { name: id } } } };
    case 'book':
      return { icon, title: item?.label ?? 'A book', detail: 'Book', target: { route: { pathname: '/learn/books/[id]', params: { id } } } };
    case 'partner': {
      const colon = id.indexOf(':');
      const partner = colon > 0 ? id.slice(0, colon) : id;
      const session = colon > 0 ? id.slice(colon + 1) : '';
      return { icon, title: item?.label ?? 'A partner conversation', detail: 'Partner', target: { route: { pathname: '/learn/partners/[id]', params: session ? { id: partner, session } : { id: partner } } } };
    }
    case 'cowriter':
      return { icon, title: item?.label ?? 'A Co-Writer page', detail: 'Co-Writer', target: { web: `/co-writer/${encodeURIComponent(id)}`, title: 'Co-Writer' } };
    default:
      return { icon, title: item?.label ?? id, detail: surface, target: null };
  }
}
