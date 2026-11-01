import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { MenuButton } from '@/components/Menu';
import { hostOf } from '@/features/deeptutor/crossReference';
import { SpaceHeader } from '@/features/deeptutor/SpaceHeader';
import { switchToOpenWebUI } from '@/features/deeptutor/switch';
import { isLoginPage, SIGN_OUT_SCRIPT, signInScript } from '@/features/deeptutor/webSignIn';
import { useDeepTutor, useDtAuthed } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { saveSpace } from '@/session/storage';
import { fonts, usePalette } from '@/theme';

/**
 * The DeepTutor space: DeepTutor's own web app, signed in, under a slim native bar for
 * switching back to Open WebUI. The sign-in comes from iOS's shared cookie store, which
 * the app's own sign-in filled; failing that, from the stored token (once per visit).
 */
export default function DeepTutorSpace() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { session } = useDtAuthed();
  const { signOut } = useDeepTutor();
  const owui = useSession();
  const owuiSignedIn = owui.state.status === 'signed-in';
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

  const confirmSignOut = () =>
    Alert.alert('Sign out of DeepTutor?', 'Your Open WebUI sign-in stays as it is.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          // The web view keeps its own cookie, so it signs out too.
          webview.current?.injectJavaScript(SIGN_OUT_SCRIPT);
          void signOut().then(() => {
            void saveSpace('owui');
            router.replace(owuiSignedIn ? '/' : '/deeptutor-login');
          });
        },
      },
    ]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <SpaceHeader
        leading={owuiSignedIn ? <IconButton icon="arrows-right-left" label="Switch to Open WebUI" onPress={switchToOpenWebUI} /> : null}
        title="DeepTutor"
        subtitle={`${session.account.username} · ${hostOf(session.baseUrl)}`}
        trailing={
          <MenuButton
            label="DeepTutor options"
            items={[
              { key: 'chats', label: 'Chats for Open WebUI', icon: 'chat-bubble-left', onPress: () => router.push('/learn/chats') },
              { key: 'reload', label: 'Reload', icon: 'arrow-path', onPress: () => webview.current?.reload() },
              { key: 'browser', label: 'Open in Browser', icon: 'globe-alt', onPress: () => void WebBrowser.openBrowserAsync(currentUrl.current) },
              ...(owuiSignedIn ? [{ key: 'switch', label: 'Switch to Open WebUI', icon: 'arrows-right-left' as const, onPress: switchToOpenWebUI }] : []),
              { key: 'signout', label: 'Sign out of DeepTutor', icon: 'arrow-right-start-on-rectangle', destructive: true, onPress: confirmSignOut },
            ]}
          />
        }
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
          source={{ uri: `${session.baseUrl}/chat` }}
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
