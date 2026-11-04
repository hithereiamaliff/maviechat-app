import {
  applyEvent,
  emptyLive,
  getMessages,
  getStatuses,
  getTodos,
  listPermissions,
  listQuestions,
  liveFromHistory,
  readEvents,
  type OcClient,
  type OcEvent,
  type SessionLive,
} from '@maviechat/opencode-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { fetch as streamingFetch } from 'expo/fetch';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useOcAuthed } from '@/session/OpenCodeProvider';
import { ocKey } from './queries';

type Listener = (event: OcEvent) => void;

/** Sent to a folder's listeners after its stream came back: what was missed must be read again. */
export const RECONNECTED = 'maviechat.reconnected';

interface Stream {
  listeners: Set<Listener>;
  controller: AbortController | null;
  retry: ReturnType<typeof setTimeout> | null;
  attempts: number;
}

/**
 * One event stream per project folder (the gateway's `/event`), shared by every screen that
 * needs it, opened again when the app comes back to the front (iOS closes it in the background).
 */
class EventHub {
  private readonly streams = new Map<string, Stream>();
  private readonly client: OcClient;

  constructor(client: OcClient) {
    this.client = client;
  }

  subscribe(directory: string, listener: Listener): () => void {
    let stream = this.streams.get(directory);
    if (!stream) {
      stream = { listeners: new Set(), controller: null, retry: null, attempts: 0 };
      this.streams.set(directory, stream);
    }
    stream.listeners.add(listener);
    if (!stream.controller && !stream.retry) this.open(directory, stream, false);
    return () => {
      stream.listeners.delete(listener);
      if (stream.listeners.size > 0) return;
      stream.controller?.abort();
      if (stream.retry) clearTimeout(stream.retry);
      this.streams.delete(directory);
    };
  }

  /** Back in the front: every stream opens again, and its listeners re-read what they missed. */
  reopenAll(): void {
    for (const [directory, stream] of this.streams) {
      stream.controller?.abort();
      if (stream.retry) clearTimeout(stream.retry);
      stream.retry = null;
      this.open(directory, stream, true);
    }
  }

  closeAll(): void {
    for (const stream of this.streams.values()) {
      stream.controller?.abort();
      if (stream.retry) clearTimeout(stream.retry);
    }
    this.streams.clear();
  }

  private open(directory: string, stream: Stream, reconnected: boolean): void {
    const controller = new AbortController();
    stream.controller = controller;
    const emit = (event: OcEvent) => {
      for (const listener of stream.listeners) listener(event);
    };
    const url = this.client.url(`/v1/oc/${encodeURIComponent(this.client.login)}/event`, { directory });
    void streamingFetch(url, { headers: { ...this.client.authHeaders(), Accept: 'text/event-stream' }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || !response.body) throw new Error(`event stream answered ${response.status}`);
        stream.attempts = 0;
        if (reconnected) emit({ type: RECONNECTED, properties: {} });
        await readEvents(response.body as unknown as ReadableStream<Uint8Array>, emit, controller.signal);
      })
      .catch(() => undefined)
      .finally(() => {
        if (controller.signal.aborted || stream.controller !== controller) return;
        // Dropped: try again, more slowly each time (2 s up to 30 s).
        stream.controller = null;
        stream.attempts += 1;
        stream.retry = setTimeout(() => {
          stream.retry = null;
          if (stream.listeners.size > 0) this.open(directory, stream, true);
        }, Math.min(30_000, 2000 * 2 ** Math.min(stream.attempts - 1, 4)));
      });
  }
}

const HubContext = createContext<EventHub | null>(null);

/** The OpenCode account's event streams. Keyed by account in the layout, so a switch starts afresh. */
export function OcLiveProvider({ children }: { children: ReactNode }) {
  const { client } = useOcAuthed();
  const [hub] = useState(() => new EventHub(client));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') hub.reopenAll();
    });
    return () => {
      subscription.remove();
      hub.closeAll();
    };
  }, [hub]);
  return <HubContext.Provider value={hub}>{children}</HubContext.Provider>;
}

/** Calls `listener` for each event from a project folder's stream, while mounted. */
export function useOcEvents(directory: string | null, listener: Listener): void {
  const hub = useContext(HubContext);
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  }, [listener]);
  useEffect(() => {
    if (!hub || !directory) return;
    return hub.subscribe(directory, (event) => latest.current(event));
  }, [hub, directory]);
}

/**
 * A session as it is now: its history, then every event for it, applied once per frame. On
 * opening, and after the stream comes back, it reads history and pending requests again.
 */
export function useOcSessionLive(sessionId: string, directory: string) {
  const { client, accountId } = useOcAuthed();
  const queryClient = useQueryClient();
  const [live, setLive] = useState<SessionLive>(() => emptyLive(sessionId));
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const queue = useRef<OcEvent[]>([]);
  const frame = useRef<number | null>(null);

  /** The session as saved, with what's pending laid over it. */
  const read = useCallback(async () => {
    const [history, statuses, permissions, questions, todos] = await Promise.all([
      getMessages(client, directory, sessionId),
      getStatuses(client, directory).catch(() => ({}) as Record<string, never>),
      listPermissions(client, directory).catch(() => []),
      listQuestions(client, directory).catch(() => []),
      getTodos(client, directory, sessionId).catch(() => []),
    ]);
    return liveFromHistory(sessionId, history, { status: statuses[sessionId], permissions, questions, todos });
  }, [client, directory, sessionId]);

  const load = useCallback(
    () =>
      read().then(
        (next) => {
          setLive(next);
          setProblem(null);
          setLoaded(true);
        },
        (error: unknown) => {
          setProblem(error);
          setLoaded(true);
        },
      ),
    [read],
  );

  useEffect(() => {
    let cancelled = false;
    read().then(
      (next) => {
        if (cancelled) return;
        setLive(next);
        setProblem(null);
        setLoaded(true);
      },
      (error: unknown) => {
        if (cancelled) return;
        setProblem(error);
        setLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [read]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  useOcEvents(directory, (event) => {
    if (event.type === RECONNECTED) {
      void load();
      return;
    }
    // The sidebar's list follows titles and new or removed sessions.
    if (event.type === 'session.updated' || event.type === 'session.created' || event.type === 'session.deleted') {
      void queryClient.invalidateQueries({ queryKey: ocKey(accountId, 'sessions') });
    }
    queue.current.push(event);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const events = queue.current;
      queue.current = [];
      setLive((current) => events.reduce(applyEvent, current));
    });
  });

  return { live, loaded, problem, reload: load };
}
