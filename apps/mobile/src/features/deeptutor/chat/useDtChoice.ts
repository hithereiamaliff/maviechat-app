import { sameSelection, type DtChatResources, type DtLlmSelection, type DtPersona, type DtTurnRequest } from '@maviechat/deeptutor-protocol';
import { useState } from 'react';
import { usePersonas } from '@/features/deeptutor/personalization/queries';
import { useDtAuthStatus, useDtChatResources, useDtChatTools, useDtKnowledgeBases, useDtLlmOptions, useDtModes, useDtModules } from '@/features/deeptutor/queries';
import { isNativeCapability, modeConfig, NATIVE_MODES } from './capabilities';

const isText = (value: unknown): value is string => typeof value === 'string';

function selectionOf(value: unknown): DtLlmSelection | null {
  if (typeof value !== 'object' || value === null) return null;
  const { profile_id: profileId, model_id: modelId } = value as Record<string, unknown>;
  return isText(profileId) && isText(modelId) && profileId && modelId ? { profile_id: profileId, model_id: modelId } : null;
}

/** The voice, skills, MCP servers and memory a chat uses (not offered to learner accounts). */
export interface DtPersonalChoice {
  personas: DtPersona[] | undefined;
  /** '' for the default voice. */
  persona: string;
  setPersona: (name: string) => void;
  skills: DtChatResources['skills'] | undefined;
  /** None picked: every skill the chat's workspace allows. */
  selectedSkills: string[];
  setSkills: (ids: string[]) => void;
  mcp: DtChatResources['mcp'] | undefined;
  selectedMcp: string[];
  setMcp: (ids: string[]) => void;
  /** The server has memory on. */
  memory: boolean;
  useMemory: boolean;
  setUseMemory: (on: boolean) => void;
}

/** What DeepTutor's composer sends to draw on memory: any of these brings in the whole big picture. */
const MEMORY_REFERENCES = ['summary', 'profile'];

/**
 * How a chat answers: its mode and that mode's settings, its tools and model, its voice, skills
 * and MCP servers, and whether it draws on your memory. What you pick here wins, else what the
 * session last used (its saved preferences), else Chat with no tools and the account's default
 * model.
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
  // Personas, skills and MCP servers are refused to learner accounts: offered only once we know.
  const status = useDtAuthStatus();
  const personalAllowed = status.data !== undefined && !status.data.learning_policy;
  const personas = usePersonas(personalAllowed);
  const resources = useDtChatResources(personalAllowed);
  const modules = useDtModules();
  const memoryOn = modules.data?.some((module) => module.id === 'memory' && module.enabled) ?? false;
  const [pickedPersona, setPickedPersona] = useState<string | null>(null);
  const [pickedSkills, setPickedSkills] = useState<string[] | null>(null);
  const [pickedMcp, setPickedMcp] = useState<string[] | null>(null);
  const [useMemory, setUseMemory] = useState(false);

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
  const persona = pickedPersona ?? (isText(preferences?.persona) ? preferences.persona : null);
  const skills = pickedSkills ?? (Array.isArray(preferences?.skills) ? preferences.skills.filter(isText) : null);
  const mcp = pickedMcp ?? (Array.isArray(preferences?.mcp) ? preferences.mcp.filter(isText) : null);

  const request: Pick<DtTurnRequest, 'capability' | 'config' | 'tools' | 'llmSelection' | 'knowledgeBases' | 'persona' | 'skills' | 'mcp' | 'memoryReferences'> = {
    capability: mode,
    config,
    // Tools belong to Chat; other modes bring their own, and the session keeps its list.
    tools: mode === 'chat' ? selectedTools : undefined,
    llmSelection: model,
    // Kept by the session, like DeepTutor's own composer does.
    knowledgeBases: selectedKnowledgeBases,
    // Restated once known (picked, or the chat's own); left out otherwise, so the chat keeps its.
    ...(personalAllowed && persona !== null ? { persona } : {}),
    ...(personalAllowed && skills !== null ? { skills } : {}),
    ...(personalAllowed && mcp !== null ? { mcp } : {}),
    ...(personalAllowed && memoryOn && useMemory ? { memoryReferences: MEMORY_REFERENCES } : {}),
  };
  const personal: DtPersonalChoice | undefined = personalAllowed
    ? {
        personas: personas.data,
        persona: persona ?? '',
        setPersona: setPickedPersona,
        skills: resources.data?.skills,
        selectedSkills: skills ?? [],
        setSkills: setPickedSkills,
        mcp: resources.data?.mcp,
        selectedMcp: mcp ?? [],
        setMcp: setPickedMcp,
        memory: memoryOn,
        useMemory: memoryOn && useMemory,
        setUseMemory,
      }
    : undefined;

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
    personal,
    request,
  };
}
