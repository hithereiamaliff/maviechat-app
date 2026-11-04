import { DtHttpError, type DtClient } from './http';

/*
 * Connected agents (DeepTutor 1.7.1, "My Agents"): an agent program on the DeepTutor server (Claude
 * Code, Codex and others) that a chat can consult. DeepTutor keeps each connection as a knowledge
 * base that only points at the agent (`metadata.type: subagent`); picking one in a chat runs that
 * program on the server. So lists of real knowledge bases leave them out, as DeepTutor's own do.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A knowledge-base row that is really a connected agent. */
export function isAgentConnection(row: unknown): boolean {
  return record(record(row).metadata).type === 'subagent';
}

export interface DtAgentConnection {
  name: string;
  /** `claude_code`, `codex`… */
  kind: string;
  /** The folder on the server it works in, or ''. */
  folder: string;
  description: string;
}

/** Your connected agents, or null when this server has its knowledge features off. */
export async function listAgentConnections(client: DtClient): Promise<DtAgentConnection[] | null> {
  try {
    const body = record(await client.get<unknown>('/api/subagents/connections'));
    return list(body.connections).flatMap((raw) => {
      const row = record(raw);
      const name = text(row.name);
      return name ? [{ name, kind: text(row.agent_kind), folder: text(row.cwd), description: text(row.description) }] : [];
    });
  } catch (error) {
    if (error instanceof DtHttpError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Connects an agent by kind, with no working folder. Nothing runs until a chat consults it; the
 * app itself only lists and disconnects (finding which agents the server has runs each program).
 */
export async function connectAgent(client: DtClient, input: { name: string; kind: string }): Promise<void> {
  await client.post<unknown>('/api/subagents/connections', { name: input.name, agent_kind: input.kind, cwd: '' });
}

/** Forgets a connection (the agent program itself is untouched). */
export async function disconnectAgent(client: DtClient, name: string): Promise<void> {
  await client.delete<unknown>(`/api/subagents/connections/${encodeURIComponent(name)}`);
}
