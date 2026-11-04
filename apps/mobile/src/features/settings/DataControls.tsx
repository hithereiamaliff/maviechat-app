import { archiveAllChats, countFiles, deleteAllChats, exportAllChats, exportFileNameAt, ImportFileError, importChats, OwuiHttpError, readImportFile, type ImportPlan } from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, usePalette } from '@/theme';
import { CHAT_LIST_QUERIES, shareJsonFile } from './exportFile';
import { FilesSheet } from './FilesSheet';
import { ActionRow, Group, Note, rowStyles, SectionTitle } from './rows';
import { SharedChatsSheet } from './SharedChatsSheet';

/** Bigger files than this are better imported on the web: the phone holds the whole file while it reads it. */
const IMPORT_LIMIT_BYTES = 50 * 1024 * 1024;

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/**
 * Open WebUI's Data Controls tab: chats in from a file (an Open WebUI export or ChatGPT's) and out as
 * one, your shared links, archive or delete everything, and your files.
 */
export function DataControls() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const capabilities = useCapabilities();
  const files = useQuery({ queryKey: ['files-count'], queryFn: () => countFiles(client) });
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'shared' | 'files' | null>(null);
  const canImport = capabilities ? capabilities.can('chat.import', true) : false;
  const canExport = capabilities ? capabilities.can('chat.export', true) : false;
  // As the rest of the app: Delete only with the permission (the server refuses otherwise).
  const canDelete = capabilities?.can('chat.delete') ?? false;

  const refreshChats = () => {
    for (const queryKey of CHAT_LIST_QUERIES) void queryClient.invalidateQueries({ queryKey: [...queryKey] });
  };
  const problem = (what: string, error: unknown) => {
    const denied = error instanceof OwuiHttpError && (error.status === 401 || error.status === 403);
    toast(denied ? `Your admin doesn’t let this account ${what}.` : `Couldn’t ${what}: ${describeError(error)}`, 'error');
  };

  const runImport = async (plan: ImportPlan) => {
    setBusy(`Importing ${plural(plan.chats.length, 'chat')}…`);
    let done = 0;
    try {
      const made = await importChats(client, plan.chats, (count, total) => {
        done = count;
        setBusy(`Importing… ${count.toLocaleString()} of ${total.toLocaleString()}`);
      });
      refreshChats();
      toast(`Imported ${plural(made.length || done, 'chat')}`, 'success');
    } catch (error) {
      refreshChats();
      if (done) toast(`Imported ${done.toLocaleString()} of ${plan.chats.length.toLocaleString()} chats, then: ${describeError(error)}`, 'error');
      else problem('import chats', error);
    } finally {
      setBusy(null);
    }
  };

  const chooseImport = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
    const asset = picked.canceled ? undefined : picked.assets[0];
    if (!asset) return;
    if ((asset.size ?? 0) > IMPORT_LIMIT_BYTES) {
      toast('This file is too big to import on the phone. Import it in the web app instead.', 'error');
      return;
    }
    setBusy('Reading the file…');
    let plan: ImportPlan;
    try {
      plan = readImportFile(await new File(asset.uri).text());
    } catch (error) {
      setBusy(null);
      toast(error instanceof ImportFileError ? error.message : `Couldn’t read the file: ${describeError(error)}`, 'error');
      return;
    }
    setBusy(null);
    const from = plan.from === 'chatgpt' ? 'ChatGPT' : 'Open WebUI';
    const left = plan.skipped ? ` ${plural(plan.skipped, 'entry', 'entries')} in the file can’t be imported and will be left out.` : '';
    Alert.alert(`Import ${plural(plan.chats.length, 'chat')}?`, `From ${from}. They’re added to your chats; nothing you have changes.${left}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Import', onPress: () => void runImport(plan) },
    ]);
  };

  const runExport = async () => {
    setBusy('Gathering your chats…');
    try {
      const { json, count } = await exportAllChats(client);
      setBusy(null);
      if (!count) {
        toast('You have no chats to export.');
        return;
      }
      await shareJsonFile(exportFileNameAt('all', Date.now()), json);
    } catch (error) {
      problem('export chats', error);
    } finally {
      setBusy(null);
    }
  };

  const everything = (title: string, message: string, label: string, run: () => Promise<boolean>, done: string, what: string) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: label,
        style: 'destructive',
        onPress: () => {
          setBusy(`${label}…`);
          run().then(
            () => {
              setBusy(null);
              refreshChats();
              toast(done, 'success');
              // As on the web: start again from a new chat (the one open may be gone).
              router.dismissAll();
              router.replace('/');
            },
            (error: unknown) => {
              setBusy(null);
              problem(what, error);
            },
          );
        },
      },
    ]);

  return (
    <ScrollView contentContainerStyle={rowStyles.content}>
      <SectionTitle title="Chats" />
      <Group>
        {canImport ? <ActionRow label="Import Chats" hint="From an Open WebUI export, or ChatGPT’s conversations.json" disabled={busy !== null} onPress={() => void chooseImport()} /> : null}
        {canExport ? <ActionRow label="Export Chats" hint="Every chat, archived ones too, in one file" disabled={busy !== null} onPress={() => void runExport()} /> : null}
        <ActionRow label="Shared Chats" hint="Your share links: open, copy or delete them" disabled={busy !== null} onPress={() => setSheet('shared')} />
      </Group>
      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator size="small" color={palette.textMuted} />
          <Text style={[styles.busyText, { color: palette.textMuted }]}>{busy}</Text>
        </View>
      ) : null}
      <Note>For ChatGPT’s export, unzip the file ChatGPT sends you (Files does it with a tap) and choose conversations.json. Each conversation comes in as the thread you last saw.</Note>

      <Group>
        <ActionRow
          label="Archive All Chats"
          destructive
          disabled={busy !== null}
          onPress={() => everything('Archive all chats?', 'They move to Archived Chats, where you can bring them back.', 'Archive All', () => archiveAllChats(client), 'All chats archived', 'archive chats')}
        />
        {canDelete ? (
          <ActionRow
            label="Delete All Chats"
            destructive
            disabled={busy !== null}
            onPress={() => everything('Delete all chats?', 'Every chat, archived ones too, is deleted for good. This can’t be undone.', 'Delete All', () => deleteAllChats(client), 'All chats deleted', 'delete chats')}
          />
        ) : null}
      </Group>

      <SectionTitle title="Files" />
      <Group>
        <ActionRow
          label="Manage Files"
          hint={capabilities?.isAdmin ? 'Everyone’s files, as you’re an admin' : 'What you’ve uploaded to chats and knowledge'}
          value={typeof files.data === 'number' ? files.data.toLocaleString() : undefined}
          onPress={() => setSheet('files')}
        />
      </Group>

      <SharedChatsSheet visible={sheet === 'shared'} onClose={() => setSheet(null)} />
      <FilesSheet
        visible={sheet === 'files'}
        onClose={() => {
          setSheet(null);
          void queryClient.invalidateQueries({ queryKey: ['files-count'] });
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  busy: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 4, marginTop: 4 },
  busyText: { fontFamily: fonts.regular, fontSize: 13 },
});
