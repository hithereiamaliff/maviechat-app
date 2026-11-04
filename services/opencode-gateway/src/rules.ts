import path from 'node:path';

/*
 * What a paired phone may ask OpenCode for: only the routes the app uses, only for projects inside
 * the allowed folders, and file paths that stay inside the project. Sessions it creates ask
 * before editing files or running commands, unless the phone switched that off for the session.
 */

/** Whether a project folder lies inside one of the allowed folders, once "." and ".." are resolved. */
export function folderAllowed(directory: string, allowed: readonly string[]): boolean {
  if (!directory.startsWith('/') || directory.includes('\0')) return false;
  const resolved = path.posix.resolve(directory);
  return allowed.some((root) => {
    const base = path.posix.resolve(root);
    return resolved === base || resolved.startsWith(base === '/' ? '/' : `${base}/`);
  });
}

/** A path inside the project: relative, never climbing out with "..". Empty means the project itself. */
export function insideProject(value: string): boolean {
  if (value.startsWith('/') || value.includes('\0') || value.includes('\\')) return false;
  return !path.posix.normalize(value || '.').split('/').includes('..');
}

const ID = '[A-Za-z0-9_-]{1,128}';

interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  pattern: RegExp;
  /** Whether the request must name its project with `?directory=` (inside the allowed folders). */
  project: boolean;
  /** A query parameter holding a path that must stay inside the project. */
  pathParam?: string;
  /** A label for the log, without ids. */
  label: string;
}

const route = (method: Route['method'], pattern: string, label: string, extra: Partial<Route> = {}): Route => ({
  method,
  pattern: new RegExp(`^${pattern}$`),
  project: true,
  label,
  ...extra,
});

/** The OpenCode routes the app uses (OpenCode 1.19's documented API); everything else is refused. */
export const ROUTES: readonly Route[] = [
  route('GET', '/global/health', '/global/health', { project: false }),
  route('GET', '/event', '/event'),
  route('GET', '/path', '/path'),
  route('GET', '/project', '/project'),
  route('GET', '/config/providers', '/config/providers'),
  // Only the default model comes back (sanitize.ts): the config also holds MCP servers' keys.
  route('GET', '/config', '/config'),
  route('GET', '/agent', '/agent'),
  route('GET', '/session', '/session'),
  route('POST', '/session', '/session'),
  route('GET', '/session/status', '/session/status'),
  route('GET', `/session/${ID}`, '/session/:id'),
  route('PATCH', `/session/${ID}`, '/session/:id'),
  route('DELETE', `/session/${ID}`, '/session/:id'),
  route('GET', `/session/${ID}/message`, '/session/:id/message'),
  route('POST', `/session/${ID}/prompt_async`, '/session/:id/prompt_async'),
  route('POST', `/session/${ID}/abort`, '/session/:id/abort'),
  route('GET', `/session/${ID}/diff`, '/session/:id/diff'),
  route('GET', `/session/${ID}/todo`, '/session/:id/todo'),
  route('GET', '/permission', '/permission'),
  route('POST', `/permission/${ID}/reply`, '/permission/:id/reply'),
  route('GET', '/question', '/question'),
  route('POST', `/question/${ID}/reply`, '/question/:id/reply'),
  route('POST', `/question/${ID}/reject`, '/question/:id/reject'),
  // Folder listings for picking a project. File contents stay closed: they could include a project's .env.
  route('GET', '/file', '/file', { pathParam: 'path' }),
];

export type Verdict = { ok: true; label: string } | { ok: false; status: 403 | 404; error: string; label: string };

/** Whether a forwarded request is allowed, judged on its method, path and query alone. */
export function checkRequest(method: string, pathname: string, query: URLSearchParams, allowed: readonly string[]): Verdict {
  const found = ROUTES.find((item) => item.method === method && item.pattern.test(pathname));
  if (!found) return { ok: false, status: 404, error: 'Not available through MavieChat', label: '(refused)' };
  if (found.project) {
    const directory = query.get('directory');
    if (!directory || !folderAllowed(directory, allowed)) return { ok: false, status: 403, error: 'That project is outside the folders allowed on this machine', label: found.label };
  }
  if (query.has('workspace')) return { ok: false, status: 403, error: 'Workspaces are not available through MavieChat', label: found.label };
  if (found.pathParam && !insideProject(query.get(found.pathParam) ?? '')) return { ok: false, status: 403, error: 'That path is outside the project', label: found.label };
  return { ok: true, label: found.label };
}

/** Rules for sessions started from the phone: ask before changing files or running commands (the last matching rule wins). */
export const ASK_BEFORE_CHANGES = [
  { permission: 'edit', pattern: '*', action: 'ask' },
  { permission: 'bash', pattern: '*', action: 'ask' },
] as const;

/**
 * A new session's body, with approvals added unless the phone asked for none
 * (`x-maviechat-approvals: off`) or set its own rules.
 */
export function withApprovals(body: unknown, approvals: string | undefined): unknown {
  if (approvals === 'off') return body;
  const value = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (Array.isArray(value.permission)) return value;
  return { ...value, permission: [...ASK_BEFORE_CHANGES] };
}
