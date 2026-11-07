import { createKnowledgeBase, kbNameProblem, providerAccepts, ragPreflight, type DtRagProvider } from '@maviechat/deeptutor-protocol';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useDtRagProviders } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';
import { fileSize } from './status';
import { PHONE_UPLOAD_MAX_BYTES, uploadPart } from '@/lib/uploadPart';

/** A document picked on the phone, sent as React Native's file part. */
export interface PickedDocument {
  uri: string;
  name: string;
  type: string;
  size: number | null;
}

/** Picks documents, keeping only what the engine takes; says what was left out. */
export async function pickDocuments(provider: string, toast: (message: string, tone?: 'error' | 'success') => void): Promise<PickedDocument[]> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  const picked = result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/octet-stream', size: asset.size ?? null }));
  const kept = picked.filter((file) => providerAccepts(provider, file.name));
  if (kept.length < picked.length) toast(provider === 'pageindex-oss' ? 'PageIndex OSS takes PDF files only; the others were left out.' : 'Some files are not a type this engine takes; they were left out.', 'error');
  const small = kept.filter((file) => (file.size ?? 0) <= PHONE_UPLOAD_MAX_BYTES);
  if (small.length < kept.length) toast('Files over 100 MB were left out: add them from DeepTutor’s web app.', 'error');
  return small;
}

/** A picked document as an upload part the app's fetch can send. */
export const filePart = (file: PickedDocument) => uploadPart({ uri: file.uri, name: file.name, type: file.type });

interface CreateKbSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The new knowledge base's name, once DeepTutor has it. */
  onCreated: (name: string) => void;
}

/**
 * A new knowledge base: a name, an engine (each checked with DeepTutor: one that isn't ready says
 * what it needs), PageIndex's mode, and documents to start with.
 */
export function CreateKbSheet({ visible, onClose, onCreated }: CreateKbSheetProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <CreateBody onClose={onClose} onCreated={onCreated} /> : null}
    </Modal>
  );
}

