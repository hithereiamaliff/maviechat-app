/*
 * Apple's guideline 5.1.2(i): an app says where personal data goes, "including with third-party
 * AI", and gets permission before it goes. MavieChat can't know which AI services a server uses,
 * and every server differs, so the notice names the server and says that whoever runs it picks
 * them, under the server's own policy. It never names a server's services. OpenCode's notice
 * names the AI providers set up on the paired computer, which the app lists anyway.
 *
 * It's asked once per server on this phone, before the first message or file goes there. For
 * OpenCode it's asked once per machine and login, because each login has its own providers.
 * Not Now sends nothing, and the next send asks again.
 */

/** One server's notice: accepted once per `key` on this phone. */
export interface AiNotice {
  key: string;
  message: string;
}

export const AI_NOTICE_TITLE = 'Where your messages go';

/** What a send that stopped at Not Now throws, where the caller expects an error. */
export class NotSentError extends Error {
  constructor() {
    super('you chose Not Now');
    this.name = 'NotSentError';
  }
}

/** True for a send stopped at Not Now: the person chose it, so it needs no error message. */
export function isNotSent(error: unknown): boolean {
  return error instanceof NotSentError;
}

// The same server however its address was typed (as `sameServer` in session/accounts.ts compares them).
const serverId = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();

/** `https://chat.example.com/` → `chat.example.com`. */
export function hostOf(url: string): string {
  return url.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '');
}

/** Open WebUI and DeepTutor: the server, and that whoever runs it picks the AI services. */
export function serverNotice(space: 'owui' | 'deeptutor', baseUrl: string): AiNotice {
  return {
    key: `${space} ${serverId(baseUrl)}`,
    message:
      `What you send here, including files and photos, goes to ${hostOf(baseUrl)}. ` +
      'To answer you, that server may pass it on to AI services from other companies. ' +
      'Whoever runs the server chooses those services, and the server’s own privacy policy applies.',
  };
}

/** OpenCode: the paired computer, and the AI providers set up on it (none known yet: just "set up there"). */
export function openCodeNotice(machine: { gatewayUrl: string; machineName: string; loginId: string }, providers: readonly string[]): AiNotice {
  const names = [...new Set(providers.map((name) => name.trim()).filter(Boolean))];
  const where = names.length ? `the AI providers set up there (${listOf(names)})` : 'the AI providers set up there';
  return {
    key: `opencode ${serverId(machine.gatewayUrl)} ${machine.loginId}`,
    message:
      `What you send here goes to ${machine.machineName}. ` +
      `OpenCode on that computer sends it, with parts of the files it works on, to ${where}. ` +
      'Their own terms and privacy policies apply.',
  };
}

/** `A`, `A and B`, `A, B and C`. */
export function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The keys accepted on this phone, as stored: a JSON list of strings. Anything else counts as none. */
export function parseAccepted(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}
