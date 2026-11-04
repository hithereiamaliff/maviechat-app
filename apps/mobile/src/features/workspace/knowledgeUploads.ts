import { fileProcessingStatus, getFileText, knowledgeUploadMetadata, listKnowledgeFiles, uploadFile } from '@maviechat/owui-protocol';
import { useEffect, useRef, useState } from 'react';
import { describeError } from '@/lib/errors';
import { useAuthed, useServerConfig } from '@/lib/server';
import { PHONE_UPLOAD_MAX_BYTES, textPart, uploadPart } from '@/lib/uploadPart';

/** One upload into a collection, from the phone: sending, being read by the server, or failed. */
export interface KnowledgeUpload {
  key: string;
  name: string;
  folderId: string | null;
  fileId: string | null;
  state: 'sending' | 'reading' | 'failed';
  error: string;
}

/** A picked file, or text made on the phone (a page's text, or typed in). */
export type UploadSource = { name: string; folderId: string | null; sourceUrl?: string } & ({ uri: string; type: string; size: number | null } | { text: string });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** How long the app follows one file before leaving it to the server (it carries on there). */
const FOLLOW_MS = 30 * 60_000;

/**
 * Uploads into a collection, followed until each file is in its folder (the server reads and
 * embeds it in the background, then links it) or the server says why it couldn't. Following
 * stops when the screen closes; the server carries on, and its own list of files being read
 * shows them next time.
 */
export function useKnowledgeUploads(kbId: string, onLinked: () => void) {
  const { client } = useAuthed();
  const config = useServerConfig();
  const [uploads, setUploads] = useState<KnowledgeUpload[]>([]);
  const alive = useRef(true);
  const counter = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const maxMb = (config.data?.file as { max_size?: unknown } | undefined)?.max_size;
  const maxBytes = Math.min(PHONE_UPLOAD_MAX_BYTES, typeof maxMb === 'number' && maxMb > 0 ? maxMb * 1024 * 1024 : Infinity);

  const patch = (key: string, change: Partial<KnowledgeUpload>) => setUploads((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)));
  const dismiss = (key: string) => setUploads((list) => list.filter((item) => item.key !== key));

  const follow = async (key: string, fileId: string, name: string, folderId: string | null) => {
    const started = Date.now();
    while (alive.current && Date.now() - started < FOLLOW_MS) {
      await sleep(2500);
      if (!alive.current) return;
      try {
        const status = await fileProcessingStatus(client, fileId);
        if (status === 'failed') {
          const read = await getFileText(client, fileId).catch(() => null);
          patch(key, { state: 'failed', error: read?.error || 'the server couldn’t read it' });
          return;
        }
        // Read once, then embedded into the collection and linked: done when it's in its folder.
        if (status === 'completed' && (await listKnowledgeFiles(client, kbId, { folderId, query: name })).files.some((file) => file.id === fileId)) {
          dismiss(key);
          onLinked();
          return;
        }
      } catch {
        // A blip: ask again next time round.
      }
    }
  };

  /** Sends each in turn; a file too big, empty or refused is marked failed with why. */
  const send = async (sources: UploadSource[]) => {
    const started = sources.map((source) => {
      counter.current += 1;
      return { source, key: `upload-${counter.current}` };
    });
    setUploads((list) => [...list, ...started.map(({ source, key }) => ({ key, name: source.name, folderId: source.folderId, fileId: null, state: 'sending' as const, error: '' }))]);
    for (const { source, key } of started) {
      const size = 'text' in source ? source.text.length : source.size;
      if (size === 0) {
        patch(key, { state: 'failed', error: 'it’s empty' });
        continue;
      }
      if (size !== null && size > maxBytes) {
        patch(key, { state: 'failed', error: `it’s over ${Math.round(maxBytes / (1024 * 1024))} MB` });
        continue;
      }
      try {
        const form = new FormData();
        form.append('file', 'text' in source ? textPart(source.name, source.text) : uploadPart({ uri: source.uri, name: source.name, type: source.type }));
        form.append('metadata', knowledgeUploadMetadata(kbId, source.folderId, source.sourceUrl));
        const uploaded = await uploadFile(client, form, { process: true });
        patch(key, { fileId: uploaded.id, state: 'reading' });
        void follow(key, uploaded.id, source.name, source.folderId);
      } catch (error) {
        patch(key, { state: 'failed', error: describeError(error) });
      }
    }
  };

  return { uploads, send, dismiss, reading: uploads.some((item) => item.state !== 'failed') };
}
