import { OcHttpError, OcNetworkError } from '@maviechat/opencode-protocol';

/** An OpenCode or gateway error in words. */
export function describeOcError(error: unknown): string {
  if (error instanceof OcHttpError) {
    if (error.status === 403) return error.detail ?? 'That project is outside the folders allowed on this machine.';
    if (error.status === 502) return error.detail ?? "OpenCode isn't answering on that machine.";
    return error.detail ?? `The machine answered ${error.status}.`;
  }
  if (error instanceof OcNetworkError) return error.timedOut ? 'The machine took too long to answer. Try again.' : "Couldn't reach the machine. Check the connection and try again.";
  return error instanceof Error ? error.message : 'Something went wrong.';
}
