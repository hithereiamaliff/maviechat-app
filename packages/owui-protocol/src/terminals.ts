import type { OwuiClient } from './http';
import type { ModelItem } from './models';

/**
 * A system the model can work on directly, running commands and handling files there: a terminal
 * server an admin set up (Admin Settings → Integrations), from `GET /api/v1/terminals/`. The web
 * lists these under "System" in the chat input's terminal menu.
 */
export interface TerminalServer {
  id: string;
  name?: string;
  url?: string;
  /** Where it's offered: `chat: false` keeps it out of chats; `{context_id: 'chat_id'}` gives each saved chat its own workspace. */
  contexts?: Record<string, false | { context_id?: string }>;
  config?: { chat_uploads?: string; [key: string]: unknown };
}

/** The systems this account may use. A server without them (or one that can't say) answers with none, as on the web. */
export async function listTerminals(client: OwuiClient): Promise<TerminalServer[]> {
  try {
    const list = await client.get<unknown>('/api/v1/terminals/');
    return Array.isArray(list) ? (list as TerminalServer[]).filter((item) => typeof item?.id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The systems a chat can use: named ones offered in chats. A temporary chat leaves out those whose
 * workspace belongs to a saved chat.
 */
export function chatTerminals(list: TerminalServer[], temporary: boolean): TerminalServer[] {
  return list.filter((terminal) => {
    const chat = terminal.contexts?.chat;
    if (!terminal.id || chat === false) return false;
    return !(temporary && chat?.context_id === 'chat_id');
  });
}

export const terminalLabel = (terminal: TerminalServer): string => terminal.name || terminal.id;

/** Whether a model may work on a system: its `terminal` capability, on unless an admin switched it off. */
export const canUseTerminal = (model: ModelItem | undefined): boolean => Boolean(model) && model?.info?.meta?.capabilities?.terminal !== false;

/** The system a model comes with (`info.meta.terminalId`, set in its editor), when it's one this account can use. */
export function modelTerminal(model: ModelItem | undefined, list: TerminalServer[]): string | null {
  const id = model?.info?.meta?.terminalId;
  return typeof id === 'string' && list.some((terminal) => terminal.id === id) ? id : null;
}

/**
 * The system a message goes out with: the one you chose, while it's offered in this chat and one of
 * the models answering may use it. The web then leaves the code interpreter off.
 */
export function activeTerminal(list: TerminalServer[], chosenId: string | null | undefined, models: (ModelItem | undefined)[], temporary: boolean): TerminalServer | null {
  if (!chosenId || !models.some(canUseTerminal)) return null;
  return chatTerminals(list, temporary).find((terminal) => terminal.id === chosenId) ?? null;
}
