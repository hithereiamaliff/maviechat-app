import type { DtClient } from './http';
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

export function sameSelection(a: DtLlmSelection | null | undefined, b: DtLlmSelection | null | undefined): boolean {
  return Boolean(a && b && a.profile_id === b.profile_id && a.model_id === b.model_id);
}
