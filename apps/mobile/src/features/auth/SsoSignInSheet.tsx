import { ssoStartUrl, ssoStepOf, ssoTokenOf, ssoTokenScript } from '@maviechat/owui-protocol';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { fonts, usePalette } from '@/theme';

/** A single sign-on to run: the server (its address as signed in to) and the provider. */
export interface SsoTarget {
  baseUrl: string;
  provider: { id: string; name: string };
}

const originOf = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

/**
 * Single sign-on in a private web view (nothing of it is kept once it closes): the server's start
 * page for the provider, the provider's own sign-in, then back on the server's /auth, where the
 * session the server leaves (its cookie, or after a second step on its own page, the page's
 * storage) is picked up and handed over. Pages of other sites never hand anything over. Google
 * refuses sign-in inside apps' web views, which the sheet says when Google's page shows.
 */
export function SsoSignInSheet({ target, onClose, onToken }: { target: SsoTarget | null; onClose: () => void; onToken: (baseUrl: string, token: string) => void }) {
  return (
    <Modal visible={target !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {target ? <SsoSignIn target={target} onClose={onClose} onToken={onToken} /> : null}
    </Modal>
  );
}

function SsoSignIn({ target, onClose, onToken }: { target: SsoTarget; onClose: () => void; onToken: (baseUrl: string, token: string) => void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const base = target.baseUrl.replace(/\/+$/, '');
  const origin = originOf(base);
  const script = ssoTokenScript(origin);
  // react-native-webview 14 types its component as WebView<P = undefined>; see learn/web.tsx.
  const webview = useRef<WebView<object>>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [secondStep, setSecondStep] = useState(false);
  const [atGoogle, setAtGoogle] = useState(false);
  const sawCallback = useRef(false);
  const done = useRef(false);
  const name = target.provider.name;

  const restart = () => {
    sawCallback.current = false;
    done.current = false;
    setFailure(null);
    setSecondStep(false);
    setAtGoogle(false);
    setLoading(true);
    setAttempt((value) => value + 1);
  };

  const stop = (text: string) => {
    if (done.current) return;
    done.current = true;
    setFailure(text);
  };

  // True while the page may load; the server's answer at the end stops it where there's nothing to pick up.
  const follow = (url: string): boolean => {
    const step = ssoStepOf(url, base, sawCallback.current);
    switch (step.kind) {
      case 'on-the-way':
        sawCallback.current = step.sawCallback;
        return true;
      case 'error':
        stop(`Signing in with ${name} didn’t work: ${step.text}`);
        return false;
      case 'pending':
        stop('Your account is waiting for an administrator to approve it. Try again once it has been approved.');
        return false;
      case 'elsewhere':
        stop(`The server sent the sign-in on to ${step.origin}, not ${origin}: its own address setting (WEBUI_URL) doesn’t match the one you use here. Ask its admin, or sign in another way.`);
        return false;
      case 'second-step':
        setSecondStep(true);
        return true;
      case 'back':
        // The page's script hands the session over.
        return true;
    }
  };

  const allowLoad = (url: string, topFrame: boolean): boolean => {
    if (done.current) return false;
    if (!topFrame || /^(about|blob|data):/i.test(url)) return true;
    // A sign-in page may hand over to an app (an authenticator, say).
    if (!/^https?:/i.test(url)) {
      void Linking.openURL(url).catch(() => undefined);
      return false;
    }
    return follow(url);
  };

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} style={styles.side}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={1} accessibilityRole="header">
          {`Sign in with ${name}`}
        </Text>
        <View style={[styles.side, styles.right]}>
          <IconButton icon="arrow-path" label="Start the sign-in again" size={20} color={palette.textMuted} onPress={restart} />
        </View>
      </View>
      {failure ? (
        <View style={styles.center}>
          <Text style={[styles.message, { color: palette.textMuted }]}>{failure}</Text>
          <View style={styles.buttons}>
            <Button label="Try Again" onPress={restart} />
            <Button label="Close" variant="secondary" onPress={onClose} />
          </View>
        </View>
      ) : (
        <View style={styles.body}>
          {secondStep ? <Text style={[styles.banner, { color: palette.text, backgroundColor: palette.surface }]}>The server asks for a second step: enter your code on its page below.</Text> : null}
          {atGoogle ? (
            <Text style={[styles.banner, { color: palette.text, backgroundColor: palette.surface }]}>
              If Google says this browser or app may not be secure, it’s refusing to sign in inside apps. Sign in with a password, or another way the server offers.
            </Text>
          ) : null}
          <WebView<object>
            key={attempt}
            ref={webview}
            source={{ uri: ssoStartUrl(base, target.provider.id) }}
            incognito
            originWhitelist={['*']}
            injectedJavaScript={script}
            onMessage={(event) => {
              if (done.current) return;
              // Only the server's own pages may hand a session over.
              if (originOf(event.nativeEvent.url) !== origin) return;
              const token = ssoTokenOf(event.nativeEvent.data);
              if (!token) return;
              done.current = true;
              onToken(base, token);
            }}
            onShouldStartLoadWithRequest={(request) => allowLoad(request.url, request.isTopFrame)}
            onNavigationStateChange={(navigation) => {
              setAtGoogle(originOf(navigation.url) === 'https://accounts.google.com');
              // Should the server's answer get past the check above, it ends the sign-in here.
              if (!done.current && /^https?:/i.test(navigation.url) && !follow(navigation.url)) webview.current?.stopLoading();
            }}
            onLoadEnd={() => setLoading(false)}
            onHttpError={(event) => {
              const { statusCode, url } = event.nativeEvent;
              // The provider's pages show their own errors; the server's mean it can't start or finish.
              if (originOf(url) !== origin) return;
              if (statusCode === 404) stop(`The server doesn’t offer sign-in with ${name} any more.`);
              else if (statusCode >= 400) stop(`The server couldn’t sign you in with ${name} (HTTP ${statusCode}).`);
            }}
            onError={(event) => stop(`Couldn’t open the sign-in page: ${event.nativeEvent.description || 'no connection'}.`)}
            onOpenWindow={(event) => {
              // A page meant for a new window (terms, help) opens in the browser; the sign-in stays here.
              const url = event.nativeEvent.targetUrl;
              if (/^https?:/i.test(url)) void WebBrowser.openBrowserAsync(url);
            }}
            style={[styles.web, { backgroundColor: palette.background }]}
          />
          {loading ? <ActivityIndicator style={StyleSheet.absoluteFill} color={palette.textMuted} /> : null}
        </View>
      )}
      <Text style={[styles.note, { color: palette.textFaint, paddingBottom: Math.max(insets.bottom, 12) }]}>
        A private window: once you’re signed in, MavieChat keeps only your session with the server, as with a password.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  side: { minWidth: 64 },
  right: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.semibold, fontSize: 15 },
  body: { flex: 1 },
  web: { flex: 1 },
  banner: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingVertical: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  message: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  buttons: { alignSelf: 'stretch', gap: 10 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, paddingHorizontal: 16, paddingTop: 8 },
});
