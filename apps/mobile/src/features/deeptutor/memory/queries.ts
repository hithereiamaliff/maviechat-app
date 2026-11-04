import {
  cancelMemoryRun,
  getMemoryDoc,
  getMemoryItems,
  getMemoryOverview,
  getMemoryRun,
  getMemoryRunLimits,
  memoryRunActive,
  parseMemorySheet,
  startMemoryRun,
  undoMemoryRun,
  type DtMemoryItem,
  type DtMemoryLayer,
  type DtMemoryRunMode,
} from '@maviechat/deeptutor-protocol';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';

function useMemoryKey() {
  const { session } = useDtAuthed();
  return (...rest: string[]) => [DT_QUERY_ROOT, session.baseUrl, 'memory', ...rest];
}

export function useMemoryOverview() {
  const { client } = useDtAuthed();
  const key = useMemoryKey();
  return useQuery({ queryKey: key('overview'), queryFn: () => getMemoryOverview(client), staleTime: 15_000 });
}

export function useMemorySheet(layer: DtMemoryLayer, key: string) {
  const { client } = useDtAuthed();
  const queryKey = useMemoryKey();
  return useQuery({ queryKey: queryKey('sheet', layer, key), queryFn: async () => parseMemorySheet(await getMemoryDoc(client, layer, key)), enabled: Boolean(key), staleTime: 15_000 });
}

/**
 * The items of the areas a fact cites, to name its sources: asked only while its sources are
 * shown, and never for chats (that list carries every message of every chat).
 */
export function useMemoryItems(surfaces: string[], enabled: boolean): (surface: string, id: string) => DtMemoryItem | undefined {
  const { client } = useDtAuthed();
  const key = useMemoryKey();
  const wanted = [...new Set(surfaces)].filter((surface) => surface !== 'chat');
  const results = useQueries({ queries: wanted.map((surface) => ({ queryKey: key('items', surface), queryFn: () => getMemoryItems(client, surface), enabled, staleTime: 5 * 60_000 })) });
  return (surface, id) => results[wanted.indexOf(surface)]?.data?.find((item) => item.id === id);
}

export function useMemoryRunLimits() {
  const { client } = useDtAuthed();
  const key = useMemoryKey();
  return useQuery({ queryKey: key('limits'), queryFn: () => getMemoryRunLimits(client), staleTime: 5 * 60_000 });
}

export function useMemoryRefresh(): () => void {
  const queryClient = useQueryClient();
  const key = useMemoryKey();
  return () => void queryClient.invalidateQueries({ queryKey: key() });
}

/** Runs this app started, by sheet. DeepTutor lists every account's runs, so the app follows only these. */
const started = new Map<string, string>();

/**
 * A run on one sheet: start one, follow it (its state every 2 s; it carries on if you leave),
 * cancel it, undo what it changed. When it ends, the sheet and the overview are read again.
 */
export function useMemoryRun(layer: DtMemoryLayer, key: string) {
  const { client } = useDtAuthed();
  const queryKey = useMemoryKey();
  const refresh = useMemoryRefresh();
  const sheet = `${layer}/${key}`;
  const [runId, setRunId] = useState<string | null>(() => started.get(sheet) ?? null);
  const run = useQuery({
    queryKey: queryKey('run', runId ?? ''),
    queryFn: () => getMemoryRun(client, runId ?? ''),
    enabled: Boolean(runId),
    refetchInterval: (query) => (query.state.data && !memoryRunActive(query.state.data) ? false : 2000),
  });
  const ended = run.data && !memoryRunActive(run.data) ? run.data.status : null;
  // Read the sheet again once, when the run ends.
  const refreshedFor = useRef<string | null>(null);
  useEffect(() => {
    if (ended && runId && refreshedFor.current !== runId) {
      refreshedFor.current = runId;
      refresh();
    }
  });

  const start = async (mode: DtMemoryRunMode, size: { budget?: number; iterations?: number }) => {
    const handle = await startMemoryRun(client, { layer, key, mode, ...size });
    started.set(sheet, handle.id);
    setRunId(handle.id);
  };
  const dismiss = () => {
    started.delete(sheet);
    setRunId(null);
  };
  return {
    run: run.data ?? null,
    lost: Boolean(runId) && run.isError,
    start,
    cancel: () => (runId ? cancelMemoryRun(client, runId) : Promise.resolve()),
    undo: async () => {
      if (!runId) return;
      await undoMemoryRun(client, runId);
      refresh();
      void run.refetch();
    },
    dismiss,
  };
}
