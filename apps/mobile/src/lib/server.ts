import {
  buildCapabilities,
  getConfig,
  getSessionUser,
  getUserSettings,
  getVersion,
  listModels,
  listTools,
  type Capabilities,
  type OwuiClient,
  type SupportStatus,
  listPrompts,
  searchKnowledgeBases,
  searchKnowledgeFiles,
} from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useSession } from '@/session/SessionProvider';
import type { StoredSession } from '@/session/stored-session';

/** The signed-in client and session. Only for screens behind the (app) layout's sign-in guard. */
export function useAuthed(): { client: OwuiClient; session: StoredSession } {
  const { state, client } = useSession();
  if (state.status !== 'signed-in' || !client) throw new Error('useAuthed outside a signed-in screen');
  return { client, session: state.session };
}

export function useServerVersion() {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['version'], queryFn: () => getVersion(client), staleTime: 5 * 60_000 });
}

export function useServerConfig() {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['config'], queryFn: () => getConfig(client), staleTime: 5 * 60_000 });
}

export function useSessionUser() {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['session-user'], queryFn: () => getSessionUser(client), staleTime: 5 * 60_000 });
}

export function useModels() {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['models'], queryFn: () => listModels(client), staleTime: 5 * 60_000 });
}

export function useUserSettings() {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['user-settings'], queryFn: () => getUserSettings(client), staleTime: 5 * 60_000 });
}

/** Tools this account can switch on for a message (empty when it may use none). */
export function useTools() {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['tools'], queryFn: () => listTools(client), staleTime: 5 * 60_000 });
}

/** Server features for this user (flag + permission), once config and session are loaded. */
export function useCapabilities(): Capabilities | null {
  const config = useServerConfig();
  const user = useSessionUser();
  const version = useServerVersion();
  return useMemo(
    () =>
      config.data && user.data
        ? buildCapabilities({ config: config.data, user: user.data, version: version.data?.version })
        : null,
    [config.data, user.data, version.data?.version],
  );
}

/** How this server's version compares with what MavieChat was tested against, in words. */
export function supportLabel(status: SupportStatus | undefined): string {
  switch (status) {
    case 'supported':
      return 'tested';
    case 'newer-than-validated':
      return 'newer than MavieChat has been tested with';
    case 'too-old':
      return 'older than MavieChat supports';
    default:
      return 'checking…';
  }
}

/** Your saved prompts, for the input's `/` menu. */
export function usePrompts(enabled: boolean) {
  const { client } = useAuthed();
  return useQuery({ queryKey: ['prompts'], queryFn: () => listPrompts(client), enabled, staleTime: 60_000 });
}

/** Knowledge bases and their files matching what you typed after `@` or `#`. */
export function useKnowledgeSearch(query: string, enabled: boolean) {
  const { client } = useAuthed();
  return useQuery({
    queryKey: ['knowledge-search', query],
    queryFn: async () => {
      const [bases, files] = await Promise.all([searchKnowledgeBases(client, query).catch(() => []), searchKnowledgeFiles(client, query).catch(() => [])]);
      return [...bases, ...files];
    },
    enabled,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}
