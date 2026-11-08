import { disconnectOAuthTool, listTools, oauthAuthorizePath, oauthToolOf, OwuiHttpError, type OwuiClient } from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

/** A sign-in client no server has: the server's pages answer for it without starting anything. */
const MISSING = 'mcp:app-probe-missing';

/**
 * A tool's Connect, as far as a server without a sign-in tool shows it (the test servers have no
 * tool service with OAuth): the tools list marks the tools that sign in to a service; your account
 * page, asked with your sign-in, keeps it as a browser cookie without sending you anywhere (the
 * app's private browser asks it first); the tool sign-in page turns you away without a sign-in and
 * takes the cookie; and Disconnect's address answers that there's nothing to remove for a tool
 * you haven't connected. Nothing is started, kept or removed. The cookie stays in memory and is
 * never printed.
 */
export async function probeOAuth({ client, baseUrl, token }: { client: OwuiClient; baseUrl: string; token: string }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const base = baseUrl.replace(/\/+$/, '');
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  const detailOf = (text: string): string => {
    try {
      const detail = (JSON.parse(text) as { detail?: unknown }).detail;
      return typeof detail === 'string' ? detail : '';
    } catch {
      return '';
    }
  };
  let cookie: string | null = null;

  await check('the tools list marks the tools that sign in to a service', async () => {
    const tools = await listTools(client);
    const signIn = tools.flatMap((tool) => {
      const oauth = oauthToolOf(tool);
      return oauth ? [oauth] : [];
    });
    const connected = signIn.filter((tool) => tool.connected).length;
    fixture.tools = { count: tools.length, signIn: signIn.length, connected };
    return `${tools.length} tools, ${signIn.length} signing in to a service (${connected} connected)`;
  });

  await check('your account page, asked with your sign-in, keeps it as a browser cookie and sends you nowhere', async () => {
    const response = await fetch(`${base}/api/v1/auths/`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' });
    // The answer holds your sign-in: read and dropped.
    await response.text();
    const set = response.headers.getSetCookie().filter((line) => line.startsWith('token='));
    fixture.accountPage = { status: response.status, cookie: set.length > 0, httpOnly: set.some((line) => /;\s*httponly/i.test(line)), redirect: response.headers.has('location') };
    if (response.status !== 200) throw new Error(`answered ${response.status}`);
    if (response.headers.has('location')) throw new Error('it sent the browser on elsewhere');
    const pair = set[0]?.split(';')[0];
    if (!pair || pair === 'token=') throw new Error('no sign-in cookie came back');
    cookie = pair;
    return `HTTP 200, the sign-in cookie set${set.some((line) => /;\s*httponly/i.test(line)) ? ' (HttpOnly)' : ''}, no redirect`;
  });

  await check('the tool sign-in page turns you away without a sign-in, and takes the cookie', async () => {
    const url = `${base}${oauthAuthorizePath(MISSING)}`;
    const without = await fetch(url, { redirect: 'manual' });
    await without.text();
    if (!cookie) throw new Error('no cookie to try');
    const signedIn = await fetch(url, { headers: { Cookie: cookie }, redirect: 'manual' });
    const detail = detailOf(await signedIn.text());
    fixture.authorize = { without: without.status, withCookie: signedIn.status, detail };
    if (without.status !== 401 && without.status !== 403) throw new Error(`without a sign-in it answered ${without.status}`);
    // Past the sign-in check, the server knows no such tool (404), or tool servers are off (0.12's 403 says so).
    if (signedIn.status === 404) return `without a sign-in HTTP ${without.status}; with the cookie HTTP 404 for a tool it doesn't have`;
    if (signedIn.status === 403 && /tool servers are disabled/i.test(detail)) return `without a sign-in HTTP ${without.status}; with the cookie HTTP 403: tool servers are off here`;
    throw new Error(`with the cookie it answered ${signedIn.status}${detail ? `: ${detail}` : ''}`);
  });

  await check('Disconnect for a tool you haven’t connected: nothing to remove', async () => {
    try {
      await disconnectOAuthTool(client, { clientId: MISSING });
    } catch (error) {
      if (error instanceof OwuiHttpError && error.status === 404) {
        fixture.disconnect = { status: 404 };
        return `HTTP 404: ${error.detail ?? 'no sign-in kept for it'}`;
      }
      throw error;
    }
    throw new Error('the server said it removed a sign-in that wasn’t there');
  });

  return { steps, fixture };
}
