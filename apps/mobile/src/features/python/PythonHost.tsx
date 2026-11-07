import { pyodideIndexUrl } from '@maviechat/owui-protocol';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { PythonRunner } from './runner';
import { pythonPage } from './runnerPage';

/**
 * The hidden web view `runner` runs Python in, shown only while it's wanted: sandboxed like the
 * app's other generated pages (nothing shared with the app, no navigation), with Python loaded
 * from the Open WebUI server's own copy of Pyodide.
 */
export function PythonHost({ runner, baseUrl }: { runner: PythonRunner; baseUrl: string }) {
  const generation = useSyncExternalStore(runner.subscribe, runner.getGeneration);
  const html = useMemo(() => (generation ? pythonPage(pyodideIndexUrl(baseUrl), generation) : ''), [baseUrl, generation]);
  const attach = useCallback(
    (view: WebView<object> | null) => {
      runner.attach(view ? (script) => view.injectJavaScript(script) : null);
    },
    [runner],
  );
  if (!generation) return null;
  return (
    <View pointerEvents="none" style={styles.hidden} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView<object>
        key={generation}
        ref={attach}
        source={{ html }}
        originWhitelist={['*']}
        incognito
        javaScriptEnabled
        onMessage={(event) => runner.receive(event.nativeEvent.data)}
        onContentProcessDidTerminate={() => runner.ended()}
        onRenderProcessGone={() => runner.ended()}
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank' || !request.isTopFrame}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // On screen (a web view off screen may be slowed down), but a single invisible point.
  hidden: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0.01, overflow: 'hidden' },
});
