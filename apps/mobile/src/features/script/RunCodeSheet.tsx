import * as WebBrowser from 'expo-web-browser';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { fileNameOf, shareFile } from '@/features/settings/exportFile';
import { fonts, radius, usePalette } from '@/theme';

/** What the person chose for a tool's code. */
export type RunChoice = 'run' | 'skip' | 'always';

/**
 * Asked before a tool's JavaScript runs on this phone (Settings → Interface can say to run it
 * always, or never): what it is, the code itself, Run or Don't Run.
 */
export function RunCodeSheet({ code, onChoose }: { code: string; onChoose: (choice: RunChoice) => void }) {
  const palette = usePalette();
  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
        A tool wants to run code on this phone
      </Text>
      <Text style={[styles.note, { color: palette.textMuted }]}>
        It runs in a sealed page: it can’t see your sign-in, your chats or anything else in MavieChat, but it can reach the internet. What it gives back goes to the tool, and its reply waits for it.
      </Text>
      <ScrollView style={[styles.codeBox, { borderColor: palette.border, backgroundColor: palette.surface }]} contentContainerStyle={styles.codeContent}>
        <Text selectable style={[styles.code, { color: palette.text }]}>
          {code || '(no code)'}
        </Text>
      </ScrollView>
      <View style={styles.buttons}>
        <Button label="Run" onPress={() => onChoose('run')} />
        <Button label="Don’t Run" variant="secondary" onPress={() => onChoose('skip')} />
      </View>
      <Pressable accessibilityRole="button" onPress={() => onChoose('always')} hitSlop={6} style={styles.always}>
        <Text style={[styles.alwaysText, { color: palette.link }]}>Always Run Tools’ Code</Text>
        <Text style={[styles.small, { color: palette.textFaint }]}>Change it in Settings → Interface.</Text>
      </Pressable>
    </View>
  );
}

const EXTENSIONS: Record<string, string> = {
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'text/html': 'html',
  'application/json': 'json',
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
};

/** A file the code offers as a download, handed to the share sheet (Save to Files, AirDrop…). */
export function offerScriptFile(name: string, dataUrl: string): void {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return;
  const [, type = '', base64, body = ''] = match;
  let content: string | Uint8Array;
  try {
    content = base64 ? Uint8Array.from(atob(body), (char) => char.charCodeAt(0)) : decodeURIComponent(body);
  } catch {
    return;
  }
  const extension = EXTENSIONS[type.toLowerCase()];
  const base = fileNameOf(name, 'download');
  void shareFile(extension && !/\.[a-z0-9]{1,5}$/i.test(base) ? `${base}.${extension}` : base, content).catch(() => undefined);
}

/** A page the code opens: asked first, then shown in the in-app browser. */
export function offerScriptPage(url: string): void {
  Alert.alert('Open this page?', `A tool’s code wants to open:\n${url}`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Open', onPress: () => void WebBrowser.openBrowserAsync(url).catch(() => undefined) },
  ]);
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingTop: 20, paddingHorizontal: 20, gap: 12 },
  title: { fontFamily: fonts.semibold, fontSize: 18 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  codeBox: { flexGrow: 0, maxHeight: 320, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  codeContent: { padding: 10 },
  code: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18 },
  buttons: { gap: 10 },
  always: { alignSelf: 'center', alignItems: 'center', gap: 2, paddingVertical: 6 },
  alwaysText: { fontFamily: fonts.medium, fontSize: 14 },
  small: { fontFamily: fonts.regular, fontSize: 12 },
});
