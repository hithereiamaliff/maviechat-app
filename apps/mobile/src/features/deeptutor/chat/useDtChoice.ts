import { sameSelection, type DtLlmSelection, type DtTurnRequest } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { useDtChatTools, useDtKnowledgeBases, useDtLlmOptions, useDtModes } from '@/features/deeptutor/queries';
import { isNativeCapability, modeConfig, NATIVE_MODES } from './capabilities';

const isText = (value: unknown): value is string => typeof value === 'string';

function selectionOf(value: unknown): DtLlmSelection | null {
  if (typeof value !== 'object' || value === null) return null;
  const { profile_id: profileId, model_id: modelId } = value as Record<string, unknown>;
  return isText(profileId) && isText(modelId) && profileId && modelId ? { profile_id: profileId, model_id: modelId } : null;
}

/**
 * How a chat answers: its mode and that mode's settings, its tools and model. What you pick
 * here wins, else what the session last used (its saved preferences), else Chat with no
 * tools and the account's default model.
 */
export function useDtChoice(preferences: Record<string, unknown> | null | undefined, sessionMode?: string) {
  const llm = useDtLlmOptions();
  const tools = useDtChatTools();
  const modes = useDtModes();
  const knowledgeBases = useDtKnowledgeBases();
  const [pickedTools, setPickedTools] = useState<string[] | null>(null);
  const [pickedKnowledgeBases, setPickedKnowledgeBases] = useState<string[] | null>(null);
  const [pickedModel, setPickedModel] = useState<DtLlmSelection | null>(null);
  const [pickedMode, setPickedMode] = useState<string | null>(null);
  const [settings, setSettings] = useState<Record<string, Record<string, unknown>>>({});

  const savedTools = Array.isArray(preferences?.tools) ? preferences.tools.filter(isText) : null;
  const savedModel = selectionOf(preferences?.llm_selection);
  const options = llm.data?.options;
  const usable = (selection: DtLlmSelection | null) => (selection && options?.some((option) => sameSelection(option, selection)) ? selection : null);
  const model = usable(pickedModel) ?? usable(savedModel) ?? llm.data?.active ?? null;
  const selectedTools = pickedTools ?? savedTools ?? [];
  const savedKnowledgeBases = Array.isArray(preferences?.knowledge_bases) ? preferences.knowledge_bases.filter(isText) : null;
  const selectedKnowledgeBases = pickedKnowledgeBases ?? savedKnowledgeBases ?? [];
  // Modes the server offers that the app runs natively, in our order.
  const available = NATIVE_MODES.filter((id) => id === 'chat' || modes.data?.some((mode) => mode.id === id));
  const saved = sessionMode ?? (isText(preferences?.capability) ? preferences.capability : undefined);
  const mode = pickedMode ?? (saved && isNativeCapability(saved) ? saved : 'chat');
  const config = modeConfig(mode, settings[mode]);

  const request: Pick<DtTurnRequest, 'capability' | 'config' | 'tools' | 'llmSelection' | 'knowledgeBases'> = {
    capability: mode,
    config,
    // Tools belong to Chat; other modes bring their own, and the session keeps its list.
    tools: mode === 'chat' ? selectedTools : undefined,
    llmSelection: model,
    // Kept by the session, like DeepTutor's own composer does.
    knowledgeBases: selectedKnowledgeBases,
  };

  return {
    tools: tools.data,
    models: options,
    modes: available,
    selectedTools,
    setSelectedTools: setPickedTools,
    knowledgeBases: knowledgeBases.data,
    selectedKnowledgeBases,
    setSelectedKnowledgeBases: setPickedKnowledgeBases,
    model,
    setModel: setPickedModel,
    mode,
    setMode: setPickedMode,
    config,
    setSetting: (key: string, value: unknown) => setSettings((current) => ({ ...current, [mode]: { ...current[mode], [key]: value } })),
    request,
  };
}
