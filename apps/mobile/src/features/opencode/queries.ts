import { getDefaultModel, getMachine, getProviders, isGitFolder, listAgents, setDefaultModel, listFiles, listProjects, listSessions, pickableAgents, type Model } from '@maviechat/opencode-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOcAuthed } from '@/session/OpenCodeProvider';
import { OC_QUERY_ROOT } from '@/session/queryRoots';
import type { ModelChoice } from './models';

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

/** Whether a project folder is in a git repository, the only place OpenCode lists what it changed (null: not known). */
export function useGitFolder(directory: string | null) {
  const { client, accountId } = useOcAuthed();
  return useQuery({
    queryKey: ocKey(accountId, 'git', directory),
    queryFn: () => isGitFolder(client, directory ?? ''),
    enabled: Boolean(directory),
    staleTime: 5 * 60_000,
  });
}

/** Every model this OpenCode can use, and the machine's default: what it uses until one is picked. */
export function useOcModels(directory: string | null) {
  const { client, accountId } = useOcAuthed();
  return useQuery({
    queryKey: ocKey(accountId, 'models', directory),
    queryFn: async () => {
      const [result, defaultModel] = await Promise.all([
        getProviders(client, directory ?? ''),
        // A gateway from before 2026-11-04 doesn't pass the config on; the composer then says "Default model".
        getDefaultModel(client, directory ?? '').catch(() => null),
      ]);
      const models: ModelChoice[] = result.providers.flatMap((provider) =>
        Object.values(provider.models)
          .filter((model: Model) => model.status !== 'deprecated')
          .map((model: Model) => ({ providerID: provider.id, modelID: model.id, name: model.name || model.id, provider: provider.name })),
      );
      return { models, defaultModel };
    },
    enabled: Boolean(directory),
    staleTime: 5 * 60_000,
  });
}

/** Makes a model this machine's default; every project's default is then read again. */
export function useSetDefaultModel() {
  const { client, accountId } = useOcAuthed();
  const queryClient = useQueryClient();
  return async (model: { providerID: string; modelID: string }) => {
    const saved = await setDefaultModel(client, model);
    await queryClient.invalidateQueries({ queryKey: ocKey(accountId, 'models') });
    return saved;
  };
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
