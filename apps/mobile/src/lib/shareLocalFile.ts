import * as Sharing from 'expo-sharing';
import { Platform, Share } from 'react-native';
import { mimeTypeOf } from './mimeType';

/**
 * Hands a file in the app's storage to the system's share sheet. On iPhone, React Native's Share,
 * as the app has always done (Save to Files, AirDrop, Mail…). Android shares only text that way,
 * so there files go through expo-sharing.
 */
export async function shareLocalFile(uri: string, title?: string): Promise<void> {
  if (Platform.OS === 'android') {
    await Sharing.shareAsync(uri, { mimeType: mimeTypeOf(uri), dialogTitle: title });
    return;
  }
  await Share.share({ url: uri, title });
}

/** A link to the share sheet: iPhone takes it as a link, Android as text. */
export function shareLink(link: string): Promise<unknown> {
  return Share.share(Platform.OS === 'android' ? { message: link } : { url: link });
}
