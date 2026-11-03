import type { DtClient } from './http';

/*
 * DeepTutor's Task Board (1.7.1): cards in three columns, one board per workspace (the app uses
 * the default one). A chat can link cards, which DeepTutor then gives the model as context.
 * Cards are archived, never deleted.
 */

export type DtTaskStatus = 'todo' | 'doing' | 'done';
export const DT_TASK_STATUSES: readonly DtTaskStatus[] = ['todo', 'doing', 'done'];
export type DtTaskColors = Record<DtTaskStatus, string>;

/** DeepTutor's own defaults, for a board that hasn't said. */
export const DT_DEFAULT_TASK_COLORS: DtTaskColors = { todo: '#2563eb', doing: '#a16207', done: '#15803d' };
export const DT_TASK_TITLE_MAX = 160;
export const DT_TASK_NOTE_MAX = 2000;

export interface DtTaskCard {
  id: string;
  title: string;
  note: string;
  status: DtTaskStatus;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /** A plain local day (YYYY-MM-DD), the same wherever the board is opened. */
  dueDate: string | null;
}

export interface DtSessionTaskLinks {
  sessionId: string;
  /** In the order they were linked; the last one colours the chat when its status is linked. */
  taskIds: string[];
  statusLinkEnabled: boolean;
}

export interface DtTaskBoard {
  cards: DtTaskCard[];
  colors: DtTaskColors;
  sessionLinks: DtSessionTaskLinks[];
  revision: number;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const isStatus = (value: unknown): value is DtTaskStatus => value === 'todo' || value === 'doing' || value === 'done';
const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

function boardOf(raw: unknown): DtTaskBoard {
  const board = record(raw);
  const colors = record(board.colors);
  return {
    cards: (Array.isArray(board.cards) ? board.cards : []).flatMap((item): DtTaskCard[] => {
      const card = record(item);
      if (!text(card.id)) return [];
      return [
        {
          id: text(card.id),
          title: text(card.title),
          note: text(card.note),
          status: isStatus(card.status) ? card.status : 'todo',
          archived: card.archived === true,
          createdAt: text(card.created_at),
          updatedAt: text(card.updated_at),
          dueDate: text(card.due_date) || null,
        },
      ];
    }),
    colors: {
      todo: isColor(colors.todo) ? colors.todo : DT_DEFAULT_TASK_COLORS.todo,
      doing: isColor(colors.doing) ? colors.doing : DT_DEFAULT_TASK_COLORS.doing,
      done: isColor(colors.done) ? colors.done : DT_DEFAULT_TASK_COLORS.done,
    },
    sessionLinks: (Array.isArray(board.session_links) ? board.session_links : []).flatMap((item): DtSessionTaskLinks[] => {
      const link = record(item);
      if (!text(link.session_id)) return [];
      return [
        {
          sessionId: text(link.session_id),
          taskIds: (Array.isArray(link.task_ids) ? link.task_ids : []).filter((id): id is string => typeof id === 'string'),
          statusLinkEnabled: link.status_link_enabled !== false,
        },
      ];
    }),
    revision: typeof board.revision === 'number' ? board.revision : 0,
  };
}

const BOARD = '/api/task-board';

export async function getTaskBoard(client: DtClient): Promise<DtTaskBoard> {
  return boardOf(await client.get<unknown>(BOARD));
}

/** A new card in To do; the whole board comes back. */
export async function createTask(client: DtClient, input: { title: string; note?: string; dueDate?: string | null }): Promise<DtTaskBoard> {
  const body: Record<string, unknown> = { title: input.title.trim() };
  if (input.note) body.note = input.note;
  if (input.dueDate) body.due_date = input.dueDate;
  return boardOf((await client.send<unknown>('POST', `${BOARD}/cards`, { body })).data);
}

export type DtTaskChanges = Partial<{ title: string; note: string; status: DtTaskStatus; archived: boolean; dueDate: string | null }>;

/** Changes only what's given; `dueDate: null` clears the date. */
export async function updateTask(client: DtClient, id: string, changes: DtTaskChanges): Promise<DtTaskBoard> {
  const body: Record<string, unknown> = {};
  if (changes.title !== undefined) body.title = changes.title.trim();
  if (changes.note !== undefined) body.note = changes.note;
  if (changes.status !== undefined) body.status = changes.status;
  if (changes.archived !== undefined) body.archived = changes.archived;
  if (changes.dueDate !== undefined) body.due_date = changes.dueDate;
  return boardOf((await client.send<unknown>('PATCH', `${BOARD}/cards/${encodeURIComponent(id)}`, { body })).data);
}

export async function setTaskColors(client: DtClient, colors: DtTaskColors): Promise<DtTaskBoard> {
  return boardOf((await client.send<unknown>('PUT', `${BOARD}/colors`, { body: colors })).data);
}

/** The cards a chat refers to (the whole list; an empty one unlinks them all). */
export async function linkSessionTasks(client: DtClient, sessionId: string, taskIds: string[]): Promise<DtTaskBoard> {
  return boardOf((await client.send<unknown>('PUT', `${BOARD}/sessions/${encodeURIComponent(sessionId)}`, { body: { workspace_id: '', task_ids: taskIds } })).data);
}

/** Whether the chat shows its last linked card's status colour. */
export async function setTaskStatusLink(client: DtClient, sessionId: string, enabled: boolean): Promise<DtTaskBoard> {
  return boardOf((await client.send<unknown>('PATCH', `${BOARD}/sessions/${encodeURIComponent(sessionId)}/status`, { body: { workspace_id: '', enabled } })).data);
}

export function sessionLinks(board: DtTaskBoard | undefined, sessionId: string): DtSessionTaskLinks | undefined {
  return board?.sessionLinks.find((link) => link.sessionId === sessionId);
}

/** The colour that marks a chat: its last linked card's status, when the status link is on. */
export function sessionStatusColor(board: DtTaskBoard | undefined, sessionId: string): string | undefined {
  const links = sessionLinks(board, sessionId);
  if (!links?.statusLinkEnabled) return undefined;
  const card = board?.cards.find((item) => item.id === links.taskIds[links.taskIds.length - 1]);
  return card ? board?.colors[card.status] : undefined;
}

/** How many calendar time blocks each card has (`GET /api/calendar/task-blocks`). */
export async function getTaskBlocks(client: DtClient): Promise<Record<string, number>> {
  const counts = record(await client.get<unknown>('/api/calendar/task-blocks'));
  return Object.fromEntries(Object.entries(counts).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
}

export type DtDueFilter = 'all' | 'today' | 'week';

/** The board's date filter: due today, or due this week (Monday to Sunday), as on the web. */
export function dueMatches(card: Pick<DtTaskCard, 'dueDate'>, filter: DtDueFilter, today: string, weekStart: string, weekEnd: string): boolean {
  if (filter === 'all') return true;
  if (!card.dueDate) return false;
  return filter === 'today' ? card.dueDate === today : card.dueDate >= weekStart && card.dueDate < weekEnd;
}

/** Past its due day and not done. */
export const isOverdue = (card: Pick<DtTaskCard, 'dueDate' | 'status'>, today: string) => card.status !== 'done' && card.dueDate !== null && card.dueDate < today;
