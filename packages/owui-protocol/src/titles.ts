import type { HistoryMessage } from './history';
import type { OwuiClient } from './http';
import { outputText } from './stream';

export interface TitleMessage {
  role: string;
  content: string;
}

/** The shown branch as the title task reads it: each message's visible text. */
export function titleMessages(branch: HistoryMessage[]): TitleMessage[] {
  return branch.map((message) => ({ role: message.role, content: outputText(message.output) || message.content || '' }));
}

/** The model that answered last in the branch, else the chat's first model. */
export function titleModel(branch: HistoryMessage[], chatModels?: string[]): string | null {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const message = branch[index];
    if (message?.role === 'assistant' && typeof message.model === 'string' && message.model) return message.model;
  }
  return chatModels?.find(Boolean) ?? null;
}

/**
 * The title inside the task model's answer. It is asked for `{"title": "…"}` but may wrap it
 * in prose or use curly or single quotes; a plain JSON reading is tried before any repair,
 * so apostrophes inside a correct answer survive.
 */
export function parseGeneratedTitle(answer: string): string | null {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const block = answer.slice(start, end + 1);
  const repaired = block.replace(/[“”]/g, '"').replace(/'(\w+)'\s*:/g, '"$1":').replace(/:\s*'([^']*)'/g, ': "$1"');
  for (const candidate of [block, repaired]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const title = (parsed as { title?: unknown } | null)?.title;
      if (typeof title === 'string' && title.trim()) return title.trim();
    } catch {
      // try the next reading
    }
  }
  return null;
}

/**
 * Asks the server's title task for a chat title (the sidebar's Rename → Generate).
 * Throws when the server has title generation turned off or the answer holds no title.
 */
export async function generateTitle(
  client: OwuiClient,
  { model, messages, chatId }: { model: string; messages: TitleMessage[]; chatId?: string },
): Promise<string> {
  const response = await client.post<{ choices?: { message?: { content?: string } }[]; detail?: string }>('/api/v1/tasks/title/completions', {
    model,
    messages,
    ...(chatId ? { chat_id: chatId } : {}),
  });
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error(response.detail ?? 'The server sent no title');
  const title = parseGeneratedTitle(content);
  if (!title) throw new Error("The model's answer held no title");
  return title;
}
