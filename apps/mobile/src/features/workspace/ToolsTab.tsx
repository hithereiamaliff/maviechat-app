import { deleteWorkspaceTool, exportWorkspaceTools, filterTools, isAtLeast, TOOL_TEMPLATE, type WorkspaceTool, type WorkspaceView } from '@maviechat/owui-protocol';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { CodeEditorSheet, type CodeTarget } from '@/features/code/CodeEditorSheet';
import { useCodeImport } from '@/features/code/useCodeImport';
import { fileNameOf, shareFile, stampedName } from '@/features/settings/exportFile';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useSessionUser } from '@/lib/server';
import { AccessSheet, type AccessTarget } from './AccessSheet';
import { CodeVersionsSheet, type CodeVersionsTarget } from './CodeVersionsSheet';
import { ListControls } from './ListControls';
import { useWorkspaceRefresh, useWorkspaceTools } from './queries';
import { SharedValvesSheet, ToolSheet, type ValvesTarget } from './ToolSheets';
import { ListState, listStyles, rowFacts, useWorkspaceRun, WorkspaceList, WorkspaceRow } from './WorkspaceList';

/**
 * Workspace tools: search, whose, order (the whole list comes at once); each with its version and
 * what it's for. Its code shows to writers, who can change it in the code editor; new tools start
 * from a template, or come from a link or an export file. Saving runs a tool on the server, so the
 * editor asks first.
 */
