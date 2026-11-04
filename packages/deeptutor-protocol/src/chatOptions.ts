import type { DtClient } from './http';
import { isAgentConnection } from './subagents';
import type { DtLlmSelection } from './turns';

/** A model the account may use (an admin grants them). */
export interface DtLlmOption extends DtLlmSelection {
  label: string;
  profileName: string;
  isDefault: boolean;
}

/** `GET /api/settings/llm-options`: the account's models and the one used when none is chosen. */
export async function getLlmOptions(client: DtClient): Promise<{ active: DtLlmSelection | null; options: DtLlmOption[] }> {
  const response = await client.get<{ active?: Partial<DtLlmSelection> | null; options?: Record<string, unknown>[] }>('/api/settings/llm-options');
  const options = (response.options ?? []).flatMap((item): DtLlmOption[] => {
    const profileId = typeof item.profile_id === 'string' ? item.profile_id : '';
    const modelId = typeof item.model_id === 'string' ? item.model_id : '';
    if (!profileId || !modelId) return [];
    const label = [item.label, item.model_name, item.model].find((value): value is string => typeof value === 'string' && value.trim() !== '') ?? modelId;
    return [{ profile_id: profileId, model_id: modelId, label, profileName: typeof item.profile_name === 'string' ? item.profile_name : '', isDefault: item.is_active_default === true }];
  });
  const active = response.active?.profile_id && response.active.model_id ? { profile_id: response.active.profile_id, model_id: response.active.model_id } : null;
  return { active, options };
}

/** A tool the chat composer can switch on for a turn. */
export interface DtChatTool {
  name: string;
  description: string;
}

/** `GET /api/tools`, narrowed to the ones a chat can switch on: optional, available and not tied to another mode. */
export async function listChatTools(client: DtClient): Promise<DtChatTool[]> {
  const response = await client.get<{ tools?: Record<string, unknown>[] }>('/api/tools');
  return (response.tools ?? []).flatMap((tool): DtChatTool[] => {
    if (typeof tool.name !== 'string' || tool.toggleable !== true || tool.available === false || tool.enabled === false || tool.coming_soon === true) return [];
    if (typeof tool.capability === 'string' && tool.capability) return [];
    return [{ name: tool.name, description: typeof tool.description === 'string' ? tool.description : '' }];
  });
}

/** A DeepTutor mode ("capability") the server offers, with its setting defaults. */
export interface DtMode {
  id: string;
  description: string;
  defaults: Record<string, unknown>;
}

/** `GET /api/capabilities/registered`: the turn modes the server offers. */
export async function listModes(client: DtClient): Promise<DtMode[]> {
  const response = await client.get<{ capabilities?: Record<string, unknown>[] }>('/api/capabilities/registered');
  return (response.capabilities ?? []).flatMap((item): DtMode[] => {
    if (typeof item.id !== 'string' || item.kind !== 'turn' || item.available === false) return [];
    const manifest = (item.manifest ?? {}) as Record<string, unknown>;
    return [
      {
        id: item.id,
        description: typeof manifest.description === 'string' ? manifest.description : '',
        defaults: typeof manifest.config_defaults === 'object' && manifest.config_defaults !== null ? (manifest.config_defaults as Record<string, unknown>) : {},
      },
    ];
  });
}

/** Saves answered Quiz questions to the session (DeepTutor adds them as your message and to its question bank). */
export async function saveQuizResults(
  client: DtClient,
  sessionId: string,
  turnId: string,
  answers: {
    question_id: string;
    question: string;
    question_type: string;
    options: Record<string, string>;
    user_answer: string;
    correct_answer: string;
    explanation: string;
    difficulty: string;
    is_correct: boolean;
  }[],
): Promise<void> {
  await client.post(`/api/sessions/${encodeURIComponent(sessionId)}/quiz-results`, { turn_id: turnId, answers });
}

export function sameSelection(a: DtLlmSelection | null | undefined, b: DtLlmSelection | null | undefined): boolean {
  return Boolean(a && b && a.profile_id === b.profile_id && a.model_id === b.model_id);
}

/** A knowledge base a turn can search (DeepTutor needs an embedding model to build one). */
export interface DtKnowledgeBase {
  name: string;
  isDefault: boolean;
  /** "ready" once indexed; DeepTutor's own words otherwise. */
  status: string;
}

/** `GET /api/knowledge-bases`: the account's knowledge bases. */
export async function listKnowledgeBases(client: DtClient): Promise<DtKnowledgeBase[]> {
  const response = await client.get<unknown>('/api/knowledge-bases');
  const list = Array.isArray(response) ? response : [];
  return list.flatMap((item): DtKnowledgeBase[] => {
    const kb = (item ?? {}) as Record<string, unknown>;
    // A connected agent is kept as a knowledge base too; picking one would run it on the server.
    if (typeof kb.name !== 'string' || !kb.name || kb.available === false || isAgentConnection(kb)) return [];
    return [{ name: kb.name, isDefault: kb.is_default === true, status: typeof kb.status === 'string' ? kb.status : '' }];
  });
}

export interface DtAttachmentLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
}

/** DeepTutor's own defaults, used until (or if) the server's are read. */
export const DEFAULT_ATTACHMENT_LIMITS: DtAttachmentLimits = { maxFileBytes: 20 * 1024 * 1024, maxTotalBytes: 25 * 1024 * 1024 };

/** `GET /api/settings/chat-attachments`: how large a message's attachments may be. */
export async function getAttachmentLimits(client: DtClient): Promise<DtAttachmentLimits> {
  const response = await client.get<{ effective?: { max_file_bytes?: unknown; max_total_bytes?: unknown } }>('/api/settings/chat-attachments');
  const file = response.effective?.max_file_bytes;
  const total = response.effective?.max_total_bytes;
  return {
    maxFileBytes: typeof file === 'number' && file > 0 ? file : DEFAULT_ATTACHMENT_LIMITS.maxFileBytes,
    maxTotalBytes: typeof total === 'number' && total > 0 ? total : DEFAULT_ATTACHMENT_LIMITS.maxTotalBytes,
  };
}
