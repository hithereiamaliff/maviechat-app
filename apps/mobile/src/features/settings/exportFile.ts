import { File, Paths } from 'expo-file-system';
import { Share } from 'react-native';

/** Writes an export to the app's cache and hands it to the share sheet (Save to Files, AirDrop, Mail…). */
export async function shareJsonFile(name: string, json: string): Promise<void> {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  await file.write(json);
  await Share.share({ url: file.uri, title: name });
}

/** Everything a list of chats lives in: read again after chats come in, or all change at once. */
export const CHAT_LIST_QUERIES = [['chats'], ['folder-chats'], ['folders'], ['archived'], ['chat'], ['tags']] as const;
