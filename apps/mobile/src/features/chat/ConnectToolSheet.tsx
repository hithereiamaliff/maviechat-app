import { disconnectOAuthTool, oauthAuthorizePath, oauthReturn, type OAuthTool, type ToolItem } from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, usePalette } from '@/theme';

/**
 * Connecting a tool that signs in to its own service (the web's "Click to connect"): its sign-in
 * page in a private browser sheet. Once connected, `onConnected` switches the tool on.
 */
export function useConnectTool(onConnected?: (toolId: string) => void) {
  const [tool, setTool] = useState<OAuthTool | null>(null);
  const element = (
    <Modal visible={tool !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setTool(null)}>
      {tool ? (
        <ConnectTool
          tool={tool}
          onClose={(connected) => {
            setTool(null);
            if (connected) onConnected?.(tool.id);
          }}
        />
      ) : null}
    </Modal>
  );
  return { connect: (next: OAuthTool) => setTool(next), element };
}

/** Disconnects a tool's sign-in (the web's "Disconnect OAuth"), after asking. */
export function useDisconnectTool(onDisconnected?: (toolId: string) => void) {
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const toast = useToast();
  const disconnect = async (tool: OAuthTool) => {
    try {
      await disconnectOAuthTool(client, tool);
      onDisconnected?.(tool.id);
      toast(`${tool.name} disconnected`);
    } catch (error) {
      toast(`Couldn’t disconnect ${tool.name}: ${describeError(error)}`, 'error');
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['tools'] });
    }
  };
  return (tool: OAuthTool) =>
    Alert.alert(`Disconnect ${tool.name}?`, 'To use it again, you’ll sign in to it again, here or on the web.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => void disconnect(tool) },
    ]);
}

/** Why the server turned the sign-in away, in words. */
function refusal(status: number, name: string): string {
  if (status === 401) return `The server didn’t accept your sign-in (HTTP 401). Sign out of MavieChat and back in, then try again.`;
  if (status === 403) return `This server doesn’t let you connect ${name} (HTTP 403).`;
  if (status === 404) return `The server has no sign-in set up for ${name} (HTTP 404). An admin can check the tool’s settings on the web.`;
  return `The server couldn’t start the sign-in for ${name} (HTTP ${status}). Try again later.`;
}

const hostOf = (url: string): string => url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');

/**
 * The sign-in, in a private browser that forgets everything when it closes. Your Open WebUI
 * sign-in goes only to your server: the first page is your server's own account page, asked
 * with your sign-in, which keeps it as this browser's cookie (as the web app has it). Then the
 * server's page for the tool sends you on to the tool's service; when you've signed in there,
 * the service sends you back to the server, which keeps the tool's sign-in for your account and
 * sends you to its start page. That page isn't opened: it marks the end, with the server's error
 * if any.
 */
function ConnectTool({ tool, onClose }: { tool: OAuthTool; onClose: (connected: boolean) => void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { session } = useAuthed();
  const base = session.baseUrl.replace(/\/+$/, '');
  const token = session.token;
  const onServer = (url: string) => url === base || url.startsWith(`${base}/`);
  const accountUrl = `${base}/api/v1/auths/`;
  // react-native-webview 14 types its component as WebView<P = undefined>; see learn/web.tsx.
  const webview = useRef<WebView<object>>(null);
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState<'account' | 'sign-in'>('account');
  // Hidden until the tool's sign-in shows: the account page holds your sign-in.
  const [shown, setShown] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const sawCallback = useRef(false);
  const done = useRef(false);
  const source = useMemo(
    () => (step === 'account' ? { uri: accountUrl, headers: { Authorization: `Bearer ${token}` } } : { uri: `${base}${oauthAuthorizePath(tool.clientId)}` }),
    [step, accountUrl, base, token, tool.clientId],
  );

  const restart = () => {
    sawCallback.current = false;
    done.current = false;
    setFailure(null);
    setFinishing(false);
    setShown(false);
    setStep('account');
    setAttempt((value) => value + 1);
  };

  const finish = async (error: string | null) => {
    if (done.current) return;
    done.current = true;
    setFinishing(true);
    await queryClient.invalidateQueries({ queryKey: ['tools'] });
    setFinishing(false);
    const now = queryClient.getQueryData<ToolItem[]>(['tools'])?.find((item) => item.id === tool.id);
    if (error) {
      setFailure(`${tool.name} didn’t connect: ${error}`);
    } else if (now?.authenticated === false) {
      setFailure(`The server didn’t keep the sign-in for ${tool.name}. Try again.`);
    } else {
      toast(`${tool.name} connected`, 'success');
      onClose(true);
    }
  };

  // True while the page may load; the page after the server's callback ends it instead.
  const follow = (url: string): boolean => {
    const next = oauthReturn(url, tool.clientId, sawCallback.current);
    if (next.kind === 'waiting') {
      sawCallback.current = next.sawCallback;
      return true;
    }
    void finish(next.error);
    return false;
  };

  const allowLoad = (url: string, topFrame: boolean): boolean => {
    if (done.current) return false;
    if (!topFrame || /^(about|blob|data):/i.test(url)) return true;
    // The account page is only the first step; it doesn't come back (it holds your sign-in).
    if (step === 'sign-in' && url.startsWith(accountUrl)) return false;
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
        <Pressable accessibilityRole="button" onPress={() => onClose(false)} hitSlop={10} style={styles.side}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={1} accessibilityRole="header">
          {`Connect ${tool.name}`}
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
            <Button label="Close" variant="secondary" onPress={() => onClose(false)} />
          </View>
        </View>
      ) : (
        <View style={styles.body} accessibilityElementsHidden={!shown} importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}>
          <WebView<object>
            key={attempt}
            ref={webview}
            source={source}
            incognito
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={(request) => allowLoad(request.url, request.isTopFrame)}
            onNavigationStateChange={(navigation) => {
              // Should a page after the callback get past the check above, it ends the sign-in here.
              if (!done.current && /^https?:/i.test(navigation.url) && !follow(navigation.url)) webview.current?.stopLoading();
            }}
            onLoadEnd={(event) => {
              if (done.current) return;
              if (step === 'account') setStep('sign-in');
              else if (!event.nativeEvent.url.startsWith(accountUrl)) setShown(true);
            }}
            onHttpError={(event) => {
              const { statusCode, url } = event.nativeEvent;
              // The service's own pages show their own errors.
              if (!done.current && onServer(url)) setFailure(refusal(statusCode, tool.name));
            }}
            onError={(event) => {
              if (!done.current) setFailure(`Couldn’t open the sign-in page: ${event.nativeEvent.description || 'no connection'}.`);
            }}
            onOpenWindow={(event) => {
              // A page meant for a new window (terms, help) opens in the browser; the sign-in stays here.
              const url = event.nativeEvent.targetUrl;
              if (/^https?:/i.test(url)) void WebBrowser.openBrowserAsync(url);
            }}
            style={[styles.web, { backgroundColor: palette.background, opacity: shown ? 1 : 0 }]}
          />
          {!shown || finishing ? <ActivityIndicator style={StyleSheet.absoluteFill} color={palette.textMuted} /> : null}
        </View>
      )}
      <Text style={[styles.note, { color: palette.textFaint, paddingBottom: Math.max(insets.bottom, 12) }]}>
        {`This connects ${tool.name} for your account, on the web too. If its sign-in page won’t work here, connect it on the web at ${hostOf(base)}.`}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 },
  message: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  buttons: { alignSelf: 'stretch', gap: 10 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, paddingHorizontal: 16, paddingTop: 8 },
});
