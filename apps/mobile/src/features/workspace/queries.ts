import { getWorkspaceModel, listWorkspaceModels, workspaceModelTags, type WorkspaceListQuery } from '@maviechat/owui-protocol';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthed } from '@/lib/server';

/** Workspace models you can read, 30 a page, more as you scroll. */
export function useWorkspaceModels(query: Omit<WorkspaceListQuery, 'page'>) {
  const { client } = useAuthed();
  return useInfiniteQuery({
    queryKey: ['workspace', 'models', query],
    queryFn: ({ pageParam }) => listWorkspaceModels(client, { ...query, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (pages.reduce((sum, page) => sum + page.items.length, 0) < last.total && last.items.length ? pages.length + 1 : undefined),
    staleTime: 15_000,
  });
}

export function useWorkspaceModelTags() {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['workspace', 'model-tags'], queryFn: () => workspaceModelTags(client), staleTime: 60_000 });
}

export function useWorkspaceModel(id: string | null) {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['workspace', 'model', id ?? ''], queryFn: () => getWorkspaceModel(client, id ?? ''), enabled: Boolean(id), staleTime: 0 });
}

/** After a model changes: the workspace lists, and the chat's model list (as the web refreshes it). */
export function useWorkspaceRefresh(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['workspace'] });
    void queryClient.invalidateQueries({ queryKey: ['models'] });
  };
}
