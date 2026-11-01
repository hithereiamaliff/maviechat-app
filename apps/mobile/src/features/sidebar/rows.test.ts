import type { ChatListItem, FolderNode } from '@maviechat/owui-protocol';
import { describe, expect, it } from 'vitest';
import { buildSidebarRows, isUnread } from './rows';

const now = new Date(2026, 10, 1, 15);
const sec = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime() / 1000;
const chat = (id: string, updated: number, extra: Partial<ChatListItem> = {}): ChatListItem => ({
  id,
  title: id,
  updated_at: updated,
  created_at: updated,
  ...extra,
});
const folder = (id: string, children: FolderNode[] = [], extra: Partial<FolderNode> = {}): FolderNode => ({
  id,
  name: id,
  created_at: 0,
  updated_at: 0,
  children,
  ...extra,
});

const base = {
  search: { active: false, results: undefined, loading: false },
  pinned: [] as ChatListItem[],
  folders: [] as FolderNode[],
  isExpanded: () => false,
  folderChats: () => undefined,
  chatsLoading: false,
  now,
};

const summary = (rows: ReturnType<typeof buildSidebarRows>) =>
  rows.map((row) => (row.type === 'chat' ? `${'  '.repeat(row.depth)}${row.chat.id}` : row.type === 'folder' ? `${'  '.repeat(row.depth)}[${row.folder.name}]` : `${row.type}:${row.label}`));

describe('buildSidebarRows', () => {
  it('orders Pinned, Folders, then dated chats', () => {
    const rows = buildSidebarRows({
      ...base,
      pinned: [chat('p1', sec(2026, 9, 1))],
      folders: [folder('work', [folder('sub')], { is_expanded: true })],
      isExpanded: (f) => f.id === 'work',
      folderChats: (id) => (id === 'work' ? [chat('w1', sec(2026, 10, 1))] : undefined),
      chats: [chat('a', sec(2026, 10, 1)), chat('b', sec(2026, 9, 31)), chat('c', sec(2026, 6, 1))],
    });
    expect(summary(rows)).toEqual([
      'header:Pinned',
      'p1',
      'header:Folders',
      '[work]',
      '  [sub]',
      '  w1',
      'header:Today',
      'a',
      'header:Yesterday',
      'b',
      'header:July',
      'c',
    ]);
  });

  it('shows loading and empty notes', () => {
    expect(summary(buildSidebarRows({ ...base, chats: [], chatsLoading: true }))).toEqual(['note:Loading chats…']);
    expect(summary(buildSidebarRows({ ...base, chats: [] }))).toEqual(['note:No chats yet']);
    const open = buildSidebarRows({ ...base, chats: [], folders: [folder('f')], isExpanded: () => true });
    expect(summary(open)).toContain('note:Loading…');
  });

  it('shows only results while searching', () => {
    const rows = buildSidebarRows({
      ...base,
      pinned: [chat('p1', 1)],
      chats: [chat('a', 1)],
      search: { active: true, results: [chat('hit', 1)], loading: false },
    });
    expect(summary(rows)).toEqual(['hit']);
    expect(summary(buildSidebarRows({ ...base, chats: [], search: { active: true, results: [], loading: false } }))).toEqual([
      'note:No chats found',
    ]);
  });
});

describe('isUnread', () => {
  it('compares the last update with the last read time', () => {
    expect(isUnread(chat('a', 200, { last_read_at: 100 }))).toBe(true);
    expect(isUnread(chat('a', 100, { last_read_at: 200 }))).toBe(false);
    expect(isUnread(chat('a', 100))).toBe(false);
  });
});
