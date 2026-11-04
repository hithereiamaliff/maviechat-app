import { getAdminGroup, getAdminUser, getDefaultPermissions, groupMembers, listAdminGroups, listAdminUsers, listAllUsers, userAccess, type UserOrder } from '@maviechat/owui-protocol';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthed } from '@/lib/server';

/** Users, 30 a page, more as you scroll. */
export function useAdminUsers(query: { query: string; orderBy: UserOrder; direction: 'asc' | 'desc' }) {
  const { client } = useAuthed();
  return useInfiniteQuery({
    queryKey: ['admin', 'users', query],
    queryFn: ({ pageParam }) => listAdminUsers(client, { ...query, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (pages.reduce((sum, page) => sum + page.items.length, 0) < last.total && last.items.length ? pages.length + 1 : undefined),
    staleTime: 15_000,
  });
}

/** Everyone in brief: who's waiting for approval. */
export function useAllUsers() {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['admin', 'all-users'], queryFn: () => listAllUsers(client), staleTime: 15_000 });
}

/** The first account: the primary admin, whom only they may change. */
export function usePrimaryAdminId() {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['admin', 'primary'], queryFn: async () => (await listAdminUsers(client, { orderBy: 'created_at', direction: 'asc', page: 1 })).items[0]?.id ?? null, staleTime: 5 * 60_000 });
}

export function useAdminUser(id: string) {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['admin', 'user', id], queryFn: () => getAdminUser(client, id), enabled: Boolean(id), staleTime: 0 });
}

export function useUserAccess(id: string) {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['admin', 'user-access', id], queryFn: () => userAccess(client, id), enabled: Boolean(id), staleTime: 15_000 });
}

export function useAdminGroups() {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['admin', 'groups'], queryFn: () => listAdminGroups(client), staleTime: 15_000 });
}

export function useAdminGroup(id: string) {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['admin', 'group', id], queryFn: () => getAdminGroup(client, id), enabled: Boolean(id), staleTime: 0 });
}

export function useGroupMembers(id: string) {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['admin', 'group-members', id], queryFn: () => groupMembers(client, id), enabled: Boolean(id), staleTime: 0 });
}

export function useDefaultPermissions() {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['admin', 'default-permissions'], queryFn: () => getDefaultPermissions(client), staleTime: 0 });
}

/** After an admin change: everything the admin screens show, and your own permissions. */
export function useAdminRefresh(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
    void queryClient.invalidateQueries({ queryKey: ['session-user'] });
  };
}

/** Initials for someone without a picture. */
export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';

/** "3 min ago", "2 h ago", or a date. */
export function agoLabel(ms: number, now: number): string {
  if (!ms) return 'never';
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
