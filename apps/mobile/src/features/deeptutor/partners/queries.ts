import { getPartner, listPartnerGroups, listPartners, listPartnerSessions, listSkillNames, listSouls, recentPartnerConversations } from '@maviechat/deeptutor-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';

/** Your partners and those shared with you; read again every 15 s while shown (running dots change). */
export function useDtPartners() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners', 'list'], queryFn: () => listPartners(client), refetchInterval: 15_000 });
}

export function useDtPartner(id: string) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners', 'one', id], queryFn: () => getPartner(client, id), enabled: Boolean(id), retry: false });
}

/** Your partner groups (their pages are DeepTutor's own until B6.3). */
export function useDtPartnerGroups() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners', 'groups'], queryFn: () => listPartnerGroups(client), staleTime: 15_000 });
}

/** Your latest conversations with partners and groups. */
export function useDtPartnerRecent() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners', 'recent'], queryFn: () => recentPartnerConversations(client), refetchInterval: 15_000 });
}

/** A partner's conversations (archived ones and chat apps' too). */
export function useDtPartnerSessions(id: string, enabled = true) {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners', 'sessions', id], queryFn: () => listPartnerSessions(client, id), enabled: Boolean(id) && enabled });
}

export function useDtSouls() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners', 'souls'], queryFn: () => listSouls(client), staleTime: 5 * 60_000 });
}

export function useDtSkillNames() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners', 'skills'], queryFn: () => listSkillNames(client), staleTime: 5 * 60_000 });
}

/** Reads every Partners list again (after a change). */
export function usePartnersRefresh(): () => void {
  const { session } = useDtAuthed();
  const queryClient = useQueryClient();
  return useCallback(() => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners'] }), [queryClient, session.baseUrl]);
}
