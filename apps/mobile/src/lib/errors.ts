import { DtHttpError, DtNetworkError } from '@maviechat/deeptutor-protocol';
import { OwuiHttpError, OwuiNetworkError } from '@maviechat/owui-protocol';

/** A failed request in a few words, for "Couldn't …: <reason>" messages. The server's own message wins. */
export function describeError(error: unknown): string {
  if (error instanceof OwuiHttpError || error instanceof DtHttpError) return error.detail ?? `HTTP ${error.status}`;
  if (error instanceof OwuiNetworkError || error instanceof DtNetworkError) {
    return error.timedOut ? 'the server took too long to answer' : "couldn't reach the server";
  }
  return error instanceof Error ? error.message : 'unknown error';
}
