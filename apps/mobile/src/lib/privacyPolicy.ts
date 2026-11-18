import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

/**
 * MavieChat's privacy policy, on TechMavie Digital's website (English and Malay). Both stores ask
 * for a link inside the app as well as on the listing: Settings → About, OpenCode's account menu
 * and the welcome screen open it.
 */
export const PRIVACY_POLICY_URL = 'https://techmavie.digital/maviechat/privacy/';

/** Opens the privacy policy in the in-app browser, or in the device's browser if that can't open. */
export function openPrivacyPolicy(): void {
  void WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL).catch(() => Linking.openURL(PRIVACY_POLICY_URL).catch(() => undefined));
}
