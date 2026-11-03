import { TOKEN_COOKIE } from '@maviechat/deeptutor-protocol';

const THIRTY_DAYS = 30 * 24 * 60 * 60;

/** Where DeepTutor's login page would have sent you: its `next` path, if it stays on the same site. */
export function nextPath(loginUrl: string): string {
  const match = /[?&]next=([^&#]*)/.exec(loginUrl);
  let next = '/chat';
  try {
    next = match?.[1] ? decodeURIComponent(match[1]) : '/chat';
  } catch {
    next = '/chat';
  }
  // Only paths on this site: "/x", never "//host" or "https://…".
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/chat';
}

/** Whether a URL is DeepTutor's sign-in page. */
export function isLoginPage(url: string, baseUrl: string): boolean {
  return url.startsWith(`${baseUrl}/login`);
}

/**
 * Script that signs the web view in with the app's token, then opens where the login page
 * would have sent you. A fallback for when iOS's shared cookie store didn't reach the web view:
 * the cookie it sets is readable by the page (the server's own is HttpOnly), so it is used
 * only after the web view landed on the login page. Null for a token that isn't a JWT.
 */
export function signInScript(token: string, expiresAt: number | null, loginUrl: string, nowMs: number): string | null {
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
  const maxAge = expiresAt ? Math.max(60, Math.floor(expiresAt - nowMs / 1000)) : THIRTY_DAYS;
  const cookie = `${TOKEN_COOKIE}=${token}; path=/; max-age=${maxAge}; secure; samesite=lax`;
  return `document.cookie = ${JSON.stringify(cookie)}; window.location.replace(${JSON.stringify(nextPath(loginUrl))}); true;`;
}

/** Script that signs the web view out (the server clears its cookie), for "Sign out of DeepTutor". */
export const SIGN_OUT_SCRIPT = "fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(function () {}); true;";

let openWebView: { signOut: () => void } | null = null;

/** The web page on screen registers itself, so signing out from the sidebar signs it out too. */
export function registerWebView(view: { signOut: () => void } | null): void {
  openWebView = view;
}

/** Signs out the DeepTutor web page on screen, if there is one (its cookie store is its own). */
export function signOutWebView(): void {
  openWebView?.signOut();
}
