import { getFileText, OwuiClient } from '@maviechat/owui-protocol';
import { router, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import { openServerFile } from './openServerFile';
import { linkServer, serverLinkTarget } from './serverLinks';

/**
 * Opens a link: one to your Open WebUI server's own pages in the app (see `serverLinkTarget`),
 * a file on it with your sign-in; other web links in the in-app browser, and mail, phone and
 * other schemes in iOS.
 */
export async function openLink(href: string, baseUrl?: string): Promise<void> {
  const url = /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : baseUrl ? new URL(href, `${baseUrl}/`).toString() : href;
  const server = linkServer();
  const target = serverLinkTarget(url, server?.baseUrl ?? null);
  if (target?.kind === 'route') {
    router.push({ pathname: target.pathname, params: target.params } as Href);
    return;
  }
  if (target?.kind === 'file' && server) {
    // Its own name, so iOS knows what kind of file it is.
    const name = await getFileText(new OwuiClient({ baseUrl: server.baseUrl, token: server.token }), target.id).then(
      (file) => file.name,
      () => '',
    );
    await openServerFile(server, target.id, name || 'file');
    return;
  }
  if (/^https?:/i.test(url)) {
    await WebBrowser.openBrowserAsync(url);
  } else {
    await Linking.openURL(url);
  }
}
