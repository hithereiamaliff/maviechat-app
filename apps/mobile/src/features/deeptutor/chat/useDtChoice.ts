import { sameSelection, type DtLlmSelection } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { useDtChatTools, useDtLlmOptions } from '@/features/deeptutor/queries';

const isText = (value: unknown): value is string => typeof value === 'string';

function selectionOf(value: unknown): DtLlmSelection | null {
  if (typeof value !== 'object' || value === null) return null;
  const { profile_id: profileId, model_id: modelId } = value as Record<string, unknown>;
  return isText(profileId) && isText(modelId) && profileId && modelId ? { profile_id: profileId, model_id: modelId } : null;
}

/**
 * The tools and model a chat answers with: what you pick here, else what the session last
 * used (its saved preferences), else no tools and the account's default model.
 */
export function useDtChoice(preferences: Record<string, unknown> | null | undefined) {
  const llm = useDtLlmOptions();
  const tools = useDtChatTools();
  const [pickedTools, setPickedTools] = useState<string[] | null>(null);
  const [pickedModel, setPickedModel] = useState<DtLlmSelection | null>(null);

  const savedTools = Array.isArray(preferences?.tools) ? preferences.tools.filter(isText) : null;
  const savedModel = selectionOf(preferences?.llm_selection);
  const options = llm.data?.options;
  const usable = (selection: DtLlmSelection | null) => (selection && options?.some((option) => sameSelection(option, selection)) ? selection : null);
  const model = usable(pickedModel) ?? usable(savedModel) ?? llm.data?.active ?? null;
  const selectedTools = pickedTools ?? savedTools ?? [];

  return {
    tools: tools.data,
    models: options,
    selectedTools,
    setSelectedTools: setPickedTools,
    model,
    setModel: setPickedModel,
    /** The choice as a turn sends it. */
    request: { tools: selectedTools, llmSelection: model },
  };
}
