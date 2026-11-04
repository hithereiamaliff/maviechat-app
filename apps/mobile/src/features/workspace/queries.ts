import {
  getWorkspaceModel,
  getWorkspacePrompt,
  getWorkspaceSkill,
  listPromptVersions,
  listWorkspaceModels,
  listWorkspacePrompts,
  listWorkspaceSkills,
  workspaceModelTags,
  workspacePromptTags,
  type OwuiClient,
  type WorkspaceListQuery,
} from '@maviechat/owui-protocol';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthed } from '@/lib/server';

type Page<T> = { items: T[]; total: number };

/** One Workspace list, 30 a page (from 1), more as you scroll. */
function usePagedList<T>(area: string, query: Omit<WorkspaceListQuery, 'page'>, fetch: (client: OwuiClient, query: WorkspaceListQuery) => Promise<Page<T>>) {
  const { client } = useAuthed();
  return useInfiniteQuery({
    queryKey: ['workspace', area, query],
    queryFn: ({ pageParam }) => fetch(client, { ...query, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last: Page<T>, pages: Page<T>[]) => (pages.reduce((sum, page) => sum + page.items.length, 0) < last.total && last.items.length ? pages.length + 1 : undefined),
    staleTime: 15_000,
  });
}

/** Workspace models you can read. */
export const useWorkspaceModels = (query: Omit<WorkspaceListQuery, 'page'>) => usePagedList('models', query, listWorkspaceModels);
/** Workspace prompts you can read. */
export const useWorkspacePrompts = (query: Omit<WorkspaceListQuery, 'page'>) => usePagedList('prompts', query, listWorkspacePrompts);
/** Workspace skills you can read (they have no tags to filter by). */
export const useWorkspaceSkills = (query: Omit<WorkspaceListQuery, 'page' | 'tag'>) => usePagedList('skills', query, listWorkspaceSkills);

export function useWorkspaceModelTags() {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['workspace', 'model-tags'], queryFn: () => workspaceModelTags(client), staleTime: 60_000 });
}

export function useWorkspacePromptTags() {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['workspace', 'prompt-tags'], queryFn: () => workspacePromptTags(client), staleTime: 60_000 });
}

export function useWorkspaceModel(id: string | null) {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['workspace', 'model', id ?? ''], queryFn: () => getWorkspaceModel(client, id ?? ''), enabled: Boolean(id), staleTime: 0 });
}

export function useWorkspacePrompt(id: string | null) {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['workspace', 'prompt', id ?? ''], queryFn: () => getWorkspacePrompt(client, id ?? ''), enabled: Boolean(id), staleTime: 0 });
}

/** A prompt's saved versions, newest first, 20 a page (from 0). */
export function usePromptVersions(id: string | null) {
  const { client } = useAuthed();
  return useInfiniteQuery({
    queryKey: ['workspace', 'prompt-versions', id ?? ''],
    queryFn: ({ pageParam }) => listPromptVersions(client, id ?? '', pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length >= 20 ? pages.length : undefined),
    enabled: Boolean(id),
    staleTime: 0,
  });
}

export function useWorkspaceSkill(id: string | null) {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['workspace', 'skill', id ?? ''], queryFn: () => getWorkspaceSkill(client, id ?? ''), enabled: Boolean(id), staleTime: 0 });
}

/**
 * After a Workspace item changes: the Workspace lists and pickers, the chat's model list (as the
 * web refreshes it after a model changes), and the chat's `/` prompts.
 */
export function useWorkspaceRefresh(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['workspace'] });
    void queryClient.invalidateQueries({ queryKey: ['models'] });
    void queryClient.invalidateQueries({ queryKey: ['prompts'] });
  };
}