export function ToolsTab({ tabs }: { tabs: (count?: number) => ReactNode }) {
  const toast = useToast();
  const { client } = useAuthed();
  const capabilities = useCapabilities();
  const me = useSessionUser();
  const refresh = useWorkspaceRefresh();
  const run = useWorkspaceRun();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<WorkspaceView>('');
  const [byName, setByName] = useState(false);
  const [showing, setShowing] = useState<string | null>(null);
  const [valves, setValves] = useState<ValvesTarget | null>(null);
  const [sharing, setSharing] = useState<AccessTarget | null>(null);
  const [editing, setEditing] = useState<CodeTarget | null>(null);
  const [versions, setVersions] = useState<CodeVersionsTarget | null>(null);
  // 0.12 keeps each saved change of a tool as a version (writers only).
  const versioned = isAtLeast(capabilities?.version, '0.12.0');
  // Edit Code in a tool's sheet: the editor opens once that sheet has gone.
  const editNextRef = useRef<string | null>(null);
  const imports = useCodeImport('tools', setEditing, refresh);
  const canImport = capabilities?.isAdmin || capabilities?.can('workspace.tools_import');
  const tools = useWorkspaceTools();
  const items = filterTools(tools.data ?? [], { query, view, me: me.data?.id ?? '', byName });
  const canCreate = capabilities?.isAdmin || capabilities?.can('workspace.tools');
  const canExport = capabilities?.isAdmin || capabilities?.can('workspace.tools_export');

  // The export has every readable tool's code; one tool's is picked from it.
  const exportTools = async (only: WorkspaceTool | null) => {
    try {
      const all = await exportWorkspaceTools(client);
      const chosen = only ? all.filter((row) => typeof row === 'object' && row !== null && (row as { id?: unknown }).id === only.id) : all;
      if (!chosen.length) return toast('There’s nothing to export.', 'error');
      await shareFile(only ? `${fileNameOf(only.name, 'tool')}.json` : stampedName('tools'), JSON.stringify(chosen, null, 2));
    } catch (error) {
      toast(`Couldn’t export: ${describeError(error)}`, 'error');
    }
  };
  const remove = (tool: WorkspaceTool) =>
    Alert.alert(`Delete ${tool.name}?`, 'Everyone loses it. Models that had it switched on keep a note of it that does nothing.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => deleteWorkspaceTool(client, tool.id), `${tool.name} deleted`) },
    ]);
  const menuFor = (tool: WorkspaceTool): MenuItem[] => [
    { key: 'view', label: tool.writeAccess ? 'View Code' : 'View', icon: 'code-bracket', onPress: () => setShowing(tool.id) },
    ...(tool.writeAccess
      ? [
          { key: 'valves', label: 'Settings…', icon: 'cog-6-tooth' as const, onPress: () => setValves({ kind: 'tools', id: tool.id, name: tool.name }) },
          { key: 'share', label: 'Share…', icon: 'users' as const, onPress: () => setSharing({ area: 'tools', id: tool.id, name: tool.name, grants: tool.accessGrants }) },
          { key: 'edit', label: 'Edit Code', icon: 'code-bracket' as const, onPress: () => setEditing({ kind: 'tools', id: tool.id }) },
          ...(versioned ? [{ key: 'versions', label: 'Versions…', icon: 'clock' as const, onPress: () => setVersions({ kind: 'tools', id: tool.id, name: tool.name, canWrite: true }) }] : []),
        ]
      : []),
    ...(tool.fundingUrl ? [{ key: 'fund', label: 'Support the Author', icon: 'link' as const, onPress: () => void WebBrowser.openBrowserAsync(tool.fundingUrl) }] : []),
    ...(canExport ? [{ key: 'export', label: 'Export', icon: 'arrow-down-tray' as const, onPress: () => void exportTools(tool) }] : []),
    ...(tool.writeAccess ? [{ key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => remove(tool) }] : []),
  ];
  const more: MenuItem[] = [
    // The server fetches a link for admins only, as on the web.
    ...(capabilities?.isAdmin ? [{ key: 'link', label: 'Import From Link…', icon: 'link' as const, onPress: imports.fromLink }] : []),
    ...(canImport ? [{ key: 'import', label: 'Import File…', icon: 'arrow-up-tray' as const, onPress: imports.fromFile }] : []),
    ...(canExport ? [{ key: 'export', label: 'Export All', icon: 'arrow-down-tray' as const, onPress: () => void exportTools(null) }] : []),
  ];

  const header = (
    <View style={listStyles.top}>
      {tabs(tools.data?.length)}
      <ListControls query={query} setQuery={setQuery} placeholder="Search tools" view={view} setView={setView} byName={byName} setByName={setByName} onNew={canCreate ? () => setEditing({ kind: 'tools', id: null, name: '', description: '', content: TOOL_TEMPLATE }) : undefined} more={more} />
      <ListState loading={tools.isLoading} error={tools.isError ? tools.error : null} empty={Boolean(tools.data) && !items.length} filtered={Boolean(query.trim() || view)} noun="tools" />
    </View>
  );

  return (
    <View style={listStyles.flex}>
      <WorkspaceList
        items={items}
        keyOf={(tool) => tool.id}
        header={header}
        paging={{ hasNextPage: false, isFetchingNextPage: false, fetchNextPage: () => undefined }}
        onRefresh={refresh}
        renderItem={(tool) => (
          <WorkspaceRow
            title={tool.name}
            code={tool.version ? `${tool.id} · v${tool.version}` : tool.id}
            detail={tool.description}
            facts={rowFacts({ ...tool, isActive: true }, view)}
            menu={menuFor(tool)}
            onPress={() => setShowing(tool.id)}
            hint={tool.writeAccess ? 'Shows it, with its code' : 'Shows it'}
          />
        )}
      />
      <ToolSheet
        id={showing}
        onClose={() => setShowing(null)}
        onEdit={(id) => {
          editNextRef.current = id;
          setShowing(null);
        }}
        onDismiss={() => {
          const id = editNextRef.current;
          editNextRef.current = null;
          if (id) setEditing({ kind: 'tools', id });
        }}
      />
      <CodeEditorSheet target={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <CodeVersionsSheet target={versions} onClose={() => setVersions(null)} onChanged={refresh} />
      <SharedValvesSheet target={valves} onClose={() => setValves(null)} />
      <AccessSheet target={sharing} onClose={() => setSharing(null)} onSaved={refresh} />
    </View>
  );
}
