import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { Button } from '@/components/Button';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { isLoginPage, registerWebView, SIGN_OUT_SCRIPT, signInScript } from '@/features/deeptutor/webSignIn';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

/** A DeepTutor page path from the route, e.g. `/chat/<session id>`; DeepTutor's chat page otherwise. */
function pagePath(value: string | string[] | undefined): string {
  const path = Array.isArray(value) ? value[0] : value;
  return path && path.startsWith('/') && !path.startsWith('//') ? path : '/chat';
}

/**
 * DeepTutor's own web pages, signed in, for the sections the app doesn't show natively yet
 * (opened from the sidebar, under the same bar as every other screen). The sign-in comes from
 * iOS's shared cookie store, which the app's own sign-in filled; failing that, from the stored
 * token (once per visit).
 */
export default function DeepTutorWeb() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ path?: string; title?: string }>();
  const { session } = useDtAuthed();
  // react-native-webview 14 types its component as WebView<P = undefined>, and `props & undefined`
  // is `never` under TypeScript 6, so the type argument is given explicitly.
  const webview = useRef<WebView<object>>(null);
  const signedInHere = useRef(false);
  const currentUrl = useRef(session.baseUrl);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const onNavigation = (navigation: WebViewNavigation) => {
    currentUrl.current = navigation.url;
    if (signedInHere.current || navigation.loading || !isLoginPage(navigation.url, session.baseUrl)) return;
    const script = session.token ? signInScript(session.token, session.expiresAt, navigation.url, Date.now()) : null;
    if (!script) return;
    signedInHere.current = true;
    webview.current?.injectJavaScript(script);
  };

  // DeepTutor's own pages load here; links to other sites open in the browser, other schemes in their apps.
  const allowLoad = (url: string, topFrame: boolean): boolean => {
    if (!topFrame || url.startsWith(`${session.baseUrl}/`) || url === session.baseUrl || /^(about|blob|data):/i.test(url)) return true;
    if (/^https?:/i.test(url)) void WebBrowser.openBrowserAsync(url);
    else void Linking.openURL(url).catch(() => undefined);
    return false;
  };

  // The web view keeps its own cookie, so signing out from the sidebar signs it out too.
  useEffect(() => {
    registerWebView({ signOut: () => webview.current?.injectJavaScript(SIGN_OUT_SCRIPT) });
    return () => registerWebView(null);
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader
        title={typeof params.title === 'string' && params.title ? params.title : 'DeepTutor'}
        menuLabel="Page options"
        menu={[
          { key: 'reload', label: 'Reload', icon: 'arrow-path', onPress: () => webview.current?.reload() },
          { key: 'browser', label: 'Open in Browser', icon: 'globe-alt', onPress: () => void WebBrowser.openBrowserAsync(currentUrl.current) },
        ]}
      />
      {failure ? (
        <View style={styles.center}>
          <Text style={[styles.message, { color: palette.textMuted }]}>{failure}</Text>
          <View style={styles.retry}>
            <Button
              label="Try Again"
              onPress={() => {
                setFailure(null);
                setAttempt((value) => value + 1);
              }}
            />
          </View>
        </View>
      ) : (
        <WebView<object>
          key={attempt}
          ref={webview}
          source={{ uri: `${session.baseUrl}${pagePath(params.path)}` }}
          sharedCookiesEnabled
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="prompt"
          applicationNameForUserAgent="MavieChat"
          startInLoadingState
          renderLoading={() => <ActivityIndicator style={StyleSheet.absoluteFill} color={palette.textMuted} />}
          onNavigationStateChange={onNavigation}
          onShouldStartLoadWithRequest={(request) => allowLoad(request.url, request.isTopFrame)}
          onOpenWindow={(event) => allowLoad(event.nativeEvent.targetUrl, true) && webview.current?.injectJavaScript(`window.location.assign(${JSON.stringify(event.nativeEvent.targetUrl)}); true;`)}
          onContentProcessDidTerminate={() => webview.current?.reload()}
          onError={(event) => setFailure(`Couldn't open DeepTutor: ${event.nativeEvent.description || 'no connection'}.`)}
          onHttpError={(event) => {
            if (event.nativeEvent.statusCode >= 500 && event.nativeEvent.url.startsWith(session.baseUrl)) {
              setFailure(`DeepTutor isn't answering right now (HTTP ${event.nativeEvent.statusCode}).`);
            }
          }}
          style={[styles.web, { backgroundColor: palette.background }]}
          containerStyle={{ paddingBottom: insets.bottom }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  web: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  message: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  retry: { alignSelf: 'stretch' },
});
