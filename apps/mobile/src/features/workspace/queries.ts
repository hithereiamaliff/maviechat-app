import {
  getWorkspaceKnowledge,
  getWorkspaceModel,
  getWorkspacePrompt,
  getWorkspaceSkill,
  getWorkspaceTool,
  listKnowledgeFiles,
  listPromptVersions,
  listWorkspaceKnowledge,
  listWorkspaceModels,
  listWorkspacePrompts,
  listWorkspaceSkills,
  listWorkspaceTools,
  pendingKnowledgeFiles,
  workspaceModelTags,
  workspacePromptTags,
  type KnowledgeFilesQuery,
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
/** Knowledge collections you can read (no tags either). */
export const useWorkspaceKnowledgeList = (query: Omit<WorkspaceListQuery, 'page' | 'tag'>) => usePagedList('knowledge', query, listWorkspaceKnowledge);

export function useWorkspaceKnowledge(id: string) {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['workspace', 'knowledge-base', id], queryFn: () => getWorkspaceKnowledge(client, id), enabled: Boolean(id), staleTime: 15_000 });
}

/** One folder of a collection: its files, 30 a page; its folders and the way down come with every page. */
export function useKnowledgeFiles(id: string, query: Omit<KnowledgeFilesQuery, 'page'>) {
  const { client } = useAuthed();
  return useInfiniteQuery({
    queryKey: ['workspace', 'knowledge-files', id, query],
    queryFn: ({ pageParam }) => listKnowledgeFiles(client, id, { ...query, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (pages.reduce((sum, page) => sum + page.files.length, 0) < last.total && last.files.length ? pages.length + 1 : undefined),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

/** Uploads the server is still reading for a collection, checked every few seconds while there are any (or while asked to). */
export function usePendingKnowledgeFiles(id: string, watching: boolean) {
  const { client } = useAuthed();
  return useQuery({
    queryKey: ['workspace', 'knowledge-pending', id],
    queryFn: () => pendingKnowledgeFiles(client, id),
    enabled: Boolean(id),
    refetchInterval: (query) => (watching || (query.state.data?.length ?? 0) > 0 ? 4000 : false),
    staleTime: 0,
  });
}

/** Every tool you can read (the server sends the whole list). */
export function useWorkspaceTools() {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['workspace', 'tools'], queryFn: () => listWorkspaceTools(client), staleTime: 15_000 });
}

export function useWorkspaceTool(id: string | null) {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['workspace', 'tool', id ?? ''], queryFn: () => getWorkspaceTool(client, id ?? ''), enabled: Boolean(id), staleTime: 0 });
}

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
