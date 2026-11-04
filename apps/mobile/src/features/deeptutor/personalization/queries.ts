import { getCliApps, getPersona, getSkill, listAgentConnections, listPersonas, listSkills, listSkillTags } from '@maviechat/deeptutor-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';

/** Personalization is the account's (the same in every workspace), so its queries share one root. */
function usePersonalizationKey() {
  const { session } = useDtAuthed();
  return (...rest: string[]) => [DT_QUERY_ROOT, session.baseUrl, 'personalization', ...rest];
}

export function usePersonas() {
  const { client } = useDtAuthed();
  const key = usePersonalizationKey();
  return useQuery({ queryKey: key('personas'), queryFn: () => listPersonas(client), staleTime: 30_000 });
}

export function usePersonaFile(name: string | null) {
  const { client } = useDtAuthed();
  const key = usePersonalizationKey();
  return useQuery({ queryKey: key('persona', name ?? ''), queryFn: () => getPersona(client, name ?? ''), enabled: Boolean(name), staleTime: 0 });
}

export function useSkills() {
  const { client } = useDtAuthed();
  const key = usePersonalizationKey();
  return useQuery({ queryKey: key('skills'), queryFn: () => listSkills(client), staleTime: 30_000 });
}

export function useSkillFile(name: string | null) {
  const { client } = useDtAuthed();
  const key = usePersonalizationKey();
  return useQuery({ queryKey: key('skill', name ?? ''), queryFn: () => getSkill(client, name ?? ''), enabled: Boolean(name), staleTime: 0 });
}

export function useSkillTags() {
  const { client } = useDtAuthed();
  const key = usePersonalizationKey();
  return useQuery({ queryKey: key('skill-tags'), queryFn: () => listSkillTags(client), staleTime: 30_000 });
}

export function useAgentConnections() {
  const { client } = useDtAuthed();
  const key = usePersonalizationKey();
  return useQuery({ queryKey: key('agents'), queryFn: () => listAgentConnections(client), staleTime: 30_000 });
}

export function useCliApps() {
  const { client } = useDtAuthed();
  const key = usePersonalizationKey();
  return useQuery({ queryKey: key('cli-apps'), queryFn: () => getCliApps(client), staleTime: 30_000 });
}

/** Reads Personalization again (and the skills a partner can be given, which come from the same list). */
export function usePersonalizationRefresh(): () => void {
  const queryClient = useQueryClient();
  const { session } = useDtAuthed();
  return () => {
    void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'personalization'] });
    void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'partners', 'skills'] });
  };
}
