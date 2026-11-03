import type { DtKbProgress, DtKnowledgeBaseInfo, DtRagProvider } from '@maviechat/deeptutor-protocol';

/** A knowledge base is still being built or indexed ("needs_reindex" is not: it waits for you). */
export const kbBusy = (status: string) => /^(initializing|processing|pending|queued|running|indexing)$/i.test(status);

export const kbFailed = (status: string) => /^(error|failed)$/i.test(status);

export interface KbStatus {
  label: string;
  tone: 'normal' | 'busy' | 'problem';
  /** DeepTutor's own words on what went wrong, when it failed. */
  detail?: string;
}

/** How a knowledge base stands, in a few words: ready, indexing (how far) or what's wrong. */
export function kbStatus(info: Pick<DtKnowledgeBaseInfo, 'status' | 'needsReindex' | 'progress'>, progress?: DtKbProgress | null): KbStatus {
  const latest = progress ?? info.progress;
  if (kbFailed(info.status) || latest?.stage === 'error') return { label: 'Indexing failed', tone: 'problem', detail: latest?.message || undefined };
  if (kbBusy(info.status)) {
    const percent = latest && latest.percent > 0 && latest.percent < 100 ? ` ${Math.round(latest.percent)}%` : '';
    return { label: `Indexing${percent}${latest?.fileName ? ` · ${latest.fileName}` : ''}`, tone: 'busy' };
  }
  if (info.needsReindex || info.status === 'needs_reindex') return { label: 'Needs re-indexing', tone: 'problem' };
  if (info.status === 'unavailable') return { label: 'Unavailable', tone: 'problem' };
  if (!info.status || info.status === 'ready') return { label: 'Ready', tone: 'normal' };
  return { label: info.status.replace(/_/g, ' ').replace(/^./, (first) => first.toUpperCase()), tone: 'normal' };
}

export const documentCount = (count: number) => (count === 1 ? '1 document' : `${count} documents`);

/** The engine's name as DeepTutor gives it, else its id. */
export const engineName = (id: string, providers: DtRagProvider[] | undefined) => providers?.find((provider) => provider.id === id)?.name ?? id;

/** A file size for people. */
export function fileSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
