import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { radius, usePalette } from '@/theme';

interface WebFrameProps {
  html: string;
  /** Before the page reports its height. */
  initialHeight?: number;
  maxHeight?: number;
  /** A full-screen preview scrolls inside; inline frames grow to fit instead. */
  fill?: boolean;
  /** Scripts run (the default); an artifact follows the web's "allow scripts" setting. */
  javaScript?: boolean;
}

/**
 * A sandboxed web view for a generated page (a chart, a diagram, an HTML preview): no cookies or
 * storage shared with the app, links open in the browser, and inline frames take the height
 * the page reports.
 */
export function WebFrame({ html, initialHeight = 240, maxHeight = 900, fill = false, javaScript = true }: WebFrameProps) {
  const palette = usePalette();
  const [height, setHeight] = useState(initialHeight);
  return (
    <View style={[fill ? styles.fill : [styles.frame, { height, borderColor: palette.border }]]}>
      <WebView<object>
        source={{ html }}
        originWhitelist={['*']}
        incognito
        scrollEnabled={fill}
        javaScriptEnabled={javaScript}
        onMessage={(event) => {
          if (fill) return;
          try {
            const next = Number((JSON.parse(event.nativeEvent.data) as { height?: unknown }).height);
            if (Number.isFinite(next)) setHeight(Math.min(maxHeight, Math.max(80, next)));
          } catch {
            // not a size message
          }
        }}
        onShouldStartLoadWithRequest={(request) => {
          if (request.url === 'about:blank' || !request.isTopFrame) return true;
          if (/^https?:/i.test(request.url)) void WebBrowser.openBrowserAsync(request.url);
          return false;
        }}
        style={{ backgroundColor: palette.background }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  fill: { flex: 1 },
});
