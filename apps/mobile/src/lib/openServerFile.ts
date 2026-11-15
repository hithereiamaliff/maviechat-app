import { fileContentUrl } from '@maviechat/owui-protocol';
import { File, Paths } from 'expo-file-system';
import { shareLocalFile } from './shareLocalFile';

const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(-120) || 'file';

/**
 * A file stored on Open WebUI, downloaded with your token into the app's cache, then shown by
 * iOS (Quick Look), or offered to other apps when iOS can't show it.
 */
export async function openServerFile(session: { baseUrl: string; token: string }, id: string, filename: string): Promise<void> {
  const file = new File(Paths.cache, `${id.slice(0, 8)}-${safeName(filename)}`);
  await File.downloadFileAsync(fileContentUrl(session.baseUrl, id), file, { headers: { Authorization: `Bearer ${session.token}` }, idempotent: true });
  if (await File.canPreview(file).catch(() => false)) await File.preview(file);
  else await shareLocalFile(file.uri, filename);
}
