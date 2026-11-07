/*
 * Links to your Open WebUI server's own pages, opened in the app rather than the browser: a chat
 * (`/c/…`), a shared chat (`/s/…`), Notes and a note (`/notes/…`, with its `?page=`), a folder,
 * Workspace (its tab from the path) and a knowledge base, the Admin Panel, a new chat with the
 * web's own address settings (`/?q=…&models=…`), and the server's file links (opened with your
 * sign-in). Anything else, or another server's page, opens in the browser as before.
 */

export type LinkTarget = { kind: 'route'; pathname: string; params?: Record<string, string> } | { kind: 'file'; id: string };

const WORKSPACE_AREAS = new Set(['models', 'knowledge', 'prompts', 'skills', 'tools']);

/** Where a link to the server at `serverBase` goes in the app; null for anywhere else. */
export function serverLinkTarget(href: string, serverBase: string | null): LinkTarget | null {
  if (!serverBase) return null;
  let url: URL;
  let base: URL;
  try {
    base = new URL(serverBase);
    url = new URL(href, `${base.origin}${base.pathname.replace(/\/+$/, '')}/`);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  // A server under a path (https://host/chat) has its pages under that path.
  const prefix = base.pathname.replace(/\/+$/, '');
  if (prefix && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null;
  let parts: string[];
  try {
    parts = url.pathname.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  const query = Object.fromEntries(url.searchParams);
  const [first, second, third, fourth, fifth] = parts;
  const route = (pathname: string, params?: Record<string, string>): LinkTarget => ({ kind: 'route', pathname, ...(params && Object.keys(params).length ? { params } : {}) });

  if (!parts.length) return route('/', query);
  if (first === 'c' && second && parts.length === 2) return route('/c/[id]', { id: second });
  if (first === 's' && second && parts.length === 2) return route('/s/[id]', { id: second });
  if (first === 'notes' && parts.length === 1) return route('/notes');
  if (first === 'notes' && second === 'new' && parts.length === 2) return route('/notes');
  if (first === 'notes' && second && parts.length === 2) return route('/notes/[id]', { id: second, ...(query.page ? { page: query.page } : {}) });
  if (first === 'folders' && second && parts.length === 2) return route('/folders/[id]', { id: second });
  if (first === 'workspace' && second === 'knowledge' && third && third !== 'create' && parts.length === 3) return route('/knowledge/[id]', { id: third });
  if (first === 'workspace' && parts.length <= 2) return route('/workspace', second && WORKSPACE_AREAS.has(second) ? { area: second } : undefined);
  if (first === 'admin') return route('/admin');
  if (first === 'api' && second === 'v1' && third === 'files' && fourth && fifth === 'content' && parts.length === 5) return { kind: 'file', id: fourth };
  return null;
}

/** The Open WebUI account signed in now: links to its server open in the app. */
let current: { baseUrl: string; token: string } | null = null;

export const setLinkServer = (session: { baseUrl: string; token: string } | null) => {
  current = session;
};

export const linkServer = () => current;
