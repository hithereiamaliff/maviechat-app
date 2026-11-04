import { DtHttpError, type DtClient } from './http';
import { isAgentConnection } from './subagents';

/*
 * DeepTutor's mastery paths (1.7.1, `/api/mastery-paths`): a goal becomes a map of modules and
 * knowledge points that you work through with the tutor in a path's chats (outline, study,
 * review). Each point keeps its own mastery; mastered points come back for review on a schedule.
 * The `/progress/{id}` routes take the same path id (they predate topics).
 */

const BASE = '/api/mastery-paths';

export type DtMasteryMode = 'outline' | 'study' | 'review';
export const DT_MASTERY_MODES: readonly DtMasteryMode[] = ['outline', 'study', 'review'];
export type DtPointType = 'concept' | 'memory' | 'procedure' | 'design';
export const DT_POINT_TYPES: readonly DtPointType[] = ['concept', 'memory', 'procedure', 'design'];
export type DtPointStatus = 'new' | 'learning' | 'mastered';
/** What DeepTutor suggests doing next on a path. */
export type DtNextAction = 'answer_pending' | 'review' | 'probe' | 'teach' | 'practice' | 'assess' | 'complete';

/** The emblems DeepTutor offers for a new path, stored as the emoji itself. */
export const DT_PATH_EMBLEMS = ['🧭', '🏔️', '🌿', '🔭', '🧪', '🧠', '📐', '🌌'] as const;
export const DT_GOAL_MAX = 2000;
export const DT_POINT_NOTE_MAX = 500;
export const DT_RECALL_TARGETS = [0.7, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99] as const;

export interface DtKnowledgePoint {
  id: string;
  name: string;
  type: DtPointType;
  status: DtPointStatus;
  /** 0–1. */
  mastery: number;
  /** "learner" when you marked it known yourself. */
  masterySource: string;
  overrideNote: string;
  deferred: boolean;
  prerequisiteIds: string[];
  sourceIds: string[];
}

export interface DtMasteryModule {
  id: string;
  name: string;
  objective: string;
  order: number;
  mastered: number;
  total: number;
  points: DtKnowledgePoint[];
}

export interface DtMasteryNext {
  action: DtNextAction | string;
  pointId: string;
  pointName: string;
  moduleName: string;
  reason: string;
  /** The chat holding a question you haven't answered yet. */
  sessionId: string;
}

export interface DtMasteryReview {
  id: string;
  pointId: string;
  pointName: string;
  /** Unix seconds; 0 when not scheduled. */
  dueAt: number;
  due: boolean;
  /** 0–1: how likely you've forgotten it. */
  risk: number;
  reason: string;
  recentFailure: boolean;
}

export interface DtReviewStrategy {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  desiredRetention: number | null;
  intervals: Record<DtPointType, number[]>;
}

export interface DtLearnerProfile {
  priorKnowledge: string;
  targetLevel: string;
  timeBudget: string;
  preferences: string;
  teachFirst: boolean;
  notes: string;
}

export interface DtMasterySource {
  id: string;
  kind: string;
  label: string;
  available: boolean;
}

export interface DtMasteryTopic {
  pathId: string;
  /** The name to show (see `masteryTitle`). */
  name: string;
  goal: string;
  description: string;
  emoji: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  sources: DtMasterySource[];
  next: DtMasteryNext | null;
  counts: { mastered: number; learning: number; new: number; total: number };
  complete: boolean;
  modules: DtMasteryModule[];
  reviews: DtMasteryReview[];
  recallTarget: number;
  strategy: { id: string; name: string } | null;
  learner: DtLearnerProfile | null;
  sessionCount: number;
}

export interface DtMasterySession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  running: boolean;
  messageCount: number;
  lastMessage: string;
  pendingQuestion: boolean;
}

