import type { FileDiff, MessageWithParts, TextPart } from './types';

/** What one of your messages led to: the files its reply changed. */
export interface TurnChanges {
  /** Your message's id. */
  messageID: string;
  /** The start of what you asked, for a heading. */
  prompt: string;
  files: FileDiff[];
}

export interface SessionChanges {
  /** Newest first. */
  turns: TurnChanges[];
  /** Different files changed across the session. */
  files: number;
  additions: number;
  deletions: number;
}

const firstLine = (text: string) => {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

/**
 * What a session changed, turn by turn. OpenCode 1.19 keeps each reply's changes on the message
 * that asked for it (`summary.diffs`, the project before and after the reply), and updates that
 * message as the reply goes, so the live session carries them.
 */
export function sessionChanges(messages: MessageWithParts[]): SessionChanges {
  const turns: TurnChanges[] = [];
  for (const entry of messages) {
    if (entry.info.role !== 'user') continue;
    const diffs = entry.info.summary?.diffs;
    if (!Array.isArray(diffs) || diffs.length === 0) continue;
    const asked = entry.parts.find((part): part is TextPart => part.type === 'text' && !(part as TextPart).synthetic);
    turns.push({ messageID: entry.info.id, prompt: firstLine(asked?.text ?? ''), files: diffs });
  }
  turns.reverse();
  return {
    turns,
    files: new Set(turns.flatMap((turn) => turn.files.map((file) => file.file ?? ''))).size,
    additions: turns.reduce((sum, turn) => sum + turn.files.reduce((count, file) => count + (file.additions || 0), 0), 0),
    deletions: turns.reduce((sum, turn) => sum + turn.files.reduce((count, file) => count + (file.deletions || 0), 0), 0),
  };
}
