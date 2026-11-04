import { deleteWorkspaceTool, exportWorkspaceTools, filterTools, type WorkspaceTool, type WorkspaceView } from '@maviechat/owui-protocol';
import * as WebBrowser from 'expo-web-browser';
import { useState, type ReactNode } from 'react';
import { Alert, View } from 'react-native';
import type { MenuItem } from '@/components/Menu';
import { useToast } from '@/components/Toast';
import { fileNameOf, shareFile, stampedName } from '@/features/settings/exportFile';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useSessionUser } from '@/lib/server';
import { AccessSheet, type AccessTarget } from './AccessSheet';
import { ListControls } from './ListControls';
import { useWorkspaceRefresh, useWorkspaceTools } from './queries';
import { openToolOnWeb, ToolSheet, ToolValvesSheet } from './ToolSheets';
import { ListState, listStyles, rowFacts, useWorkspaceRun, WorkspaceList, WorkspaceRow } from './WorkspaceList';

/**
 * Workspace tools: search, whose, order (the whole list comes at once); each with its version and
 * what it's for. Its code shows to writers; writing code (new tools, edits, imports) is on the
 * web, as saving a tool runs it on the server.
 */
export function ToolsTab({ tabs }: { tabs: (count?: number) => ReactNode }) {
  const toast = useToast();
  const { client, session } = useAuthed();
  const capabilities = useCapabilities();
  const me = useSessionUser();
  const refresh = useWorkspaceRefresh();
  const run = useWorkspaceRun();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<WorkspaceView>('');
  const [byName, setByName] = useState(false);
  const [showing, setShowing] = useState<string | null>(null);
  const [valves, setValves] = useState<WorkspaceTool | null>(null);
  const [sharing, setSharing] = useState<AccessTarget | null>(null);
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
          { key: 'valves', label: 'Settings…', icon: 'cog-6-tooth' as const, onPress: () => setValves(tool) },
          { key: 'share', label: 'Share…', icon: 'users' as const, onPress: () => setSharing({ area: 'tools', id: tool.id, name: tool.name, grants: tool.accessGrants }) },
          { key: 'edit', label: 'Edit on the Web', icon: 'globe-alt' as const, onPress: () => openToolOnWeb(session.baseUrl, tool.id) },
        ]
      : []),
    ...(tool.fundingUrl ? [{ key: 'fund', label: 'Support the Author', icon: 'link' as const, onPress: () => void WebBrowser.openBrowserAsync(tool.fundingUrl) }] : []),
    ...(canExport ? [{ key: 'export', label: 'Export', icon: 'arrow-down-tray' as const, onPress: () => void exportTools(tool) }] : []),
    ...(tool.writeAccess ? [{ key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => remove(tool) }] : []),
  ];
  const more: MenuItem[] = [
    ...(capabilities?.isAdmin || capabilities?.can('workspace.tools_import') ? [{ key: 'import', label: 'Import on the Web', icon: 'globe-alt' as const, onPress: () => void WebBrowser.openBrowserAsync(`${session.baseUrl}/workspace/tools`) }] : []),
    ...(canExport ? [{ key: 'export', label: 'Export All', icon: 'arrow-down-tray' as const, onPress: () => void exportTools(null) }] : []),
  ];

  const header = (
    <View style={listStyles.top}>
      {tabs(tools.data?.length)}
      <ListControls query={query} setQuery={setQuery} placeholder="Search tools" view={view} setView={setView} byName={byName} setByName={setByName} onNew={canCreate ? () => openToolOnWeb(session.baseUrl, null) : undefined} more={more} />
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
      <ToolSheet id={showing} onClose={() => setShowing(null)} />
      <ToolValvesSheet tool={valves} onClose={() => setValves(null)} />
      <AccessSheet target={sharing} onClose={() => setSharing(null)} onSaved={refresh} />
    </View>
  );
}
