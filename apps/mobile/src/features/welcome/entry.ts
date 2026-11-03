/** Where the app goes when Open WebUI isn't signed in, given DeepTutor's sign-in (null: still loading, wait). */
export type SignedOutRoute = '/login' | '/learn' | '/welcome';

/**
 * Open WebUI's sign-in just expired: its sign-in screen, to say so. DeepTutor signed in: there
 * (either side works alone). Neither signed in, as on a first launch: the welcome screen, which
 * lets you pick one.
 */
export function signedOutRoute(deepTutor: 'loading' | 'signed-in' | 'signed-out', expired: boolean): SignedOutRoute | null {
  if (expired) return '/login';
  if (deepTutor === 'loading') return null;
  return deepTutor === 'signed-in' ? '/learn' : '/welcome';
}
