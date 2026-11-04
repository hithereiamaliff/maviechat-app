import { getMcpState, type DtMcpServer, type DtMcpState, type DtMcpStatus } from '@maviechat/deeptutor-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette, type Palette } from '@/theme';

/** Your MCP servers' state (reading it makes DeepTutor connect to them, as its page does). */
export function useMcpState() {
  const { client, session } = useDtAuthed();
  return useQuery({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'mcp'], queryFn: () => getMcpState(client), staleTime: 15_000 });
}

/** Every change answers with the whole state: keep it, and what lists servers for chats. */
export function useMcpStateSetter(): (state: DtMcpState) => void {
  const queryClient = useQueryClient();
  const { session } = useDtAuthed();
  return (state) => {
    queryClient.setQueryData([DT_QUERY_ROOT, session.baseUrl, 'mcp'], state);
    void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'chat-resources'] });
  };
}

const WORDS: Record<DtMcpStatus, string> = { connected: 'Connected', connecting: 'Connecting', error: 'Not connecting', needs_auth: 'Needs sign-in', disabled: 'Off' };

function statusColor(status: DtMcpStatus, palette: Palette): string {
  if (status === 'connected') return palette.success;
  if (status === 'error') return palette.danger;
  if (status === 'disabled') return palette.textFaint;
  return palette.warning;
}

export function McpStatus({ status }: { status: DtMcpStatus }) {
  const palette = usePalette();
  return (
    <View style={styles.status}>
      <View style={[styles.dot, { backgroundColor: statusColor(status, palette) }]} />
      <Text style={[styles.statusText, { color: palette.textMuted }]}>{WORDS[status]}</Text>
    </View>
  );
}

/** A tool's own name, without the `mcp_<server>_` DeepTutor puts in front. */
export function bareToolName(server: Pick<DtMcpServer, 'name'>, tool: string): string {
  const prefix = `mcp_${server.name.replace(/[^A-Za-z0-9_]/g, '_')}_`;
  return tool.startsWith(prefix) ? tool.slice(prefix.length) : tool;
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontFamily: fonts.regular, fontSize: 12 },
});
