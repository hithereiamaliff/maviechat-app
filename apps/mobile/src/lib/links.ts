import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

/** Opens web links in the in-app browser and hands mail, phone and other schemes to iOS. */
export async function openLink(href: string, baseUrl?: string): Promise<void> {
  const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : baseUrl ? new URL(href, `${baseUrl}/`).toString() : href;
  if (/^https?:/i.test(url)) {
    await WebBrowser.openBrowserAsync(url);
  } else {
    await Linking.openURL(url);
  }
}
