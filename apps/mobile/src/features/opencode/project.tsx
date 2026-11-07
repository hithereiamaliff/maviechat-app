import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { useOcAuthed } from '@/session/OpenCodeProvider';
import { fonts, radius, usePalette } from '@/theme';
import { folderName, useMachine, useOcProjects, useSubfolders } from './queries';

const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const projectKey = (accountId: string) => `maviechat.opencode.project.${accountId}`;

interface ProjectValue {
  /** The project folder the sidebar and new sessions use; null until one is picked. */
  directory: string | null;
  ready: boolean;
  setDirectory: (directory: string) => void;
}

const ProjectContext = createContext<ProjectValue | null>(null);

/** The project folder in use for the OpenCode account, remembered per account. */
export function OcProjectProvider({ children }: { children: ReactNode }) {
  const { accountId } = useOcAuthed();
  const [state, setState] = useState<{ directory: string | null; ready: boolean }>({ directory: null, ready: false });
  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(projectKey(accountId), options)
      .then((directory) => {
        if (!cancelled) setState({ directory, ready: true });
      })
      .catch(() => {
        if (!cancelled) setState({ directory: null, ready: true });
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);
  const setDirectory = useCallback(
    (directory: string) => {
      setState({ directory, ready: true });
      void SecureStore.setItemAsync(projectKey(accountId), directory, options).catch(() => undefined);
    },
    [accountId],
  );
  return <ProjectContext.Provider value={{ ...state, setDirectory }}>{children}</ProjectContext.Provider>;
}

export function useOcProject(): ProjectValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error('useOcProject outside the OpenCode space');
  return value;
}

/** Picking a project: recent ones, or any folder inside those the machine allows. */
export function useProjectPicker() {
  const [visible, setVisible] = useState(false);
  const element = (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVisible(false)}>
      {visible ? <ProjectBrowser onClose={() => setVisible(false)} /> : null}
    </Modal>
  );
  return { open: () => setVisible(true), element };
}

function ProjectBrowser({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const project = useOcProject();
  const machine = useMachine();
  const folders = machine.data?.folders;
  const recent = useOcProjects(folders);
  // Where you are while browsing: null shows the allowed folders and recent projects.
  const [path, setPath] = useState<string | null>(null);
  const subfolders = useSubfolders(path);

  const choose = (directory: string) => {
    project.setDirectory(directory);
    onClose();
  };

  const row = (key: string, label: string, detail: string | null, icon: 'folder' | 'folder-open' | 'clock', onPress: () => void, trailing?: ReactNode) => (
    <Pressable key={key} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, { borderBottomColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
      <Icon name={icon} size={20} color={palette.textMuted} />
      <View style={styles.text}>
        <Text style={[styles.label, { color: palette.text }]} numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Text style={[styles.detail, { color: palette.textMuted }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background, paddingBottom: insets.bottom + 12 }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        {path ? <IconButton icon="chevron-left" label="Back" onPress={() => setPath(parentWithin(path, folders ?? []))} /> : <View style={styles.spacer} />}
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
          {path ? folderName(path) : 'Choose a Project'}
        </Text>
        <IconButton icon="x-mark" label="Close" onPress={onClose} />
      </View>
      {path ? (
        <Pressable accessibilityRole="button" onPress={() => choose(path)} style={[styles.use, { backgroundColor: palette.text }]}>
          <Text style={[styles.useText, { color: palette.background }]}>Use This Folder</Text>
        </Pressable>
      ) : null}
      <ScrollView>
        {path === null ? (
          <>
            {(recent.data ?? []).length > 0 ? <Text style={[styles.section, { color: palette.textMuted }]}>Recent projects</Text> : null}
            {(recent.data ?? []).map((item) => row(item.id, item.name || folderName(item.worktree), item.worktree, 'clock', () => choose(item.worktree)))}
            <Text style={[styles.section, { color: palette.textMuted }]}>Folders on {machine.data?.name ?? 'this machine'}</Text>
            {machine.isLoading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
            {(folders ?? []).map((folder) => row(folder, folderName(folder), folder, 'folder', () => setPath(folder), <Icon name="chevron-right" size={16} color={palette.textFaint} />))}
          </>
        ) : (
          <>
            {subfolders.isLoading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
            {subfolders.isError ? <Text style={[styles.note, { color: palette.danger }]}>Couldn’t list this folder.</Text> : null}
            {subfolders.data?.length === 0 ? <Text style={[styles.note, { color: palette.textMuted }]}>No folders inside. Use this one, or go back.</Text> : null}
            {(subfolders.data ?? []).map((node) =>
              row(node.absolute, node.name, null, project.directory === node.absolute ? 'folder-open' : 'folder', () => setPath(node.absolute), <Icon name="chevron-right" size={16} color={palette.textFaint} />),
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** One level up, without leaving the allowed folders (null: back to the start). */
function parentWithin(path: string, folders: string[]): string | null {
  if (folders.includes(path)) return null;
  const parent = path.replace(/\/[^/]+\/?$/, '') || '/';
  return folders.some((folder) => parent === folder || parent.startsWith(`${folder}/`)) ? parent : null;
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  spacer: { width: 40 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 17, textAlign: 'center' },
  use: { margin: 16, marginBottom: 4, minHeight: 44, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  useText: { fontFamily: fonts.medium, fontSize: 15 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginTop: 18, marginBottom: 6, marginHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  text: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.medium, fontSize: 15 },
  detail: { fontFamily: fonts.regular, fontSize: 12 },
  loading: { marginTop: 24 },
  note: { fontFamily: fonts.regular, fontSize: 14, margin: 16 },
});
