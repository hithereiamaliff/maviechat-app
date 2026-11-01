import { shownMessages, type DtSession } from './sessions';

const SPEAKERS: Record<string, string> = { user: 'User', assistant: 'DeepTutor' };

/**
 * A DeepTutor chat as a Markdown document: the shown branch, one section per message.
 * MavieChat uploads it to Open WebUI so a chat there can draw on it.
 */
export function sessionMarkdown(session: DtSession, { source }: { source?: string } = {}): string {
  const updated = isoDate(session.updated_at ?? session.created_at);
  const lines = [
    `# ${session.title?.trim() || 'DeepTutor chat'}`,
    '',
    `A chat from DeepTutor${source ? ` (${source})` : ''}${updated ? `, last updated ${updated}` : ''}.`,
  ];
  for (const message of shownMessages(session)) {
    const text = message.content?.trim();
    if (!text) continue;
    lines.push('', `## ${SPEAKERS[message.role] ?? message.role}`, '', text);
  }
  return `${lines.join('\n')}\n`;
}

/** A file name for the document: the title, without characters file systems reject. */
export function sessionFileName(session: DtSession): string {
  const title = (session.title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `DeepTutor - ${title || 'chat'}.md`;
}

/** `YYYY-MM-DD` from Unix seconds (or milliseconds) or an ISO string. */
function isoDate(value: number | string | undefined): string | null {
  if (value === undefined || value === '') return null;
  const time = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}
