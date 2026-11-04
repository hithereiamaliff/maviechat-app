import { getMachine, getProviders, listAgents, listFiles, listProjects, listSessions, pickableAgents, type Model } from '@maviechat/opencode-protocol';
import { useQuery } from '@tanstack/react-query';
import { useOcAuthed } from '@/session/OpenCodeProvider';
import { OC_QUERY_ROOT } from '@/session/queryRoots';

/** Every OpenCode query key: the space's root, then the account, then what it is. */
export const ocKey = (accountId: string, ...rest: unknown[]) => [OC_QUERY_ROOT, accountId, ...rest];

export function useMachine() {
  const { client, accountId } = useOcAuthed();
  return useQuery({ queryKey: ocKey(accountId, 'machine'), queryFn: () => getMachine(client), staleTime: 60_000 });
}

export function useOcSessions(directory: string | null, search = '') {
  const { client, accountId } = useOcAuthed();
  return useQuery({
    queryKey: ocKey(accountId, 'sessions', directory, search),
    queryFn: () => listSessions(client, directory ?? '', { search, limit: 100 }),
    enabled: Boolean(directory),
  });
}

/** Projects OpenCode has opened before, inside the folders this machine allows. */
export function useOcProjects(folders: string[] | undefined) {
  const { client, accountId } = useOcAuthed();
  const anchor = folders?.[0] ?? null;
  return useQuery({
    queryKey: ocKey(accountId, 'projects'),
    queryFn: async () => {
      const projects = await listProjects(client, anchor ?? '');
      return projects.filter((project) => (folders ?? []).some((folder) => project.worktree === folder || project.worktree.startsWith(`${folder}/`)));
    },
    enabled: Boolean(anchor),
    staleTime: 60_000,
  });
}

/** A folder's subfolders (for picking a project), skipping ignored and hidden ones. */
export function useSubfolders(root: string | null) {
  const { client, accountId } = useOcAuthed();
  return useQuery({
    queryKey: ocKey(accountId, 'folders', root),
    queryFn: async () => (await listFiles(client, root ?? '', '')).filter((node) => node.type === 'directory' && !node.ignored && !node.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name)),
    enabled: Boolean(root),
    staleTime: 60_000,
  });
}

export interface ModelChoice {
  providerID: string;
  modelID: string;
  name: string;
  provider: string;
}

/** Every model this OpenCode can use. Until one is picked, OpenCode uses its own default. */
export function useOcModels(directory: string | null) {
  const { client, accountId } = useOcAuthed();
  return useQuery({
    queryKey: ocKey(accountId, 'models', directory),
    queryFn: async () => {
      const result = await getProviders(client, directory ?? '');
      const models: ModelChoice[] = result.providers.flatMap((provider) =>
        Object.values(provider.models)
          .filter((model: Model) => model.status !== 'deprecated')
          .map((model: Model) => ({ providerID: provider.id, modelID: model.id, name: model.name || model.id, provider: provider.name })),
      );
      return { models };
    },
    enabled: Boolean(directory),
    staleTime: 5 * 60_000,
  });
}

export function useOcAgents(directory: string | null) {
  const { client, accountId } = useOcAuthed();
  return useQuery({
    queryKey: ocKey(accountId, 'agents', directory),
    queryFn: async () => pickableAgents(await listAgents(client, directory ?? '')),
    enabled: Boolean(directory),
    staleTime: 5 * 60_000,
  });
}

/** The last part of a folder path, for titles ("maviechat-app"). */
export const folderName = (directory: string) => directory.replace(/\/+$/, '').split('/').pop() || directory;
