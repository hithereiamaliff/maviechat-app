import { getToolValves, getToolValvesSpec, updateToolValves, valveFields, valvesFromForm, valvesToForm, type ValveField, type WorkspaceTool } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { ValveRow } from '@/features/chat/controls/ValvesPanel';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import { editorStyles as styles, SheetHeader, SheetLoading } from './EditorParts';
import { useWorkspaceTool } from './queries';

/** The web's editor for a tool, signed in (saving runs the tool's code on the server, so code is written there). */
export const openToolOnWeb = (baseUrl: string, id: string | null) => void WebBrowser.openBrowserAsync(id ? `${baseUrl}/workspace/tools/edit?id=${encodeURIComponent(id)}` : `${baseUrl}/workspace/tools/create`);

/** A tool as it is: what it's for, its header (author, version, what it installs), and its code for those who may change it. */
export function ToolSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Modal visible={id !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {id ? <ToolView id={id} onClose={onClose} /> : null}
    </Modal>
  );
}

function ToolView({ id, onClose }: { id: string; onClose: () => void }) {
  const palette = usePalette();
  const { session } = useAuthed();
  const tool = useWorkspaceTool(id);
  if (!(tool.data && tool.isFetchedAfterMount)) return <SheetLoading error={tool.isError ? tool.error : null} onClose={onClose} />;
  const item = tool.data;
  const facts = [item.version ? `Version ${item.version}` : '', item.author ? `by ${item.author}` : '', item.ownerName ? `added by ${item.ownerName}` : ''].filter(Boolean).join(' · ');
  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={item.name} onCancel={onClose} onSave={onClose} canSave busy={false} readOnly />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.field}>
          <Text style={[styles.mono, { color: palette.textMuted }]}>{item.id}</Text>
          {item.description ? <Text style={[local.body, { color: palette.text }]}>{item.description}</Text> : null}
          {facts ? <Text style={[styles.note, { color: palette.textMuted }]}>{facts}</Text> : null}
          {item.requirements ? <Text style={[styles.note, { color: palette.textMuted }]}>{`Installs on the server when saved: ${item.requirements}`}</Text> : null}
          {item.hasUserValves ? <Text style={[styles.note, { color: palette.textMuted }]}>Each person can set their own settings for it in a chat’s Controls.</Text> : null}
        </View>
        {item.fundingUrl ? (
          <Pressable accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(item.fundingUrl)}>
            <Text style={[styles.label, { color: palette.link }]}>Support the Author</Text>
          </Pressable>
        ) : null}
        {item.writeAccess ? (
          <>
            <View style={styles.field}>
              <Text style={[styles.label, { color: palette.text }]}>Code</Text>
              <Text selectable style={[styles.mono, local.code, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]}>
                {item.content ?? ''}
              </Text>
            </View>
            <Text style={[styles.note, { color: palette.textMuted }]}>Saving a tool runs its code on the server, so its code is changed on the web.</Text>
            <Button label="Edit on the Web" variant="secondary" onPress={() => openToolOnWeb(session.baseUrl, item.id)} />
          </>
        ) : (
          <Text style={[styles.note, { color: palette.textMuted }]}>Shared with you to use: only its owner (or someone they let) sees and changes its code.</Text>
        )}
      </ScrollView>
    </View>
  );
}

/** The settings a tool shares with everyone who uses it (keys, limits…), saved with Save; secrets stay hidden. */
export function ToolValvesSheet({ tool, onClose }: { tool: WorkspaceTool | null; onClose: () => void }) {
  return (
    <Modal visible={tool !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {tool ? <ValvesLoader tool={tool} onClose={onClose} /> : null}
    </Modal>
  );
}

function ValvesLoader({ tool, onClose }: { tool: WorkspaceTool; onClose: () => void }) {
  const { client } = useAuthed();
  const spec = useQuery({ queryKey: ['workspace', 'tool-valves-spec', tool.id], queryFn: () => getToolValvesSpec(client, tool.id), staleTime: 0 });
  const values = useQuery({ queryKey: ['workspace', 'tool-valves', tool.id], queryFn: () => getToolValves(client, tool.id), staleTime: 0 });
  if (!(spec.isFetchedAfterMount && values.isFetchedAfterMount) || spec.isError || values.isError) return <SheetLoading error={spec.isError ? spec.error : values.isError ? values.error : null} onClose={onClose} />;
  const fields = valveFields(spec.data);
  return <ValvesForm tool={tool} fields={fields} initial={valvesToForm(fields, values.data ?? {})} onClose={onClose} />;
}

function ValvesForm({ tool, fields, initial, onClose }: { tool: WorkspaceTool; fields: ValveField[]; initial: Record<string, unknown>; onClose: () => void }) {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const save = async () => {
    const { values, invalid } = valvesFromForm(fields, form);
    if (invalid.length) return setProblem(`Not a number: ${invalid.join(', ')}`);
    setBusy(true);
    setProblem('');
    try {
      await updateToolValves(client, tool.id, values);
      toast('Saved for everyone who uses it');
      onClose();
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { backgroundColor: palette.background }]}>
      <SheetHeader title={`${tool.name} Settings`} onCancel={onClose} onSave={() => void save()} canSave={fields.length > 0} busy={busy} readOnly={!fields.length} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {problem ? <Text style={[styles.note, styles.problem, { color: palette.danger, borderColor: palette.danger }]}>{problem}</Text> : null}
        {fields.length ? (
          <>
            <Text style={[styles.note, { color: palette.textMuted }]}>Shared by everyone who uses this tool. Default uses the tool’s own value.</Text>
            {fields.map((field) => (
              <ValveRow key={field.key} field={field} value={form[field.key]} onChange={(value) => setForm({ ...form, [field.key]: value })} />
            ))}
          </>
        ) : (
          <Text style={[styles.note, { color: palette.textMuted }]}>This tool has no shared settings.</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const local = StyleSheet.create({
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  code: { padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, lineHeight: 19, overflow: 'hidden' },
});
