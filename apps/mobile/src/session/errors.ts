import { OwuiHttpError, OwuiNetworkError } from '@maviechat/owui-protocol';

/** A sign-in failure in words a person can act on. The server's own message wins when it sent one. */
export function describeSignInError(error: unknown): string {
  if (error instanceof OwuiHttpError) {
    if (error.detail) return error.detail;
    if (error.status === 404) return "That address doesn't look like an Open WebUI server.";
    return `The server answered with an error (HTTP ${error.status}).`;
  }
  if (error instanceof OwuiNetworkError) {
    return error.timedOut
      ? 'The server took too long to answer. Try again in a moment.'
      : "Couldn't reach the server. Check the address and your connection.";
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Sign-in failed. Please try again.';
}
