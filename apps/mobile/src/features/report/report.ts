/**
 * Reports about an AI reply (Google Play's AI-generated content policy: people must be able to report
 * offensive content to the app's developer without leaving the app). The person picks what's wrong;
 * the app sends it to TechMavie Digital through a Netlify form on techmavie.digital, which emails it
 * on. Nothing about the person goes with it: no sign-in, name, email or the rest of the chat.
 */

export type ReportSpace = 'owui' | 'deeptutor' | 'opencode';

export const REPORT_REASONS = [
  { key: 'offensive', label: 'Offensive or hateful' },
  { key: 'sexual', label: 'Sexual content' },
  { key: 'dangerous', label: 'Violent or dangerous' },
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'other', label: 'Something else' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['key'];

/** What's reported: where the reply came from and what it said. */
export interface ReportSubject {
  space: ReportSpace;
  /** The server's address (OpenCode: the gateway's), as a host name. */
  server: string;
  /** The model's name, when the app knows it. */
  model?: string;
  /** The reply's text as shown. */
  reply: string;
}

export interface ReportInput {
  subject: ReportSubject;
  reason: ReportReason;
  note: string;
  includeReply: boolean;
  app: { version: string; platform: string; update: string };
}

/** Netlify takes a form's posts at any path of the site; the form itself is in the site's HTML. */
export const REPORT_URL = 'https://techmavie.digital/';
export const REPORT_FORM = 'maviechat-report';
export const REPORT_EMAIL = 'hello@techmavie.digital';
export const REPORT_THREADS = { handle: '@hiiialanhere', url: 'https://www.threads.com/@hiiialanhere' } as const;
export const NOTE_LIMIT = 1000;
export const REPLY_LIMIT = 5000;

const SPACE_NAMES: Record<ReportSpace, string> = { owui: 'Open WebUI', deeptutor: 'DeepTutor', opencode: 'OpenCode' };

export function reasonLabel(reason: ReportReason): string {
  return REPORT_REASONS.find((item) => item.key === reason)?.label ?? 'Something else';
}

function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

/** The form's fields, in the order the email lists them. `bot-field` is Netlify's honeypot: it stays empty. */
export function reportFields(input: ReportInput): [string, string][] {
  return [
    ['form-name', REPORT_FORM],
    ['bot-field', ''],
    ['reason', reasonLabel(input.reason)],
    ['note', clip(input.note, NOTE_LIMIT)],
    ['space', SPACE_NAMES[input.subject.space]],
    ['server', input.subject.server],
    ['model', input.subject.model?.trim() ?? ''],
    ['reply', input.includeReply ? clip(input.subject.reply, REPLY_LIMIT) : '(not included)'],
    ['app', `MavieChat ${input.app.version} (${input.app.platform}, ${input.app.update})`],
  ];
}

/** URL-encoded, the way Netlify's forms take a post. */
export function reportBody(fields: [string, string][]): string {
  return fields.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}

/** Sends a report; throws when it didn't get through. */
export async function sendReport(input: ReportInput, send: typeof fetch = fetch, timeoutMs = 20_000): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await send(REPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: reportBody(reportFields(input)),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`the report wasn't accepted (${response.status})`);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('it took too long');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** The comment that goes with Open WebUI's own 👎, so the server's admins see why. */
export function serverComment(reason: ReportReason, note: string): string {
  const text = `Reported in MavieChat: ${reasonLabel(reason)}`;
  const extra = note.trim();
  return extra ? `${text}. ${clip(extra, NOTE_LIMIT)}` : text;
}

/** The sheet's opening words: who gets the report, and who chose the AI. */
export function reportIntro(subject: Pick<ReportSubject, 'space' | 'server'>, toServerAdmins: boolean): string {
  const opening = "Tell TechMavie Digital, who make MavieChat, about a reply that's offensive or harmful.";
  if (subject.space === 'opencode') return `${opening} It came from an AI model set up in OpenCode on your computer.`;
  const admins = toServerAdmins ? ', and its admins will see your report too' : '';
  return `${opening} Whoever runs ${subject.server} chooses its AI models${admins}.`;
}
