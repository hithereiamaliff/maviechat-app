import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { radius, usePalette } from '@/theme';

interface WebFrameProps {
  /** The page, or (with `uri`) nothing. */
  html?: string;
  /** A page's address to load instead (a tool's embed). */
  uri?: string;
  /** Before the page reports its height. */
  initialHeight?: number;
  maxHeight?: number;
  /** A full-screen preview scrolls inside; inline frames grow to fit instead. */
  fill?: boolean;
  /** Scripts run (the default); an artifact follows the web's "allow scripts" setting. */
  javaScript?: boolean;
  /** Script run before the page's own (a tool embed's `window.args`). */
  beforeLoad?: string;
  /** For pages the app didn't write: their height is measured, and their messages to the chat passed on. */
  measure?: boolean;
  /** What such a page asks of the chat (`input:prompt`, …), as posted; untrusted. */
  onPageMessage?: (message: Record<string, unknown>) => void;
}

/**
 * For pages the app didn't write: tells the app the page's height, and passes on the messages a
 * page meant for Open WebUI posts to its parent (here the page itself): its height, and prompts.
 */
const MEASURE_SCRIPT = `(function(){
  var post = function (message) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message)); };
  var size = function () { post({ height: Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)) }); };
  window.addEventListener('load', function () { size(); setTimeout(size, 400); setTimeout(size, 1500); });
  if (window.ResizeObserver && document.body) new ResizeObserver(size).observe(document.body);
  size();
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'iframe:height' && typeof data.height === 'number') post({ height: data.height });
    else if (data.type === 'input:prompt' || data.type === 'input:prompt:submit' || data.type === 'action:submit') post({ page: { type: data.type, text: typeof data.text === 'string' ? data.text : '' } });
  });
})();
true;`;

/**
 * A sandboxed web view for a generated page (a chart, a diagram, an HTML preview, a tool's
 * content): no cookies or storage shared with the app, links open in the browser, and inline
 * frames take the height the page reports.
 */
export function WebFrame({ html, uri, initialHeight = 240, maxHeight = 900, fill = false, javaScript = true, beforeLoad, measure = false, onPageMessage }: WebFrameProps) {
  const palette = usePalette();
  const [height, setHeight] = useState(initialHeight);
  // An address may redirect while it first loads; after that, links go to the browser.
  const loaded = useRef(false);
  return (
    <View style={[fill ? styles.fill : [styles.frame, { height, borderColor: palette.border }]]}>
      <WebView<object>
        source={uri ? { uri } : { html: html ?? '' }}
        originWhitelist={['*']}
        incognito
        scrollEnabled={fill}
        javaScriptEnabled={javaScript}
        injectedJavaScriptBeforeContentLoaded={beforeLoad}
        injectedJavaScript={measure ? MEASURE_SCRIPT : undefined}
        onLoadEnd={() => {
          loaded.current = true;
        }}
        onMessage={(event) => {
          let message: unknown;
          try {
            message = JSON.parse(event.nativeEvent.data);
          } catch {
            return;
          }
          if (!message || typeof message !== 'object') return;
          const { height: reported, page } = message as { height?: unknown; page?: unknown };
          if (reported !== undefined) {
            const next = Number(reported);
            if (!fill && Number.isFinite(next)) setHeight(Math.min(maxHeight, Math.max(80, next)));
          } else if (page && typeof page === 'object') {
            onPageMessage?.(page as Record<string, unknown>);
          }
        }}
        onShouldStartLoadWithRequest={(request) => {
          if (request.url === 'about:blank' || !request.isTopFrame) return true;
          if (uri && !loaded.current && /^https?:/i.test(request.url)) return true;
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
