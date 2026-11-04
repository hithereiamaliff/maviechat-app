import type { IconName } from '@/components/Icon';

/** A DeepTutor page: native when it has a `route`, else DeepTutor's own page (`path`), signed in. */
export interface DtPage {
  key: string;
  label: string;
  icon: IconName;
  path: string;
  /** The app's own screen for it. */
  route?:
    | '/learn/practice'
    | '/learn/questions'
    | '/learn/favorites'
    | '/learn/journal'
    | '/learn/history'
    | '/learn/knowledge'
    | '/learn/calendar'
    | '/learn/tasks'
    | '/learn/learning'
    | '/learn/learning/new'
    | '/learn/partners'
    | '/learn/partners/new'
    | '/learn/partners/groups/new'
    | '/learn/personalization'
    | '/learn/personas'
    | '/learn/skills';
  /** Hidden from learner accounts, which DeepTutor limits to chat and some learning. */
  notForLearners?: boolean;
}

export type DtShelfKey = 'home' | 'learning' | 'resources' | 'partners' | 'personalization';

/** One of DeepTutor's sidebar shelves (1.7.1): a tab, then its pages in groups. */
export interface DtShelf {
  key: DtShelfKey;
  label: string;
  icon: IconName;
  groups: { heading?: string; pages: DtPage[] }[];
  notForLearners?: boolean;
}

/** DeepTutor's sidebar, shelf by shelf, in its own order. Home also lists your chats, and Learning the chats held in learning activities. */
export const DT_SHELVES: DtShelf[] = [
  {
    key: 'home',
    label: 'Home',
    icon: 'home',
    groups: [
      {
        heading: 'Workspace',
        pages: [
          { key: 'calendar', label: 'Calendar', icon: 'calendar', path: '/calendar', route: '/learn/calendar' },
          { key: 'kanban', label: 'Task Board', icon: 'view-columns', path: '/kanban', route: '/learn/tasks' },
          { key: 'co-writer', label: 'Co-Writer', icon: 'pencil', path: '/co-writer', notForLearners: true },
        ],
      },
    ],
  },
  {
    key: 'learning',
    label: 'Learning',
    icon: 'academic-cap',
    groups: [
      {
        pages: [
          { key: 'learning-new', label: 'New Learning Activity', icon: 'plus', path: '/learning/new', route: '/learn/learning/new' },
          { key: 'learning', label: 'All Learning', icon: 'squares-2x2', path: '/learning', route: '/learn/learning' },
          { key: 'practice', label: 'Practice', icon: 'arrow-path', path: '/learning/practice', route: '/learn/practice' },
        ],
      },
    ],
  },
  {
    key: 'resources',
    label: 'Resources',
    icon: 'folder',
    notForLearners: true,
    groups: [
      { pages: [{ key: 'space', label: 'All Resources', icon: 'squares-2x2', path: '/space' }] },
      {
        heading: 'Conversations & Materials',
        pages: [
          { key: 'chat-history', label: 'Chat History', icon: 'clock', path: '/space/chat-history', route: '/learn/history' },
          { key: 'notebooks', label: 'Favorites', icon: 'bookmark', path: '/notebooks', route: '/learn/favorites' },
          { key: 'journal', label: 'Learning Journal', icon: 'book-open', path: '/space/journal', route: '/learn/journal' },
          { key: 'questions', label: 'Question Bank', icon: 'question-mark-circle', path: '/space/questions', route: '/learn/questions' },
          { key: 'knowledge', label: 'Knowledge Center', icon: 'circle-stack', path: '/knowledge-bases', route: '/learn/knowledge' },
        ],
      },
    ],
  },
  {
    key: 'partners',
    label: 'Partners',
    icon: 'user-group',
    notForLearners: true,
    groups: [
      {
        pages: [
          { key: 'partners', label: 'All Partners', icon: 'user-group', path: '/partners', route: '/learn/partners' },
          { key: 'partner-new', label: 'New Partner', icon: 'plus', path: '/partners/new', route: '/learn/partners/new' },
          { key: 'group-new', label: 'New Group', icon: 'users', path: '/partners/groups/new', route: '/learn/partners/groups/new' },
        ],
      },
    ],
  },
  {
    key: 'personalization',
    label: 'Personalization',
    icon: 'user-circle',
    notForLearners: true,
    groups: [
      {
        pages: [
          { key: 'personalization', label: 'All Personalization', icon: 'squares-2x2', path: '/personalization', route: '/learn/personalization' },
          { key: 'agents', label: 'My Agents', icon: 'cpu-chip', path: '/agents' },
          { key: 'personas', label: 'Personas', icon: 'identification', path: '/space/personas', route: '/learn/personas' },
          { key: 'skills', label: 'Skills', icon: 'sparkles', path: '/space/skills', route: '/learn/skills' },
          { key: 'mcp', label: 'MCP Services', icon: 'puzzle-piece', path: '/space/mcp' },
          { key: 'cli-apps', label: 'CLI Apps', icon: 'command-line', path: '/space/cli-apps' },
          { key: 'memory', label: 'Memory', icon: 'light-bulb', path: '/memory' },
        ],
      },
    ],
  },
];

/** The shelves this account sees: learners get Home and Learning only (and no Co-Writer). */
export function shelvesFor(learner: boolean): DtShelf[] {
  if (!learner) return DT_SHELVES;
  return DT_SHELVES.filter((shelf) => !shelf.notForLearners).map((shelf) => ({
    ...shelf,
    groups: shelf.groups.map((group) => ({ ...group, pages: group.pages.filter((page) => !page.notForLearners) })),
  }));
}

/** DeepTutor's admin pages (account menu, admins only). */
export const DT_ADMIN_PAGE: DtPage = { key: 'admin', label: 'Admin', icon: 'shield-check', path: '/admin/users' };
/** DeepTutor's full settings, for what the app's Settings doesn't cover. */
export const DT_SETTINGS_PAGE: DtPage = { key: 'settings', label: 'DeepTutor Settings', icon: 'cog-6-tooth', path: '/settings' };
