import { uiValue, withCsp, type Artifact } from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useServerConfig, useUserSettings } from '@/lib/server';
import { previewPage } from '@/markdown/webPages';
import { WebFrame } from '@/markdown/WebFrame';
import { fonts, usePalette } from '@/theme';

/**
 * The chat's artifacts, as the web shows them beside a chat: each page or SVG made from the
 * replies on the shown branch, one version at a time, with Copy and Download. Pages run in the
 * app's sandboxed web view under the admin's Content Security Policy, with scripts as your
 * settings allow ("allow scripts", on unless you turned it off on the web).
 */
export function ArtifactsSheet({ artifacts, start, chatId, onClose }: { artifacts: Artifact[]; start: number | null; chatId: string; onClose: () => void }) {
  const palette = usePalette();
  return (
    <Modal visible={start !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {start !== null ? <Viewer key={start} artifacts={artifacts} start={start} chatId={chatId} onClose={onClose} /> : <View style={{ backgroundColor: palette.background }} />}
    </Modal>
  );
}

function Viewer({ artifacts, start, chatId, onClose }: { artifacts: Artifact[]; start: number; chatId: string; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const dark = useColorScheme() === 'dark';
  const config = useServerConfig();
  const settings = useUserSettings();
  const [index, setIndex] = useState(Math.min(Math.max(start, 0), Math.max(artifacts.length - 1, 0)));
  const artifact = artifacts[index];
  const csp = (config.data?.ui as { iframe_csp?: unknown } | undefined)?.iframe_csp;
  const scripts = uiValue(settings.data?.ui, 'iframeSandboxAllowScripts') !== false;
  const page = artifact ? (artifact.kind === 'svg' ? previewPage(artifact.content, dark) : withCsp(artifact.content, typeof csp === 'string' ? csp : null)) : null;

  const copy = async () => {
    if (!artifact) return;
    await Clipboard.setStringAsync(artifact.content);
    toast('Copied');
  };
  // As the web names it: artifact-<chat>-<version>.html (an SVG keeps its own kind).
  const download = async () => {
    if (!artifact) return;
    try {
      const file = new File(Paths.cache, `artifact-${chatId}-${index}.${artifact.kind === 'svg' ? 'svg' : 'html'}`);
      file.create({ overwrite: true });
      await file.write(artifact.content);
      await Share.share({ url: file.uri });
    } catch (error) {
      toast(`Couldn’t save it: ${describeError(error)}`, 'error');
    }
  };

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} style={styles.side}>
          <Text style={[styles.action, { color: palette.link }]}>Done</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Artifacts
        </Text>
        <View style={[styles.side, styles.tools]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Copy" onPress={() => void copy()} hitSlop={8} disabled={!artifact}>
            <Icon name="clipboard-document" size={20} color={palette.text} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Download" onPress={() => void download()} hitSlop={8} disabled={!artifact}>
            <Icon name="arrow-down-tray" size={20} color={palette.text} />
          </Pressable>
        </View>
      </View>
      {artifacts.length > 1 ? (
        <View style={styles.versions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous version" onPress={() => setIndex(Math.max(index - 1, 0))} disabled={index === 0} hitSlop={10}>
            <Icon name="chevron-left" size={18} color={index === 0 ? palette.textFaint : palette.text} />
          </Pressable>
          <Text style={[styles.version, { color: palette.textMuted }]}>{`Version ${index + 1} of ${artifacts.length}`}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next version"
            onPress={() => setIndex(Math.min(index + 1, artifacts.length - 1))}
            disabled={index === artifacts.length - 1}
            hitSlop={10}>
            <Icon name="chevron-right" size={18} color={index === artifacts.length - 1 ? palette.textFaint : palette.text} />
          </Pressable>
        </View>
      ) : null}
      {page ? (
        <WebFrame key={index} html={page} fill javaScript={artifact?.kind === 'svg' ? false : scripts} />
      ) : (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: palette.textMuted }]}>No HTML, CSS, or JavaScript content found.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  side: { width: 72 },
  tools: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16 },
  versions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingBottom: 8 },
  version: { fontFamily: fonts.medium, fontSize: 13 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { fontFamily: fonts.regular, fontSize: 15, textAlign: 'center' },
});
