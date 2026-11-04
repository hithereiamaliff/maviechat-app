import { createSession, sendPrompt } from '@maviechat/opencode-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { describeOcError } from '@/features/opencode/errors';
import { OcComposer, type ModelPick } from '@/features/opencode/OcComposer';
import { OcHeader } from '@/features/opencode/OcHeader';
import { useOcProject, useProjectPicker } from '@/features/opencode/project';
import { folderName, ocKey, useMachine, useOcAgents, useOcModels } from '@/features/opencode/queries';
import { useOcAuthed } from '@/session/OpenCodeProvider';
import { fonts, radius, usePalette } from '@/theme';

/** A new OpenCode session: which project, whether it asks before changes, and the first prompt. */
export default function OpenCodeHome() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, accountId } = useOcAuthed();
  const machine = useMachine();
  const project = useOcProject();
  const picker = useProjectPicker();
  const directory = project.directory;
  const models = useOcModels(directory);
  const agents = useOcAgents(directory);
  const [model, setModel] = useState<ModelPick | null>(null);
  const [agent, setAgent] = useState<string | null>(null);
  const [approvals, setApprovals] = useState(true);
  const chosenModel = model ?? models.data?.fallback ?? null;

  const send = async (text: string): Promise<boolean> => {
    if (!directory) {
      picker.open();
      return false;
    }
    try {
      const session = await createSession(
        client,
        directory,
        { ...(agent ? { agent } : {}), ...(chosenModel ? { model: { id: chosenModel.modelID, providerID: chosenModel.providerID } } : {}) },
        approvals,
      );
      await sendPrompt(client, directory, session.id, { text, model: chosenModel ?? undefined, agent: agent ?? undefined });
      void queryClient.invalidateQueries({ queryKey: ocKey(accountId, 'sessions') });
      router.replace({ pathname: '/code/s/[id]', params: { id: session.id, dir: directory } });
      return true;
    } catch (error) {
      toast(describeOcError(error), 'error');
      return false;
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background, paddingTop: insets.top }]}>
      <OcHeader title="New Session" />
      <KeyboardAvoidingView behavior="padding" style={styles.flex} keyboardVerticalOffset={insets.top}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: palette.text }]}>{machine.data?.name ?? 'OpenCode'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Project: ${directory ?? 'none chosen'}. Change`} onPress={picker.open} style={[styles.project, { borderColor: palette.border, backgroundColor: palette.surface }]}>
            <Icon name="folder" size={20} color={palette.textMuted} />
            <View style={styles.projectText}>
              <Text style={[styles.projectName, { color: palette.text }]} numberOfLines={1}>
                {directory ? folderName(directory) : 'Choose a Project'}
              </Text>
              <Text style={[styles.projectPath, { color: palette.textMuted }]} numberOfLines={1}>
                {directory ?? 'OpenCode works inside a project folder'}
              </Text>
            </View>
            <Icon name="chevron-right" size={16} color={palette.textFaint} />
          </Pressable>
          <View style={[styles.switchRow, { borderColor: palette.border }]}>
            <View style={styles.projectText}>
              <Text style={[styles.projectName, { color: palette.text }]}>Ask Before Changes</Text>
              <Text style={[styles.projectPath, { color: palette.textMuted }]}>OpenCode asks you here before it edits files or runs commands in this session.</Text>
            </View>
            <Switch value={approvals} onValueChange={setApprovals} accessibilityLabel="Ask before changes" />
          </View>
          {machine.data?.logins.some((login) => !login.online) ? <Text style={[styles.warning, { color: palette.danger }]}>OpenCode isn’t answering on this machine right now.</Text> : null}
        </ScrollView>
        <View style={[styles.composer, { paddingBottom: insets.bottom + 8 }]}>
          <OcComposer
            working={false}
            models={models.data?.models ?? []}
            model={chosenModel}
            onModel={setModel}
            agents={agents.data ?? []}
            agent={agent ?? agents.data?.[0]?.name ?? null}
            onAgent={setAgent}
            onSend={send}
            placeholder={directory ? `Ask OpenCode in ${folderName(directory)}` : 'Choose a project first'}
          />
        </View>
      </KeyboardAvoidingView>
      {picker.element}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 20, gap: 14 },
  title: { fontFamily: fonts.semibold, fontSize: 24, textAlign: 'center', marginBottom: 6 },
  project: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 12 },
  projectText: { flex: 1, gap: 2 },
  projectName: { fontFamily: fonts.medium, fontSize: 15 },
  projectPath: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 12 },
  warning: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center' },
  composer: { paddingHorizontal: 12, paddingTop: 6 },
});
