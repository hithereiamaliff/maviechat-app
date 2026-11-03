import { SOCKET_AUTH_FAILED, socketCookieHeader, type DtSocketFactory } from '@maviechat/deeptutor-protocol';

// React Native's WebSocket takes request headers as a third argument, which the DOM typings don't declare.
const SocketWithHeaders = WebSocket as unknown as new (url: string, protocols: undefined, options: { headers: Record<string, string> }) => WebSocket;

/**
 * Sockets to DeepTutor (`/ws` for chats, `/ws/books` for books), signed in by a `Cookie` header as
 * DeepTutor's own pages are. Never the token in the address: DeepTutor logs socket addresses.
 */
export function dtSocketFactory(token: string): DtSocketFactory {
  return (url, handlers) => {
    const socket = new SocketWithHeaders(url, undefined, { headers: { Cookie: socketCookieHeader(token) } });
    let opened = false;
    let refused = false;
    socket.onopen = () => {
      opened = true;
      handlers.onOpen();
    };
    socket.onmessage = (event) => handlers.onMessage(event.data);
    // A refused sign-in fails the handshake (HTTP 401/403) before the socket opens.
    socket.onerror = (event) => {
      if (!opened && /\b40[13]\b/.test(String((event as { message?: unknown }).message ?? ''))) refused = true;
    };
    socket.onclose = (event) => handlers.onClose(refused ? SOCKET_AUTH_FAILED : event.code);
    return { send: (data) => socket.send(data), close: () => socket.close() };
  };
}