export interface DtPointReport {
  name: string;
  type: string;
  status: string;
  /** "qualitative" (explain it) or "quantitative" (a score to reach). */
  gate: string;
  mastered: boolean;
  /** Mastered on the evidence, not just because you said so. */
  assessedMastered: boolean;
  masterySource: string;
  overrideNote: string;
  mastery: number;
  threshold: number;
  attempts: { prompt: string; answer: string; correct: boolean; at: number }[];
  explanation: string;
  review: { dueAt: number; retrievability: number; stability: number; risk: number; lapses: number; reason: string } | null;
}

/**
 * Changing a path (its map, a point, the settings, its name; reset or delete) first stops the
 * tutor's turn on it. Just after a turn ends, DeepTutor still holds the path for a moment and
 * refuses with 409; a few short waits get past that. Other refusals come straight back.
 */
export async function whenPathFree<T>(change: () => Promise<T>, waits: readonly number[] = [1500, 3000, 6000]): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await change();
    } catch (error) {
      const busy = error instanceof DtHttpError && error.status === 409 && /learning turn|changed activity/i.test(error.detail ?? error.message);
      const wait = waits[attempt];
      if (!busy || wait === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const isType = (value: unknown): value is DtPointType => typeof value === 'string' && (DT_POINT_TYPES as readonly string[]).includes(value);
const isStatus = (value: unknown): value is DtPointStatus => value === 'new' || value === 'learning' || value === 'mastered';
const segment = (id: string) => encodeURIComponent(id);

/**
 * The name to show, as DeepTutor's own pages do: the topic's name, unless it's empty or only an
 * id (a path made inside a chat), which reads "Exploration trail" and the id's last characters.
 */
export function masteryTitle(topic: Pick<DtMasteryTopic, 'name' | 'pathId'>): string {
  const name = topic.name.trim();
  if (name && name !== topic.pathId && !/^unified_\d+_/.test(name)) return name;
  const last = topic.pathId.split(/[/:_]/).filter(Boolean).pop() ?? topic.pathId;
  return `Exploration trail · ${last.slice(-4)}`;
}

function pointOf(raw: Record<string, unknown>): DtKnowledgePoint {
  return {
    id: text(raw.id),
    name: text(raw.name),
    type: isType(raw.type) ? raw.type : 'concept',
    status: isStatus(raw.status) ? raw.status : 'new',
    mastery: num(raw.mastery),
    masterySource: text(raw.mastery_source),
    overrideNote: text(raw.override_note),
    deferred: raw.deferred === true,
    prerequisiteIds: strings(raw.prerequisite_ids),
    sourceIds: strings(raw.topic_source_ids),
  };
}

export function masteryTopicOf(raw: unknown): DtMasteryTopic {
  const topic = record(raw);
  const metadata = record(topic.metadata);
  const map = record(topic.map);
  const counts = record(map.counts);
  const next = record(topic.next);
  const settings = record(topic.review_settings);
  const strategy = record(settings.strategy);
  const learner = topic.learner_profile ? record(topic.learner_profile) : null;
  const pathId = text(topic.path_id);
  return {
    pathId,
    name: text(topic.name),
    goal: text(metadata.goal),
    description: text(metadata.description),
    emoji: text(metadata.emoji) || '🧭',
    status: text(metadata.status) || 'active',
    createdAt: num(metadata.created_at),
    updatedAt: num(topic.updated_at) || num(metadata.updated_at),
    revision: num(topic.path_revision),
    sources: rows(topic.sources)
      .filter((source) => source.kind !== 'goal')
      .map((source) => ({ id: text(source.id), kind: text(source.kind), label: text(source.label), available: source.available !== false })),
    next: Object.keys(next).length
      ? {
          action: text(next.action),
          pointId: text(next.knowledge_point_id),
          pointName: text(next.knowledge_point_name),
          moduleName: text(next.module_name),
          reason: text(next.reason),
          sessionId: text(next.session_id),
        }
      : null,
    counts: { mastered: num(counts.mastered), learning: num(counts.learning), new: num(counts.new), total: num(counts.total) },
    complete: map.complete === true,
    modules: rows(map.modules)
      .map((module) => ({
        id: text(module.id),
        name: text(module.name),
        objective: text(module.objective),
        order: num(module.order),
        mastered: num(module.mastered),
        total: num(module.total),
        points: rows(module.knowledge_points).map(pointOf),
      }))
      .sort((a, b) => a.order - b.order),
    reviews: rows(topic.reviews).map((review) => ({
      id: text(review.id),
      pointId: text(review.knowledge_point_id),
      pointName: text(review.knowledge_point_name),
      dueAt: num(review.due_at),
      due: review.due === true,
      risk: num(review.forgetting_risk),
      reason: text(review.reason),
      recentFailure: review.recent_failure === true,
    })),
    recallTarget: num(settings.desired_retention, 0.9),
    strategy: text(strategy.template_id) ? { id: text(strategy.template_id), name: text(strategy.name) } : null,
    learner: learner
      ? {
          priorKnowledge: text(learner.prior_knowledge),
          targetLevel: text(learner.target_level),
          timeBudget: text(learner.time_budget),
          preferences: text(learner.preferences),
          teachFirst: learner.teaching_strategy === 'teach_first',
          notes: text(learner.notes),
        }
      : null,
    sessionCount: num(topic.session_count),
  };
}

/** Your mastery paths, the newest first (archived ones are left out, as on DeepTutor). */
export async function listMasteryTopics(client: DtClient): Promise<DtMasteryTopic[]> {
  const body = record(await client.get<unknown>(`${BASE}/topics`));
  return rows(body.topics).map(masteryTopicOf).filter((topic) => topic.pathId && topic.status === 'active');
}

export async function getMasteryTopic(client: DtClient, pathId: string): Promise<DtMasteryTopic> {
  return masteryTopicOf(await client.get<unknown>(`${BASE}/topics/${segment(pathId)}`));
}

/** Something the tutor reads when it designs the outline with you. */
export interface DtMasterySourceInput {
  kind: 'goal' | 'book' | 'notebook' | 'knowledge_base' | 'file' | 'chat' | 'question_bank' | 'cowriter' | 'partner_group';
  label: string;
  sourceId?: string;
  /** What the tutor should read of it (up to 8,000 characters). */
  excerpt?: string;
  available?: boolean;
  metadata?: Record<string, unknown>;
}

/** A source as DeepTutor's learning tools take it (a path's materials, a book's sources). */
export function learningSourceRef(source: DtMasterySourceInput): Record<string, unknown> {
  return {
    kind: source.kind,
    label: source.label.slice(0, 200) || source.kind,
    ...(source.sourceId ? { source_id: source.sourceId } : {}),
    excerpt: (source.excerpt ?? '').slice(0, 8000),
    available: source.available !== false,
    metadata: source.metadata ?? {},
  };
}

/**
 * A new path from a goal, as DeepTutor's wizard makes it: the goal first among its sources, no
 * modules yet (the outline is agreed in a chat afterwards). DeepTutor names it from the goal.
 */
export async function createMasteryTopic(
  client: DtClient,
  input: { goal: string; emoji?: string; sources?: DtMasterySourceInput[]; modules?: DtMapModuleInput[] },
): Promise<DtMasteryTopic> {
  const goal = input.goal.trim().slice(0, DT_GOAL_MAX);
  const sources = [{ kind: 'goal' as const, label: 'Learning goal', excerpt: goal }, ...(input.sources ?? [])].map(learningSourceRef);
  const body = { goal, emoji: input.emoji || '🧭', sources, modules: (input.modules ?? []).map(moduleInput) };
  return masteryTopicOf(await client.send<unknown>('POST', `${BASE}/topics`, { body, timeoutMs: 60_000 }).then((response) => response.data));
}

/** A module as the map editor sends it; existing ids keep their evidence. */
export interface DtMapModuleInput {
  id?: string;
  name: string;
  objective?: string;
  points: { id?: string; name: string; type: DtPointType; prerequisiteIds?: string[]; sourceIds?: string[] }[];
}

function moduleInput(module: DtMapModuleInput) {
  return {
    ...(module.id ? { id: module.id } : {}),
    name: module.name.trim(),
    // DeepTutor's own editor leaves this out, which clears each module's sentence; we keep it.
    objective: (module.objective ?? '').slice(0, 300),
    knowledge_points: module.points.map((point) => ({
      ...(point.id ? { id: point.id } : {}),
      name: point.name.trim(),
      type: point.type,
      prerequisite_ids: point.prerequisiteIds ?? [],
      topic_source_ids: point.sourceIds ?? [],
    })),
  };
}

/** The editable form of a path's map. */
export function mapInput(topic: DtMasteryTopic): DtMapModuleInput[] {
  return topic.modules.map((module) => ({
    id: module.id,
    name: module.name,
    objective: module.objective,
    points: module.points.map((point) => ({ id: point.id, name: point.name, type: point.type, prerequisiteIds: point.prerequisiteIds, sourceIds: point.sourceIds })),
  }));
}

/** Problems that would make DeepTutor refuse the map, in our words; empty when it's fine. */
export function mapProblems(modules: DtMapModuleInput[], existingIds: ReadonlySet<string> = new Set()): string[] {
  const problems: string[] = [];
  if (modules.length === 0) problems.push('Keep at least one module.');
  if (modules.length > 20) problems.push('A path holds at most 20 modules.');
  modules.forEach((module, index) => {
    const label = module.name.trim() || `Module ${index + 1}`;
    if (!module.name.trim()) problems.push(`Module ${index + 1} needs a name.`);
    if (module.points.length === 0) problems.push(`${label} needs at least one knowledge point.`);
    if (module.points.length > 7 && !(module.id && existingIds.has(module.id))) problems.push(`${label}: a new module holds at most 7 knowledge points.`);
    if (module.points.some((point) => point.name.trim().length < 2)) problems.push(`${label}: each knowledge point needs a name of two letters or more.`);
  });
  return problems;
}

/** Saves an edited map. Renamed points keep their evidence; removed ones lose it. */
export async function saveMasteryMap(client: DtClient, pathId: string, modules: DtMapModuleInput[]): Promise<DtMasteryTopic> {
  return masteryTopicOf(await whenPathFree(() => client.send<unknown>('PUT', `${BASE}/topics/${segment(pathId)}/map`, { body: { modules: modules.map(moduleInput) } })).then((response) => response.data));
}

export async function listMasterySessions(client: DtClient, pathId: string): Promise<DtMasterySession[]> {
  const body = record(await client.get<unknown>(`${BASE}/topics/${segment(pathId)}/sessions`));
  return rows(body.sessions).map((session) => ({
    id: text(session.session_id),
    title: text(session.title),
    createdAt: num(session.created_at),
    updatedAt: num(session.updated_at),
    running: session.status === 'running' || Boolean(text(session.active_turn_id)),
    messageCount: num(session.message_count),
    lastMessage: text(session.last_message),
    pendingQuestion: session.has_pending_question === true,
  }));
}

/** Switches a path chat between outline, study and review (study needs an outline). */
export async function setMasteryMode(client: DtClient, pathId: string, sessionId: string, mode: DtMasteryMode): Promise<void> {
  await client.send('PUT', `${BASE}/topics/${segment(pathId)}/sessions/${segment(sessionId)}/mode`, { body: { mode } });
}

/** "I already know this" (mastered: true), or back to the tutor's assessment (false). */
export async function overridePoint(client: DtClient, pathId: string, pointId: string, mastered: boolean, note = ''): Promise<void> {
  await whenPathFree(() => client.send('POST', `${BASE}/topics/${segment(pathId)}/objectives/${segment(pointId)}/override`, { body: { mastered, note: note.slice(0, DT_POINT_NOTE_MAX) } }));
}

export async function getPointReport(client: DtClient, pathId: string, pointId: string): Promise<DtPointReport> {
  const objective = record(record(await client.get<unknown>(`${BASE}/progress/${segment(pathId)}/objectives/${segment(pointId)}`)).objective);
  const review = objective.review ? record(objective.review) : null;
  return {
    name: text(objective.name),
    type: text(objective.type),
    status: text(objective.status),
    gate: text(objective.gate),
    mastered: objective.mastered === true,
    assessedMastered: objective.assessed_mastered === true,
    masterySource: text(objective.mastery_source),
    overrideNote: text(objective.override_note),
    mastery: num(objective.mastery),
    threshold: num(objective.threshold),
    attempts: rows(objective.attempts)
      .map((attempt) => ({ prompt: text(attempt.prompt), answer: text(attempt.answer), correct: attempt.is_correct === true, at: num(attempt.at) }))
      .sort((a, b) => b.at - a.at),
    explanation: text(objective.explanation),
    review: review
      ? {
          dueAt: num(review.due_at),
          retrievability: num(review.retrievability),
          stability: num(review.stability),
          risk: num(review.forgetting_risk),
          lapses: num(review.lapse_count),
          reason: text(review.reason),
        }
      : null,
  };
}

export async function renameMasteryPath(client: DtClient, pathId: string, name: string): Promise<void> {
  await whenPathFree(() => client.send('PATCH', `${BASE}/progress/${segment(pathId)}`, { body: { name: name.trim().slice(0, 200) } }));
}

/** Clears every point's progress, schedule and override; the modules stay. */
export async function resetMasteryPath(client: DtClient, pathId: string): Promise<void> {
  await whenPathFree(() => client.send('POST', `${BASE}/progress/${segment(pathId)}/redo`));
}

/** Deletes the path for good (its chats stay, as loose chats). */
export async function deleteMasteryPath(client: DtClient, pathId: string): Promise<void> {
  await whenPathFree(() => client.delete(`${BASE}/progress/${segment(pathId)}`));
}

export async function listReviewStrategies(client: DtClient): Promise<DtReviewStrategy[]> {
  const body = record(await client.get<unknown>(`${BASE}/review-strategies`));
  return rows(body.strategies).map((strategy) => {
    const intervals = record(strategy.intervals);
    return {
      id: text(strategy.template_id),
      name: text(strategy.name),
      description: text(strategy.description),
      builtin: strategy.builtin === true,
      desiredRetention: typeof strategy.desired_retention === 'number' ? strategy.desired_retention : null,
      intervals: Object.fromEntries(DT_POINT_TYPES.map((type) => [type, (Array.isArray(intervals[type]) ? intervals[type] : []).filter((day): day is number => typeof day === 'number')])) as Record<DtPointType, number[]>,
    };
  });
}

/** Puts the path on a review strategy ("" for DeepTutor's default); its schedule is worked out again. */
export async function setReviewStrategy(client: DtClient, pathId: string, templateId: string): Promise<DtMasteryTopic> {
  return masteryTopicOf(await whenPathFree(() => client.send<unknown>('PUT', `${BASE}/topics/${segment(pathId)}/review-strategy`, { body: { template_id: templateId } })).then((response) => response.data));
}

/** How sure you want to be of remembering (0.7–0.99): higher brings reviews sooner. */
export async function setRecallTarget(client: DtClient, pathId: string, retention: number): Promise<DtMasteryTopic> {
  const value = Math.min(0.99, Math.max(0.7, retention));
  return masteryTopicOf(await whenPathFree(() => client.send<unknown>('PUT', `${BASE}/topics/${segment(pathId)}/review-settings`, { body: { desired_retention: value } })).then((response) => response.data));
}

/** Reviews in DeepTutor's order on the page: due ones by risk, then upcoming by date. */
export function sortedReviews(reviews: DtMasteryReview[]): DtMasteryReview[] {
  return [...reviews].sort((a, b) => Number(b.due) - Number(a.due) || (a.due ? b.risk - a.risk : (a.dueAt || Infinity) - (b.dueAt || Infinity)));
}

/** Points that became mastered between two looks at a path (DeepTutor celebrates them). */
export function newlyMastered(before: DtMasteryTopic | undefined, after: DtMasteryTopic): DtKnowledgePoint[] {
  if (!before || before.pathId !== after.pathId) return [];
  const was = new Map(before.modules.flatMap((module) => module.points.map((point) => [point.id, point.status] as const)));
  return after.modules.flatMap((module) => module.points.filter((point) => point.status === 'mastered' && was.has(point.id) && was.get(point.id) !== 'mastered'));
}

/** What the next step is, in our words, for the path page's "Next up". */
export function nextStepText(action: string): string {
  switch (action) {
    case 'probe':
      return 'A quick check first: you may already know it.';
    case 'teach':
      return 'Learn it with the tutor, then a check.';
    case 'practice':
      return 'Practise until you pass the bar.';
    case 'assess':
      return 'Explain it in your own words.';
    case 'review':
      return 'Time to look at it again before it fades.';
    case 'answer_pending':
      return 'Your tutor is waiting for an answer.';
    case 'complete':
      return 'Every point is mastered.';
    default:
      return '';
  }
}

/** The turn fields that put a chat on a path (sent with every turn of a path chat). */
export function masteryTurnFields(pathId: string, mode: DtMasteryMode | null) {
  return { capability: 'mastery_path', workspaceMode: 'mastery_path', masteryPathId: pathId, masterySessionMode: mode, config: {} };
}

/** The chat's path and mode, from its saved preferences; null for an ordinary chat. */
export function masteryOfPreferences(preferences: Record<string, unknown> | null | undefined): { pathId: string; mode: DtMasteryMode | null } | null {
  if (!preferences || preferences.workspace_mode !== 'mastery_path' || !text(preferences.mastery_path_id)) return null;
  const mode = preferences.mastery_session_mode;
  return { pathId: text(preferences.mastery_path_id), mode: mode === 'outline' || mode === 'study' || mode === 'review' ? mode : null };
}

/** The first message of a new outline or review chat, as DeepTutor sends it for you (in our words). */
export function openingMessage(mode: DtMasteryMode, duePoints: string[] = []): string | null {
  if (mode === 'outline') return 'Read the materials I picked and design the outline for this goal with me.';
  if (mode === 'review') return duePoints.length ? `Review what's due today: ${duePoints.slice(0, 5).join(', ')}.` : "Review what I've already learned.";
  return null;
}

/** A knowledge base the tutor can read for a new path, as DeepTutor's material picker lists it. */
export interface DtMaterialChoice {
  id: string;
  label: string;
  available: boolean;
}

/** Knowledge bases to build a path from (DeepTutor's own picker leaves out its sub-agents' ones). */
export async function listKnowledgeMaterials(client: DtClient): Promise<DtMaterialChoice[]> {
  const body = record(await client.get<unknown>('/api/dashboard/source-library/knowledge'));
  return rows(body.items)
    .filter((row) => !isAgentConnection(row))
    .map((row) => ({ id: text(row.id) || text(row.name), label: text(row.name) || text(row.id), available: row.available !== false && row.unreadable !== true }))
    .filter((row) => row.id);
}

/** A notebook as a path's source: its first 16 records, as DeepTutor's wizard sends them. */
export function notebookMaterial(notebook: { id: string; name: string; records?: { title?: unknown; summary?: unknown; user_query?: unknown; output?: unknown }[] }): DtMasterySourceInput {
  const records = notebook.records ?? [];
  return {
    kind: 'notebook',
    sourceId: notebook.id,
    label: notebook.name || 'Notebook',
    excerpt: records
      .slice(0, 16)
      .map((item) => `${text(item.title)}\n${text(item.summary) || text(item.user_query)}\n${text(item.output)}`)
      .join('\n\n')
      .slice(0, 8000),
    metadata: { record_count: records.length, content_workspace_id: '' },
  };
}
