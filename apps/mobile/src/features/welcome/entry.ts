/** Where the app goes when Open WebUI isn't signed in, given the other spaces' sign-ins (null: still loading, wait). */
export type SignedOutRoute = '/login' | '/learn' | '/code' | '/welcome';

/**
 * Open WebUI's sign-in just expired: its sign-in screen, to say so. DeepTutor signed in: there
 * (either side works alone). Neither signed in, as on a first launch: the welcome screen, which
 * lets you pick one.
 */
export function signedOutRoute(deepTutor: 'loading' | 'signed-in' | 'signed-out', expired: boolean, openCode: 'loading' | 'signed-in' | 'signed-out' = 'signed-out'): SignedOutRoute | null {
  if (expired) return '/login';
  if (deepTutor === 'loading' || openCode === 'loading') return null;
  if (deepTutor === 'signed-in') return '/learn';
  return openCode === 'signed-in' ? '/code' : '/welcome';
}
