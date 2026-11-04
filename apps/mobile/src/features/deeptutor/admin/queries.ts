import { getBookPermission, getUserGrants, listAdminUsers } from '@maviechat/deeptutor-protocol';
import { useQuery } from '@tanstack/react-query';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';

export const PRESET_NAMES: Record<string, string> = { standard: 'Standard', learner: 'Learner', custom: 'Custom' };

/** Every account (admins only). */
export function useAdminUsers() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'admin', 'users'], queryFn: () => listAdminUsers(client), enabled: session.account.isAdmin, staleTime: 15_000 });
}

/** What an ordinary account has been given, and its book access. */
export function useUserGrants(userId: string, enabled: boolean) {
  const { client, session } = useDtAuthed();
  const grants = useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'admin', 'grants', userId], queryFn: () => getUserGrants(client, userId), enabled: enabled && Boolean(userId), staleTime: 30_000 });
  const books = useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'admin', 'books', userId], queryFn: () => getBookPermission(client, userId), enabled: enabled && Boolean(userId), staleTime: 30_000 });
  return { grants, books };
}

export const initials = (name: string): string =>
  name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || name.slice(0, 1).toUpperCase();
