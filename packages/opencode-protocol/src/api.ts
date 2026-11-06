import { OcHttpError, OcNetworkError, type FetchLike, type OcClient } from './http';
import type {
  Agent,
  FileDiff,
  FileNode,
  Machine,
  MessageWithParts,
  PairedDevice,
  PermissionReply,
  PermissionRequest,
  Project,
  Providers,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from './types';

/** What pairing hands back: the device token (shown once) and the machine it belongs to. */
export interface Pairing {
  deviceId: string;
  token: string;
  machine: { name: string; url: string };
}

/** A pairing link's parts: `maviechat://pair?url=…&code=…`, or just an address and a code. */
export function parsePairingLink(text: string): { url: string; code: string } | null {
  const trimmed = text.trim();
  const query = trimmed.includes('?') ? trimmed.slice(trimmed.indexOf('?') + 1) : '';
  if (!/^maviechat:\/\/pair\b/i.test(trimmed) || !query) return null;
  const params = new URLSearchParams(query);
  const url = params.get('url')?.trim() ?? '';
  const code = params.get('code')?.trim() ?? '';
  return /^https:\/\/[^\s/]+/i.test(url) && code ? { url: url.replace(/\/+$/, ''), code } : null;
}

/** Trades a pairing code for a device token. */
export async function pairDevice(fetchImpl: FetchLike, gatewayUrl: string, code: string, deviceName: string): Promise<Pairing> {
  const base = gatewayUrl.trim().replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetchImpl(`${base}/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code: code.trim(), deviceName }),
    });
  } catch (error) {
    throw new OcNetworkError('/v1/pair', error, false);
  }
  const body = (await response.json().catch(() => ({}))) as Partial<Pairing> & { error?: string };
  if (!response.ok) throw new OcHttpError(response.status, body.error, '/v1/pair');
  if (typeof body.token !== 'string' || typeof body.deviceId !== 'string' || !body.machine) throw new OcHttpError(502, 'The machine answered pairing oddly', '/v1/pair');
  return { deviceId: body.deviceId, token: body.token, machine: body.machine };
}

export const getMachine = (client: OcClient) => client.request<Machine>('GET', '/v1/machine');
export const listDevices = (client: OcClient) => client.request<PairedDevice[]>('GET', '/v1/devices');
export const revokeDevice = (client: OcClient, id: string) => client.request<{ revoked: boolean }>('DELETE', `/v1/devices/${encodeURIComponent(id)}`);

/** Top-level sessions of a project, newest first (OpenCode's order). */
export const listSessions = (client: OcClient, directory: string, options: { search?: string; limit?: number } = {}) =>
  client.oc<Session[]>('GET', '/session', { query: { directory, roots: true, search: options.search || undefined, limit: options.limit } });

export const getSession = (client: OcClient, directory: string, id: string) => client.oc<Session>('GET', `/session/${encodeURIComponent(id)}`, { query: { directory } });

/** A new session. The gateway adds "ask before changes" unless `approvals` is false. */
export const createSession = (client: OcClient, directory: string, input: { title?: string; agent?: string; model?: { id: string; providerID: string } }, approvals = true) =>
  client.oc<Session>('POST', '/session', { query: { directory }, body: input, headers: approvals ? {} : { 'x-maviechat-approvals': 'off' } });

export const renameSession = (client: OcClient, directory: string, id: string, title: string) => client.oc<Session>('PATCH', `/session/${encodeURIComponent(id)}`, { query: { directory }, body: { title } });

export const deleteSession = (client: OcClient, directory: string, id: string) => client.oc<boolean>('DELETE', `/session/${encodeURIComponent(id)}`, { query: { directory } });

export const getMessages = (client: OcClient, directory: string, id: string, options: { limit?: number; before?: string } = {}) =>
  client.oc<MessageWithParts[]>('GET', `/session/${encodeURIComponent(id)}/message`, { query: { directory, limit: options.limit, before: options.before } });

export interface PromptInput {
  text: string;
  /** Photos and files as data URLs. */
  files?: { mime: string; filename: string; url: string }[];
  model?: { providerID: string; modelID: string };
  agent?: string;
}

/**
 * Sends a prompt. OpenCode answers at once and works on; the reply arrives on the event stream.
 * With this phone's push token, the machine notifies it when the session finishes or needs you.
 */
export const sendPrompt = (client: OcClient, directory: string, id: string, input: PromptInput, options: { pushToken?: string | null } = {}) =>
  client.oc<void>('POST', `/session/${encodeURIComponent(id)}/prompt_async`, {
    query: { directory },
    body: {
      parts: [{ type: 'text', text: input.text }, ...(input.files ?? []).map((file) => ({ type: 'file', ...file }))],
      ...(input.model ? { model: input.model } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
    },
    headers: options.pushToken ? { 'x-maviechat-push': options.pushToken } : {},
    timeoutMs: 120_000,
  });

export const abortSession = (client: OcClient, directory: string, id: string) => client.oc<boolean>('POST', `/session/${encodeURIComponent(id)}/abort`, { query: { directory } });

export const getStatuses = (client: OcClient, directory: string) => client.oc<Record<string, SessionStatus>>('GET', '/session/status', { query: { directory } });
export const getDiff = (client: OcClient, directory: string, id: string) => client.oc<FileDiff[]>('GET', `/session/${encodeURIComponent(id)}/diff`, { query: { directory } });
export const getTodos = (client: OcClient, directory: string, id: string) => client.oc<Todo[]>('GET', `/session/${encodeURIComponent(id)}/todo`, { query: { directory } });

export const listPermissions = (client: OcClient, directory: string) => client.oc<PermissionRequest[]>('GET', '/permission', { query: { directory } });
export const replyPermission = (client: OcClient, directory: string, requestID: string, reply: PermissionReply) =>
  client.oc<boolean>('POST', `/permission/${encodeURIComponent(requestID)}/reply`, { query: { directory }, body: { reply } });

export const listQuestions = (client: OcClient, directory: string) => client.oc<QuestionRequest[]>('GET', '/question', { query: { directory } });
/** One answer (the chosen labels) per question, in order. */
export const answerQuestion = (client: OcClient, directory: string, requestID: string, answers: string[][]) =>
  client.oc<boolean>('POST', `/question/${encodeURIComponent(requestID)}/reply`, { query: { directory }, body: { answers } });
export const rejectQuestion = (client: OcClient, directory: string, requestID: string) => client.oc<boolean>('POST', `/question/${encodeURIComponent(requestID)}/reject`, { query: { directory } });

export const getProviders = (client: OcClient, directory: string) => client.oc<Providers>('GET', '/config/providers', { query: { directory } });

/** A model named `provider/model` as its two ids; the model part may hold more slashes. */
export function parseModelRef(ref: unknown): { providerID: string; modelID: string } | null {
  if (typeof ref !== 'string') return null;
  const slash = ref.indexOf('/');
  return slash > 0 && slash < ref.length - 1 ? { providerID: ref.slice(0, slash), modelID: ref.slice(slash + 1) } : null;
}

/** The model a project uses when none is picked: its config's `model`, the one setting the gateway passes on. */
export const getDefaultModel = async (client: OcClient, directory: string) => parseModelRef((await client.oc<{ model?: unknown }>('GET', '/config', { query: { directory } })).model);

/**
 * Makes a model the machine's default. OpenCode writes it to its global settings and reloads its
 * projects, so a reply running then stops. Answers with the default as it now stands.
 */
export const setDefaultModel = async (client: OcClient, model: { providerID: string; modelID: string }) =>
  parseModelRef((await client.oc<{ model?: unknown }>('PATCH', '/global/config', { body: { model: `${model.providerID}/${model.modelID}` } })).model);
export const listAgents = (client: OcClient, directory: string) => client.oc<Agent[]>('GET', '/agent', { query: { directory } });
export const listProjects = (client: OcClient, directory: string) => client.oc<Project[]>('GET', '/project', { query: { directory } });

/**
 * Whether a folder lies in a git repository, the only place OpenCode keeps what each reply changed.
 * OpenCode's `/path` names the folder's repository root as `worktree`, or "/" for a plain folder.
 * Null when its answer doesn't say.
 */
export const isGitFolder = async (client: OcClient, directory: string): Promise<boolean | null> => {
  const { worktree } = await client.oc<{ worktree?: unknown }>('GET', '/path', { query: { directory } });
  return typeof worktree === 'string' && worktree !== '' ? worktree !== '/' : null;
};

/** A folder's contents (relative `path`, empty for the project itself). */
export const listFiles = (client: OcClient, directory: string, path = '') => client.oc<FileNode[]>('GET', '/file', { query: { directory, path } });

/** The agents you pick for a prompt: primary ones that aren't hidden. */
export const pickableAgents = (agents: Agent[]): Agent[] => agents.filter((agent) => agent.mode !== 'subagent' && !agent.hidden);
