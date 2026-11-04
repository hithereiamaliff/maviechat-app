/*
 * OpenCode's shapes (v1.19 API), as far as MavieChat uses them. Servers add fields freely, so
 * everything here is read defensively; unknown parts and events are kept or ignored, never fatal.
 */

export interface Tokens {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
  total?: number;
}

export interface FileDiff {
  file?: string;
  patch?: string;
  additions: number;
  deletions: number;
  status?: 'added' | 'deleted' | 'modified';
}

export interface Session {
  id: string;
  title: string;
  directory: string;
  projectID?: string;
  parentID?: string;
  version?: string;
  summary?: { additions: number; deletions: number; files: number };
  cost?: number;
  tokens?: Tokens;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  permission?: PermissionRule[];
  time: { created: number; updated: number; archived?: number; compacting?: number };
}

export interface UserMessage {
  id: string;
  sessionID: string;
  role: 'user';
  time: { created: number };
  agent?: string;
  model?: { providerID: string; modelID: string; variant?: string };
  /** What the reply to this message changed in the project (OpenCode 1.19 keeps it here). */
  summary?: { diffs?: FileDiff[] };
}

/** OpenCode's error object on a failed reply: a name and, usually, `data.message`. */
export interface OcMessageError {
  name: string;
  data?: { message?: string; [key: string]: unknown };
}

export interface AssistantMessage {
  id: string;
  sessionID: string;
  role: 'assistant';
  parentID?: string;
  time: { created: number; completed?: number };
  error?: OcMessageError;
  modelID?: string;
  providerID?: string;
  agent?: string;
  mode?: string;
  cost?: number;
  tokens?: Tokens;
  finish?: string;
}

export type Message = UserMessage | AssistantMessage;

interface PartBase {
  id: string;
  sessionID: string;
  messageID: string;
}

export interface TextPart extends PartBase {
  type: 'text';
  text: string;
  synthetic?: boolean;
  ignored?: boolean;
  time?: { start: number; end?: number };
}

export interface ReasoningPart extends PartBase {
  type: 'reasoning';
  text: string;
  time?: { start: number; end?: number };
}

export type ToolState =
  | { status: 'pending'; input: Record<string, unknown>; raw?: string }
  | { status: 'running'; input: Record<string, unknown>; title?: string; metadata?: Record<string, unknown>; time: { start: number } }
  | { status: 'completed'; input: Record<string, unknown>; output: string; title: string; metadata: Record<string, unknown>; time: { start: number; end: number } }
  | { status: 'error'; input: Record<string, unknown>; error: string; metadata?: Record<string, unknown>; time: { start: number; end: number } };

export interface ToolPart extends PartBase {
  type: 'tool';
  callID: string;
  tool: string;
  state: ToolState;
}

export interface FilePart extends PartBase {
  type: 'file';
  mime: string;
  filename?: string;
  url: string;
}

export interface PatchPart extends PartBase {
  type: 'patch';
  hash: string;
  files: string[];
}

export interface StepStartPart extends PartBase {
  type: 'step-start';
}

export interface StepFinishPart extends PartBase {
  type: 'step-finish';
  reason: string;
  cost: number;
  tokens: Tokens;
}

export interface AgentPart extends PartBase {
  type: 'agent';
  name: string;
}

export interface SubtaskPart extends PartBase {
  type: 'subtask';
  prompt: string;
  description: string;
  agent: string;
}

export interface RetryPart extends PartBase {
  type: 'retry';
  attempt: number;
  error?: OcMessageError;
}

export interface CompactionPart extends PartBase {
  type: 'compaction';
  auto: boolean;
}

/** A part type this app doesn't draw (snapshot, newer kinds): kept so order and ids stay right. */
export interface OtherPart extends PartBase {
  type: string;
}

export type Part = TextPart | ReasoningPart | ToolPart | FilePart | PatchPart | StepStartPart | StepFinishPart | AgentPart | SubtaskPart | RetryPart | CompactionPart;

export interface MessageWithParts {
  info: Message;
  parts: (Part | OtherPart)[];
}

export type SessionStatus = { type: 'idle' } | { type: 'busy' } | { type: 'retry'; attempt: number; message: string; next: number };

export interface PermissionRule {
  permission: string;
  pattern: string;
  action: 'allow' | 'deny' | 'ask';
}

/** OpenCode asking before a tool runs: which permission, for which patterns (a command, a file…). */
export interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool?: { messageID: string; callID: string };
}

export type PermissionReply = 'once' | 'always' | 'reject';

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionInfo {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

/** The agent asking you to choose (its question tool). */
export interface QuestionRequest {
  id: string;
  sessionID: string;
  questions: QuestionInfo[];
}

export interface Todo {
  content: string;
  status: string;
  priority: string;
}

export interface FileNode {
  name: string;
  path: string;
  absolute: string;
  type: 'file' | 'directory';
  ignored: boolean;
}

export interface FileContent {
  type: 'text' | 'binary';
  content: string;
  encoding?: 'base64';
  mimeType?: string;
}

export interface Model {
  id: string;
  providerID: string;
  name: string;
  capabilities?: { reasoning?: boolean; attachment?: boolean; toolcall?: boolean; input?: { image?: boolean; pdf?: boolean } };
  limit?: { context: number; output: number };
  status?: 'alpha' | 'beta' | 'deprecated' | 'active';
  variants?: Record<string, Record<string, unknown>>;
}

export interface Provider {
  id: string;
  name: string;
  models: Record<string, Model>;
}

export interface Providers {
  providers: Provider[];
  /** The default model per provider id. */
  default: Record<string, string>;
}

export interface Agent {
  name: string;
  description?: string;
  mode: 'subagent' | 'primary' | 'all';
  hidden?: boolean;
  model?: { modelID: string; providerID: string };
}

export interface Project {
  id: string;
  worktree: string;
  name?: string;
  vcs?: unknown;
  time: { created: number; updated?: number };
}

/** One event from OpenCode's live stream (`/event`): `type`, and `properties` that depend on it. */
export interface OcEvent {
  type: string;
  properties: Record<string, unknown>;
}

/** What the gateway says about its machine. */
export interface Machine {
  name: string;
  url: string;
  folders: string[];
  logins: { id: string; name: string; version: string | null; online: boolean }[];
  device: { id: string; name: string };
}

export interface PairedDevice {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
}
