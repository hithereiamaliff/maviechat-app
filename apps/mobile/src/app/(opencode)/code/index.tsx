import { createSession, sendPrompt } from '@maviechat/opencode-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { pushTokenIfOn } from '@/features/notifications/push';
import { describeOcError } from '@/features/opencode/errors';
import { OcComposer, type ModelPick } from '@/features/opencode/OcComposer';
import { OcHeader } from '@/features/opencode/OcHeader';
import { useOcProject, useProjectPicker } from '@/features/opencode/project';
import { folderName, ocKey, useMachine, useOcAgents, useOcModels, useOcSessions } from '@/features/opencode/queries';
import { useOcAuthed } from '@/session/OpenCodeProvider';
import { fonts, radius, usePalette } from '@/theme';

const RECENT = 3;

/**
 * A new OpenCode session, laid out like Open WebUI's new chat: the machine, the composer in the
 * middle, and under it the project, whether to ask before changes, and recent sessions there.
 */
export default function OpenCodeHome() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, accountId } = useOcAuthed();
  const machine = useMachine();
  const project = useOcProject();
  const picker = useProjectPicker();
  const directory = project.directory;
  const models = useOcModels(directory);
  const agents = useOcAgents(directory);
  const recent = useOcSessions(directory);
  const [model, setModel] = useState<ModelPick | null>(null);
  const [agent, setAgent] = useState<string | null>(null);
  const [approvals, setApprovals] = useState(true);
  const offline = machine.data?.logins.some((login) => !login.online) ?? false;
  // What OpenCode uses when nothing is picked: the agent's own model, else the machine's default.
  const agentInfo = agents.data?.find((item) => item.name === (agent ?? agents.data?.[0]?.name));
  const defaultModel = agentInfo?.model ?? models.data?.defaultModel ?? null;

  const send = async (text: string): Promise<boolean> => {
    if (!directory) {
      picker.open();
      return false;
    }
    try {
      // Unless you pick a model, OpenCode uses its own default.
      const session = await createSession(
        client,
        directory,
        { ...(agent ? { agent } : {}), ...(model ? { model: { id: model.modelID, providerID: model.providerID } } : {}) },
        approvals,
      );
      // With notifications on, the machine tells this phone when the session finishes or needs you.
      const pushToken = await pushTokenIfOn().catch(() => null);
      await sendPrompt(client, directory, session.id, { text, model: model ?? undefined, agent: agent ?? undefined }, { pushToken });
      void queryClient.invalidateQueries({ queryKey: ocKey(accountId, 'sessions') });
      router.replace({ pathname: '/code/s/[id]', params: { id: session.id, dir: directory } });
      return true;
    } catch (error) {
      toast(describeOcError(error), 'error');
      return false;
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <OcHeader title="New Session" />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.greeting}>
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
              {machine.data?.name ?? 'OpenCode'}
            </Text>
            <Text style={[styles.subtitle, { color: palette.textMuted }]}>
              {offline ? 'OpenCode isn’t answering on this machine right now.' : directory ? `What should OpenCode do in ${folderName(directory)}?` : 'Choose a project to start.'}
            </Text>
          </View>

          <View style={styles.composer}>
            <OcComposer
              working={false}
              models={models.data?.models ?? []}
              model={model}
              defaultModel={defaultModel}
              onModel={setModel}
              agents={agents.data ?? []}
              agent={agent ?? agents.data?.[0]?.name ?? null}
              onAgent={setAgent}
              onSend={send}
              placeholder={directory ? 'Ask OpenCode' : 'Choose a project first'}
            />
          </View>

          <View style={styles.options}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Project: ${directory ?? 'none chosen'}. Change`}
              onPress={picker.open}
              style={({ pressed }) => [styles.option, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
              <Icon name="folder" size={18} color={palette.textMuted} />
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, { color: palette.text }]} numberOfLines={1}>
                  {directory ? folderName(directory) : 'Choose a Project'}
                </Text>
                <Text style={[styles.optionDetail, { color: palette.textMuted }]} numberOfLines={1}>
                  {directory ?? 'OpenCode works inside a project folder'}
                </Text>
              </View>
              <Icon name="chevron-right" size={16} color={palette.textFaint} />
            </Pressable>
            <View style={[styles.option, { borderColor: palette.border }]}>
              <Icon name="shield-check" size={18} color={palette.textMuted} />
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, { color: palette.text }]}>Ask Before Changes</Text>
                <Text style={[styles.optionDetail, { color: palette.textMuted }]}>Before edits and commands, in this session</Text>
              </View>
              <Switch value={approvals} onValueChange={setApprovals} accessibilityLabel="Ask before changes" />
            </View>
          </View>

          {directory && (recent.data?.length ?? 0) > 0 ? (
            <View style={styles.recent}>
              <Text style={[styles.section, { color: palette.textMuted }]}>Recent in {folderName(directory)}</Text>
              {(recent.data ?? []).slice(0, RECENT).map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => router.replace({ pathname: '/code/s/[id]', params: { id: item.id, dir: item.directory } })}
                  style={({ pressed }) => [styles.recentRow, pressed && { backgroundColor: palette.surface }]}>
                  <Icon name="clock" size={16} color={palette.textFaint} />
                  <Text style={[styles.recentTitle, { color: palette.text }]} numberOfLines={1}>
                    {item.title || 'Untitled'}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      {picker.element}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingBottom: 48, gap: 16 },
  greeting: { paddingHorizontal: 24, gap: 6, alignItems: 'center' },
  title: { fontFamily: fonts.semibold, fontSize: 24 },
  subtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  composer: { paddingHorizontal: 12 },
  options: { paddingHorizontal: 16, gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 8 },
  optionText: { flex: 1, gap: 1 },
  optionLabel: { fontFamily: fonts.medium, fontSize: 15 },
  optionDetail: { fontFamily: fonts.regular, fontSize: 13 },
  recent: { paddingHorizontal: 16, gap: 2 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginLeft: 4, marginBottom: 4 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: 4, borderRadius: radius.md },
  recentTitle: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
});
