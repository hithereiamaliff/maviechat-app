import { createWorkspacePrompt, deleteWorkspacePrompt, listWorkspacePrompts, promptsExport, promptsFromImport, toggleWorkspacePrompt, type PromptImport, type WorkspacePrompt, type WorkspaceView } from '@maviechat/owui-protocol';
import * as Clipboard from 'expo-clipboard';
import { useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { fileNameOf, shareFile, stampedName } from '@/features/settings/exportFile';
import { describeError } from '@/lib/errors';
import { useDebounced } from '@/lib/useDebounced';
import { useAuthed, useCapabilities } from '@/lib/server';
import { AccessSheet, type AccessTarget } from './AccessSheet';
import { pickTextFile, plural } from './EditorParts';
import { ListControls } from './ListControls';
import { PromptEditor, type PromptEditorTarget } from './PromptEditor';
import { useWorkspacePrompts, useWorkspacePromptTags, useWorkspaceRefresh } from './queries';
import { ListState, listStyles, rowFacts, useWorkspaceRun, WorkspaceList, WorkspaceRow } from './WorkspaceList';

/** Workspace prompts: search, whose, tag, order; each with its command, what it says, and what you may do. */
export function PromptsTab({ tabs }: { tabs: (count?: number) => ReactNode }) {
  const toast = useToast();
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const refresh = useWorkspaceRefresh();
  const run = useWorkspaceRun();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 300);
  const [view, setView] = useState<WorkspaceView>('');
  const [tag, setTag] = useState('');
  const [byName, setByName] = useState(false);
  const [editor, setEditor] = useState<PromptEditorTarget | null>(null);
  const [sharing, setSharing] = useState<AccessTarget | null>(null);
  const [importing, setImporting] = useState(false);
  const filters = { query: debounced, view, tag, orderBy: byName ? 'name' : 'updated_at', direction: byName ? 'asc' : 'desc' } as const;
  const prompts = useWorkspacePrompts(filters);
  const tags = useWorkspacePromptTags();
  const items = prompts.data?.pages.flatMap((page) => page.items) ?? [];
  const canCreate = capabilities?.isAdmin || capabilities?.can('workspace.prompts');
  const canImport = capabilities?.isAdmin || capabilities?.can('workspace.prompts_import');
  const canExport = capabilities?.isAdmin || capabilities?.can('workspace.prompts_export');

  const exportPrompts = async (chosen: WorkspacePrompt[] | null) => {
    try {
      let all = chosen ?? [];
      if (!chosen) {
        // Everything the list's search, view and tag find, as the web exports its list.
        for (let page = 1; ; page += 1) {
          const batch = await listWorkspacePrompts(client, { ...filters, page });
          all = [...all, ...batch.items];
          if (!batch.items.length || all.length >= batch.total) break;
        }
      }
      if (!all.length) return toast('There are no prompts to export.', 'error');
      await shareFile(chosen?.length === 1 ? `${fileNameOf(chosen[0]?.name ?? '', 'prompt')}.json` : stampedName('prompts'), promptsExport(all));
    } catch (error) {
      toast(`Couldn’t export: ${describeError(error)}`, 'error');
    }
  };
  const runImport = async (found: PromptImport[]) => {
    setImporting(true);
    const failed: string[] = [];
    for (const prompt of found) {
      try {
        await createWorkspacePrompt(client, prompt);
      } catch (error) {
        failed.push(`/${prompt.command}: ${describeError(error)}`);
      }
    }
    setImporting(false);
    refresh();
    if (!failed.length) toast(`Imported ${plural(found.length, 'prompt')} (private)`);
    else toast(`Imported ${found.length - failed.length} of ${found.length}. ${failed[0]}${failed.length > 1 ? ` (and ${failed.length - 1} more)` : ''}`, 'error');
  };
  const importPrompts = async () => {
    let found: ReturnType<typeof promptsFromImport>;
    try {
      const file = await pickTextFile('application/json');
      if (!file) return;
      found = promptsFromImport(JSON.parse(file.text));
    } catch (error) {
      return toast(`Couldn’t read the file: ${describeError(error)}`, 'error');
    }
    if (!found.prompts.length) return toast('There are no prompts in the file.', 'error');
    Alert.alert(`Import ${plural(found.prompts.length, 'prompt')}?`, `Each becomes a new prompt of yours, private until you share it.${found.skipped ? ` ${plural(found.skipped, 'entry', 'entries')} without a command or text are left out.` : ''} Any whose command is taken on this server won’t come in.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Import', onPress: () => void runImport(found.prompts) },
    ]);
  };
  const remove = (prompt: WorkspacePrompt) =>
    Alert.alert(`Delete /${prompt.command}?`, 'It leaves everyone’s / menu, with all its versions.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => deleteWorkspacePrompt(client, prompt.id), `${prompt.name} deleted`) },
    ]);
  const menuFor = (prompt: WorkspacePrompt): MenuItem[] => [
    { key: 'open', label: prompt.writeAccess ? 'Edit' : 'View', icon: prompt.writeAccess ? 'pencil-square' : 'eye', onPress: () => setEditor({ kind: 'edit', id: prompt.id }) },
    ...(canCreate ? [{ key: 'clone', label: 'Clone', icon: 'rectangle-stack' as const, onPress: () => setEditor({ kind: 'clone', id: prompt.id }) }] : []),
    { key: 'copy', label: 'Copy Text', icon: 'clipboard-document', onPress: () => void Clipboard.setStringAsync(prompt.content).then(() => toast('Copied')) },
    ...(prompt.writeAccess ? [{ key: 'share', label: 'Share…', icon: 'users' as const, onPress: () => setSharing({ area: 'prompts', id: prompt.id, name: prompt.name, grants: prompt.accessGrants }) }] : []),
    ...(canExport ? [{ key: 'export', label: 'Export', icon: 'arrow-down-tray' as const, onPress: () => void exportPrompts([prompt]) }] : []),
    ...(prompt.writeAccess ? [{ key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => remove(prompt) }] : []),
  ];
  const more: MenuItem[] = [
    ...(canImport ? [{ key: 'import', label: importing ? 'Importing…' : 'Import…', icon: 'arrow-up-tray' as const, onPress: () => void (importing ? undefined : importPrompts()) }] : []),
    ...(canExport ? [{ key: 'export', label: 'Export All', icon: 'arrow-down-tray' as const, onPress: () => void exportPrompts(null) }] : []),
  ];

  const header = (
    <View style={listStyles.top}>
      {tabs(prompts.data?.pages[0]?.total)}
      <ListControls query={query} setQuery={setQuery} placeholder="Search prompts" view={view} setView={setView} byName={byName} setByName={setByName} tags={tags.data} tag={tag} setTag={setTag} onNew={canCreate ? () => setEditor({ kind: 'new' }) : undefined} more={more} />
      <ListState loading={prompts.isLoading} error={prompts.isError ? prompts.error : null} empty={Boolean(prompts.data) && !items.length} filtered={Boolean(debounced || tag || view)} noun="prompts" />
    </View>
  );

  return (
    <View style={listStyles.flex}>
      <WorkspaceList
        items={items}
        keyOf={(prompt) => prompt.id}
        header={header}
        paging={prompts}
        onRefresh={refresh}
        renderItem={(prompt) => (
          <WorkspaceRow
            title={prompt.name}
            code={`/${prompt.command}`}
            detail={prompt.content.replace(/\s+/g, ' ').trim()}
            facts={rowFacts(prompt, view)}
            dim={!prompt.isActive}
            on={prompt.isActive}
            onToggle={prompt.writeAccess ? () => run(() => toggleWorkspacePrompt(client, prompt.id), prompt.isActive ? `/${prompt.command} is off for everyone` : `/${prompt.command} is on`) : undefined}
            menu={menuFor(prompt)}
            onPress={() => setEditor({ kind: 'edit', id: prompt.id })}
            hint={prompt.writeAccess ? 'Opens its editor' : 'Shows it'}
          />
        )}
      />
      <PromptEditor target={editor} onClose={() => setEditor(null)} />
      <AccessSheet target={sharing} onClose={() => setSharing(null)} onSaved={refresh} />
    </View>
  );
}
