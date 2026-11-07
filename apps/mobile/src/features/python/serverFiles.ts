import { fileContentUrl } from '@maviechat/owui-protocol';
import { File, Paths } from 'expo-file-system';
import type { PythonFile } from './runner';

/** Bigger files are left out: they'd pass through the web view as text. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Kinds of attachment that aren't files on the server. */
const NOT_FILES = new Set(['collection', 'folder', 'chat', 'note', 'web_search']);

/**
 * The chat's files the server lists with the code interpreter's request, downloaded with your
 * sign-in for `/mnt/uploads`, as the web does. The token stays in the app; Python gets the bytes.
 * Notes say which files couldn't come, for the output.
 */
export async function pythonFiles(session: { baseUrl: string; token: string }, items: unknown): Promise<{ files: PythonFile[]; notes: string[] }> {
  const files: PythonFile[] = [];
  const notes: string[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    if (!id || (typeof record.type === 'string' && NOT_FILES.has(record.type))) continue;
    const name = baseName(record.filename ?? record.name);
    const local = new File(Paths.cache, `python-${id.slice(0, 8)}-${name}`);
    try {
      await File.downloadFileAsync(fileContentUrl(session.baseUrl, id), local, { headers: { Authorization: `Bearer ${session.token}` }, idempotent: true });
      if (local.size > MAX_FILE_BYTES) notes.push(`${name} was left out: it's over 10 MB, too big to hand to Python on the phone.`);
      else files.push({ name, base64: await local.base64() });
    } catch {
      notes.push(`${name} couldn't be fetched for Python.`);
    } finally {
      try {
        if (local.exists) local.delete();
      } catch {
        // already gone
      }
    }
  }
  return { files, notes };
}

/** A name to save under in `/mnt/uploads`: no folders, no control characters. */
export function baseName(value: unknown): string {
  const name = typeof value === 'string' ? (value.split(/[\\/]/).pop() ?? '') : '';
  const clean = name.replace(/[\u0000-\u001f]/g, '').trim();
  return clean && clean !== '.' && clean !== '..' ? clean.slice(-120) : 'file';
}
