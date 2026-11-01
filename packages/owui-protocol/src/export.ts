import { branchPath, type ChatHistory, type HistoryMessage } from './history';
import { outputText } from './stream';

export interface ChatExport {
  title: string;
  /** The shown branch as Markdown, one section per message. */
  markdown: string;
  /** The first question asked. */
  firstQuestion: string;
  /** One line about the chat (never empty). */
  summary: string;
  messageCount: number;
  models: string[];
}

interface ChatExportInput {
  title: string;
  history: ChatHistory;
  /** Display name for a model id. */
  modelName: (id: string | undefined) => string;
  /** Where it came from, e.g. the server's host. */
  source?: string;
  /** Unix seconds; the chat's last update. */
  updatedAt?: number;
}

/** A message's visible text: the reply's output, else its content. Reasoning and tool steps are left out. */
function visibleText(message: HistoryMessage): string {
  return (outputText(message.output) || message.content || '').trim();
}

/** The shown branch of a chat, ready to file elsewhere ("Send to DeepTutor"). */
export function exportChat({ title, history, modelName, source, updatedAt }: ChatExportInput): ChatExport {
  const messages = branchPath(history).filter((message) => message.role === 'user' || message.role === 'assistant');
  const name = title.trim() || 'Open WebUI chat';
  const date = updatedAt ? new Date(updatedAt * 1000).toISOString().slice(0, 10) : null;
  const lines = [`# ${name}`, '', `A chat from Open WebUI${source ? ` (${source})` : ''}${date ? `, last updated ${date}` : ''}.`];
  const models: string[] = [];
  let count = 0;
  for (const message of messages) {
    const text = visibleText(message);
    if (!text) continue;
    count += 1;
    const speaker = message.role === 'user' ? 'User' : modelName(message.model);
    if (message.role === 'assistant' && !models.includes(speaker)) models.push(speaker);
    lines.push('', `## ${speaker}`, '', text);
  }
  const firstQuestion = messages.find((message) => message.role === 'user' && visibleText(message));
  const withModels = models.length ? ` with ${models.join(', ')}` : '';
  return {
    title: name,
    markdown: `${lines.join('\n')}\n`,
    firstQuestion: firstQuestion ? visibleText(firstQuestion) : name,
    summary: `An Open WebUI chat${withModels}: ${count} message${count === 1 ? '' : 's'}${date ? `, ${date}` : ''}.`,
    messageCount: count,
    models,
  };
}

/** Longest text attached from another app; beyond it the oldest part is dropped so the newest stays. */
export const ATTACHED_TEXT_LIMIT = 60_000;

/** Keeps the end of a long document, saying that the start was left out. */
export function keepTail(text: string, limit = ATTACHED_TEXT_LIMIT): string {
  if (text.length <= limit) return text;
  const tail = text.slice(text.length - limit);
  const cut = tail.indexOf('\n## ');
  return `(Earlier messages were left out to keep this short.)\n${cut >= 0 ? tail.slice(cut) : tail}`;
}
