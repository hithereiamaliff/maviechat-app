import { File, Paths } from 'expo-file-system';
import { Share } from 'react-native';

/** Writes an export to the app's cache and hands it to the share sheet (Save to Files, AirDrop, Mail…). */
export async function shareFile(name: string, content: string | Uint8Array): Promise<void> {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  await file.write(content);
  await Share.share({ url: file.uri, title: name });
}

export const shareJsonFile = (name: string, json: string): Promise<void> => shareFile(name, json);

/** A title as a file name: without characters file systems refuse, 80 characters at most. */
export const fileNameOf = (title: string, fallback: string): string => title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback;

/** Everything a list of chats lives in: read again after chats come in, or all change at once. */
export const CHAT_LIST_QUERIES = [['chats'], ['folder-chats'], ['folders'], ['archived'], ['chat'], ['tags']] as const;
