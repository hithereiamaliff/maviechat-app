import type { OwuiClient } from './http';

/** A tool from `GET /api/v1/tools/` that can be switched on for a message (`tool_ids`). */
export interface ToolItem {
  id: string;
  name: string;
  meta?: { description?: string | null; [key: string]: unknown } | null;
  /**
   * Only on a tool that signs in to its own service (an MCP server with OAuth 2.1): whether
   * you've connected it. Such a tool can't be switched on until you have.
   */
  authenticated?: boolean;
  [key: string]: unknown;
}

export async function listTools(client: OwuiClient): Promise<ToolItem[]> {
  return (await client.get<ToolItem[] | null>('/api/v1/tools/')) ?? [];
}

/** A tool you connect by signing in to its own service (the web's "Click to connect"). */
export interface OAuthTool {
  id: string;
  name: string;
  /** The server's sign-in client for it (`mcp:{server id}`), in its sign-in pages' addresses. */
  clientId: string;
  connected: boolean;
  /** As on the web, an MCP server's sign-in can be disconnected from the menu. */
  canDisconnect: boolean;
}

/** The sign-in side of a tool, or null for a tool that needs none. */
export function oauthToolOf(tool: ToolItem): OAuthTool | null {
  if (typeof tool.authenticated !== 'boolean') return null;
  // As the web reads it: `server:mcp:{id}` signs in with the client `mcp:{id}`.
  const parts = tool.id.split(':');
  const serverId = parts[parts.length - 1] || tool.id;
  const kind = parts.length > 1 ? (parts[0] === 'server' ? parts[1] : parts[0]) : null;
  return {
    id: tool.id,
    name: tool.name || tool.id,
    clientId: `${kind || 'mcp'}:${serverId}`,
    connected: tool.authenticated,
    canDisconnect: tool.authenticated && tool.id.startsWith('server:mcp:'),
  };
}

/** True for a tool that waits for you to sign in to its service. */
export const needsConnect = (tool: ToolItem | undefined): boolean => tool?.authenticated === false;

const clientPath = (clientId: string) => clientId.split(':').map(encodeURIComponent).join(':');

/**
 * The server's page that starts a tool's sign-in (it needs you signed in, by cookie in a
 * browser) and sends you on to the service's own sign-in page.
 */
export const oauthAuthorizePath = (clientId: string): string => `/oauth/clients/${clientPath(clientId)}/authorize`;

/** Where the service sends you back; the server then keeps the sign-in and sends you to its start page. */
export const oauthCallbackPath = (clientId: string): string => `/oauth/clients/${clientPath(clientId)}/callback`;

/** Signs you out of a tool's service (the web's "Disconnect OAuth"); you connect again to use it. */
export async function disconnectOAuthTool(client: OwuiClient, tool: Pick<OAuthTool, 'clientId'>): Promise<void> {
  // The server keeps an MCP server's sign-in under `mcp:{id}`, the tool's client id.
  await client.delete<boolean>(`/api/v1/auths/oauth/sessions/${encodeURIComponent(tool.clientId)}`);
}

export type OAuthReturn = { kind: 'waiting'; sawCallback: boolean } | { kind: 'done'; error: string | null };

/**
 * Follows a tool's sign-in in a browser: once the service has sent you back to the server
 * (its callback page), the next page the server sends you to is the end. The server reports a
 * failure there as `?error=…`, as on the web.
 */
export function oauthReturn(url: string, clientId: string, sawCallback: boolean): OAuthReturn {
  let parsed: URL;
  let path: string;
  try {
    parsed = new URL(url);
    path = decodeURIComponent(parsed.pathname).replace(/\/+$/, '');
  } catch {
    return { kind: 'waiting', sawCallback };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { kind: 'waiting', sawCallback };
  if (path.endsWith(`/oauth/clients/${clientId}/callback`)) return { kind: 'waiting', sawCallback: true };
  if (sawCallback) return { kind: 'done', error: parsed.searchParams.get('error') || null };
  return { kind: 'waiting', sawCallback };
}