function CreateBody({ onClose, onCreated }: Omit<CreateKbSheetProps, 'visible'>) {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const providers = useDtRagProviders(true);
  // Engines a phone can set up: installed, and needing no outside server or account.
  const usable = (providers.data ?? []).filter((provider) => provider.configured && !provider.needsSetup);
  const checks = useQueries({
    queries: usable.map((provider) => ({
      queryKey: [DT_QUERY_ROOT, session.baseUrl, 'rag-preflight', provider.id],
      queryFn: () => ragPreflight(client, provider.id),
      staleTime: 30_000,
    })),
  });
  // A check that couldn't be read counts as not ready, with the reason.
  const readiness = (provider: DtRagProvider) => {
    const check = checks[usable.indexOf(provider)];
    return check?.data ?? (check?.isError ? { ok: false, missing: [`Couldn't check it: ${describeError(check.error)}`] } : undefined);
  };
  const firstReady = usable.find((provider) => readiness(provider)?.ok);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const engine = picked ?? firstReady?.id ?? null;
  const [mode, setMode] = useState<'flash' | 'standard'>('flash');
  const [files, setFiles] = useState<PickedDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const problem = kbNameProblem(name);

  const choose = (provider: DtRagProvider) => {
    setPicked(provider.id);
    // Files the new engine can't take are dropped.
    setFiles((current) => current.filter((file) => providerAccepts(provider.id, file.name)));
  };

  const create = async () => {
    setTouched(true);
    if (problem || !engine) return;
    setBusy(true);
    try {
      await createKnowledgeBase(client, { name, provider: engine, pageindexMode: engine.startsWith('pageindex') ? mode : undefined, files: files.map(filePart) });
      void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'knowledge-bases'] });
      onCreated(name.trim());
    } catch (error) {
      toast(`Couldn't create it: ${describeError(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={[styles.link, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          New Knowledge Base
        </Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: palette.textMuted }]}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          onBlur={() => setTouched(true)}
          placeholder="e.g. Biology notes"
          placeholderTextColor={palette.textFaint}
          autoFocus
          style={[styles.input, { color: palette.text, borderColor: touched && problem ? palette.danger : palette.border, backgroundColor: palette.surface }]}
        />
        {touched && problem ? <Text style={[styles.note, { color: palette.danger }]}>{problem}</Text> : null}

        <Text style={[styles.label, { color: palette.textMuted }]}>Engine</Text>
        {providers.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
        {usable.map((provider) => {
          const check = readiness(provider);
          const ready = check?.ok === true;
          const selected = provider.id === engine;
          return (
            <Pressable
              key={provider.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: !ready }}
              disabled={!ready}
              onPress={() => choose(provider)}
              style={[styles.engine, { borderColor: selected ? palette.text : palette.border, opacity: ready || !check ? 1 : 0.55 }]}>
              <View style={styles.engineText}>
                <Text style={[styles.engineName, { color: palette.text }]}>{provider.name}</Text>
                <Text style={[styles.note, { color: palette.textMuted }]}>{provider.description}</Text>
                {check && !ready ? <Text style={[styles.note, { color: palette.warning }]}>{`Not ready: ${check.missing.join('; ') || 'DeepTutor says it is not set up.'}`}</Text> : null}
              </View>
              {!check ? <ActivityIndicator size="small" color={palette.textMuted} /> : selected ? <Icon name="check" size={18} color={palette.text} strokeWidth={2} /> : null}
            </Pressable>
          );
        })}
        {!providers.isLoading && usable.length > 0 && usable.every((provider) => readiness(provider)) && !firstReady ? (
          <Text style={[styles.note, { color: palette.textMuted }]}>No engine is ready on this server yet. An admin sets one up in DeepTutor&apos;s settings.</Text>
        ) : null}

        {engine?.startsWith('pageindex') ? (
          <>
            <Text style={[styles.label, { color: palette.textMuted }]}>Indexing</Text>
            <View style={styles.modes}>
              {(['flash', 'standard'] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: value === mode }}
                  onPress={() => setMode(value)}
                  style={[styles.mode, { borderColor: value === mode ? palette.text : palette.border }]}>
                  <Text style={[styles.engineName, { color: palette.text }]}>{value === 'flash' ? 'Flash' : 'Standard'}</Text>
                  <Text style={[styles.note, { color: palette.textMuted }]}>{value === 'flash' ? 'Quicker, lighter index' : 'Slower, more thorough'}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <Text style={[styles.label, { color: palette.textMuted }]}>Documents</Text>
        {files.map((file) => (
          <View key={file.uri} style={[styles.file, { borderColor: palette.border }]}>
            <Icon name="document-text" size={18} color={palette.textMuted} />
            <Text style={[styles.fileName, { color: palette.text }]} numberOfLines={1}>
              {file.name}
            </Text>
            <Text style={[styles.note, { color: palette.textFaint }]}>{fileSize(file.size)}</Text>
            <IconButton icon="x-mark" label={`Remove ${file.name}`} size={16} color={palette.textMuted} onPress={() => setFiles((current) => current.filter((item) => item.uri !== file.uri))} />
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          disabled={!engine}
          onPress={() => void pickDocuments(engine ?? '', toast).then((more) => setFiles((current) => [...current, ...more.filter((file) => !current.some((item) => item.uri === file.uri))]))}
          style={({ pressed }) => [styles.add, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
          <Icon name="plus" size={16} color={palette.text} />
          <Text style={[styles.addText, { color: palette.text }]}>{engine === 'pageindex-oss' ? 'Add PDFs' : 'Add Documents'}</Text>
        </Pressable>
        <Text style={[styles.note, { color: palette.textFaint }]}>You can add documents later too. Indexing carries on in DeepTutor if you leave.</Text>
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: palette.border }]}>
        <Button label="Create" onPress={() => void create()} loading={busy} disabled={!engine || busy} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  link: { fontFamily: fonts.medium, fontSize: 16, minWidth: 60 },
  title: { fontFamily: fonts.semibold, fontSize: 17 },
  spacer: { minWidth: 60 },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  label: { fontFamily: fonts.medium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 8 },
  input: { height: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, fontFamily: fonts.regular, fontSize: 15 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  engine: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.md, padding: 12 },
  engineText: { flex: 1, gap: 3 },
  engineName: { fontFamily: fonts.medium, fontSize: 15 },
  modes: { flexDirection: 'row', gap: 8 },
  mode: { flex: 1, borderWidth: 1, borderRadius: radius.md, padding: 10, gap: 2 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingLeft: 10 },
  fileName: { flex: 1, fontFamily: fonts.regular, fontSize: 14 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, borderStyle: 'dashed' },
  addText: { fontFamily: fonts.medium, fontSize: 14 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
});
