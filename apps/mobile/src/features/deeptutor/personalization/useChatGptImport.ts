import { chatGptImportSessions, importBatches, importChatHistory, type DtImportSession } from '@maviechat/deeptutor-protocol';
import { isChatGptExport, readChatGptExport } from '@maviechat/owui-protocol';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { Alert } from 'react-native';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';

/** Bigger exports are read on DeepTutor's web page instead (the whole file is parsed at once). */
const LIMIT_BYTES = 50 * 1024 * 1024;

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/**
 * Imports ChatGPT's `conversations.json` (from the export ChatGPT emails, unzipped in Files) into
 * DeepTutor: read on the phone, sent in batches with progress. A conversation already imported
 * stays as it is, so running it again picks up where it stopped.
 */
export function useChatGptImport(onDone: () => void) {
  const { client } = useDtAuthed();
  const toast = useToast();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const run = async (sessions: DtImportSession[]) => {
    let imported = 0;
    let skipped = 0;
    let done = 0;
    setProgress({ done, total: sessions.length });
    try {
      for (const batch of importBatches(sessions)) {
        const totals = await importChatHistory(client, 'chatgpt', batch);
        imported += totals.imported;
        skipped += totals.skipped;
        done += batch.length;
        setProgress({ done, total: sessions.length });
      }
      toast(`Imported ${plural(imported, 'conversation')}${skipped ? `; ${plural(skipped, 'was', 'were')} there already or empty` : ''}`);
    } catch (error) {
      toast(`Imported ${imported.toLocaleString()} of ${sessions.length.toLocaleString()}, then: ${describeError(error)}. Import again to carry on.`, 'error');
    } finally {
      setProgress(null);
      onDone();
    }
  };

  const choose = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
    const asset = picked.canceled ? undefined : picked.assets[0];
    if (!asset) return;
    if ((asset.size ?? 0) > LIMIT_BYTES) return toast('This file is too big to import on the phone: import it on DeepTutor’s web page instead.', 'error');
    let sessions: DtImportSession[];
    let left = 0;
    try {
      const json: unknown = JSON.parse(await new File(asset.uri).text());
      const tree = typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
      const list = Array.isArray(json) ? json : Array.isArray(tree?.conversations) ? (tree.conversations as unknown[]) : tree ? [tree] : [];
      if (!isChatGptExport(list)) return toast('This isn’t ChatGPT’s conversations.json. It’s in the zip ChatGPT emails you: unzip it in Files first.', 'error');
      const read = readChatGptExport(list);
      sessions = chatGptImportSessions(read.conversations);
      left = read.skipped + read.conversations.length - sessions.length;
    } catch (error) {
      return toast(`Couldn’t read the file: ${describeError(error)}`, 'error');
    }
    if (!sessions.length) return toast('There’s nothing in the file to import.', 'error');
    Alert.alert(`Import ${plural(sessions.length, 'conversation')}?`, `Into DeepTutor, kept apart from your chat history; ones imported before stay as they are.${left ? ` ${plural(left, 'entry', 'entries')} in the file have nothing to import.` : ''}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Import', onPress: () => void run(sessions) },
    ]);
  };

  return { choose, progress };
}
