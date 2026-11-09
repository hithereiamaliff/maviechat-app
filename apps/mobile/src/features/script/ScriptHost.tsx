import { toolScriptPage } from '@maviechat/owui-protocol';
import { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { ScriptRunner } from './runner';

/**
 * The hidden page a tool's JavaScript runs in, for the current run only: a fresh web view each
 * time, private (nothing shared with the app's other pages), no camera or microphone, no other
 * windows, and no navigation (a page it tries to go to is offered to the person instead).
 */
export function ScriptHost({ runner }: { runner: ScriptRunner }) {
  const current = useSyncExternalStore(runner.subscribe, runner.getCurrent);
  if (!current) return null;
  return (
    <View pointerEvents="none" style={styles.hidden} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView<object>
        key={current.run}
        source={{ html: toolScriptPage(current.code, current.run) }}
        originWhitelist={['*']}
        incognito
        javaScriptEnabled
        cacheEnabled={false}
        mediaCapturePermissionGrantType="deny"
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        geolocationEnabled={false}
        onMessage={(event) => runner.receive(event.nativeEvent.data)}
        onContentProcessDidTerminate={() => runner.ended()}
        onRenderProcessGone={() => runner.ended()}
        onShouldStartLoadWithRequest={(request) => {
          if (request.url === 'about:blank') return true;
          if (request.isTopFrame) runner.navigate(request.url);
          return false;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // On screen (a web view off screen may be slowed down), but a single invisible point.
  hidden: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0.01, overflow: 'hidden' },
});
