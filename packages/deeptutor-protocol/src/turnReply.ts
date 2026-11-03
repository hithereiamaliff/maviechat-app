import type { DtMessage } from './sessions';
import { parseServerEvent, type DtStreamEvent } from './turns';

export type DtReplyStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

/** A tool the reply used, anchored where it was called in the answer text. */
export interface DtToolStep {
  /** The trace call id; the result arrives under the same id. */
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** How much answer text had been written when the tool was called. */
  offset: number;
  done: boolean;
  /** The tool's output, in Markdown. */
  result: string;
}

/** Reasoning from one model call (DeepTutor's agent loop makes one per round). */
export interface DtThought {
  id: string;
  text: string;
}

export interface DtSource {
  url: string;
  title: string;
  type: string;
}

/** A step of a multi-stage mode (Research: rephrasing, decomposing, researching, reporting…). */
export interface DtStage {
  name: string;
  done: boolean;
}

export type DtQuizQuestionType = 'choice' | 'concept' | 'fill_in_blank' | 'short_answer' | 'written' | 'coding';

/** A Quiz question, with its answer and explanation (DeepTutor sends both up front). */
export interface DtQuizQuestion {
  id: string;
  /** Markdown, maths included. */
  question: string;
  type: DtQuizQuestionType;
  /** Choice questions: "A", "B", … in order. */
  options: { key: string; text: string }[];
  answer: string;
  explanation: string;
  difficulty: string;
}

/** What Ask Questions (or any `ask_user` call) wants to know before it carries on. */
export interface DtAskQuestion {
  id: string;
  header: string;
  prompt: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
  freeText: boolean;
  placeholder: string;
}

export interface DtAsk {
  intro: string;
  questions: DtAskQuestion[];
}

/** A Visualize result: what to draw and how. */
export interface DtVisual {
  /** "chartjs", "svg", "mermaid", "mindmap", "html", "geogebra", … */
  renderType: string;
  /** The payload as text (JSON for Chart.js). */
  data: string;
  title: string;
  description: string;
  code: { language: string; content: string };
}

/** Research's first turn: an outline to confirm before the research runs. */
export interface DtOutline {
  topic: string;
  subTopics: { title: string; overview: string }[];
  /** The research settings to send again with the confirmed outline. */
  config: Record<string, unknown>;
}

/** A question a mastery path's tutor posed (`mastery_question`); a reply can pose several. */
export interface DtMasteryQuestion {
  id: string;
  prompt: string;
  /** "choice" (lettered options), "short" (your words), or "group" (2–4 parts answered together). */
  type: string;
  /** The knowledge point it checks. */
  pointName: string;
  difficulty: string;
  attempt: number;
  options: { label: string; body: string }[];
  freeText: boolean;
  parts: DtMasteryQuestion[];
}

/** The tutor's ruling on an answer (`mastery_grade`); it usually arrives with the next turn. */
export interface DtMasteryGrade {
  questionId: string;
  correct: boolean | null;
  /** "correct", "partial", "incorrect" or "ungraded". */
  result: string;
  learnerAnswer: string;
  correctLabel: string;
  correctBody: string;
  explanation: string;
  feedback: string;
  /** False while the tutor still wants more (a clarification, the rest of a group). */
  final: boolean;
  parts: DtMasteryGrade[];
}

/** What a mastery path's tutor did in a reply, besides writing. */
export interface DtMasteryInfo {
  questions: DtMasteryQuestion[];
  grades: DtMasteryGrade[];
  /** Questions dropped at your request (no grade will come). */
  skipped: string[];
  /** Answers the server couldn't take; their cards open again. */
  rejected: string[];
  /** The mode the tutor switched the chat to. */
  mode: string | null;
  /** The outline the tutor drew: how many modules and knowledge points it added. */
  built: { modules: number; points: number } | null;
}

/** A reply as DeepTutor's events build it, live or from a saved message. */
export interface DtReply {
  sessionId: string | null;
  turnId: string | null;
  status: DtReplyStatus;
  /** Every published answer chunk in order, the remarks written before tool calls included. */
  answer: string;
  thoughts: DtThought[];
  tools: DtToolStep[];
  sources: DtSource[];
  /** What it is doing right now ("Exploring", a stage), while it runs. */
  activity: string | null;
  error: string | null;
  /** The last event applied; events at or below it are repeats. */
  seq: number;
  /** From `done`: the saved user message and reply. */
  userMessageId: number | null;
  assistantMessageId: number | null;
  /** While `status` is "waiting": what the server asks. */
  question: { prompt: string; details: Record<string, unknown> } | null;
  /** The capability's own result (`result` metadata), for modes with more than text. */
  result: Record<string, unknown> | null;
  stages: DtStage[];
  quiz: DtQuizQuestion[];
  ask: DtAsk | null;
  /** Your answers to `ask`, by question id, once sent. */
  askAnswers: Record<string, string> | null;
  visual: DtVisual | null;
  outline: DtOutline | null;
  mastery: DtMasteryInfo;
}

export function emptyReply(sessionId: string | null = null, turnId: string | null = null): DtReply {
  return {
    sessionId,
    turnId,
    status: 'running',
    answer: '',
    thoughts: [],
    tools: [],
    sources: [],
    activity: null,
    error: null,
    seq: 0,
    userMessageId: null,
    assistantMessageId: null,
    question: null,
    result: null,
    stages: [],
    quiz: [],
    ask: null,
    askAnswers: null,
    visual: null,
    outline: null,
    mastery: { questions: [], grades: [], skipped: [], rejected: [], mode: null, built: null },
  };
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * Whether a `content` chunk belongs to the answer. Calls inside a capability's own steps stream
 * text too; only the agent loop's rounds and a final response make up what the reader sees.
 */
export function isAnswerContent(event: DtStreamEvent): boolean {
  if (event.type !== 'content') return false;
  if (!text(event.metadata.call_id)) return true;
  const kind = text(event.metadata.call_kind);
  return kind === 'agent_loop_round' || kind === 'llm_final_response';
}

const QUIZ_TYPES: Record<string, DtQuizQuestionType> = {
  choice: 'choice',
  multiple_choice: 'choice',
  mcq: 'choice',
  concept: 'concept',
  true_false: 'concept',
  judgement: 'concept',
  fill_in_blank: 'fill_in_blank',
  fill_in_the_blank: 'fill_in_blank',
  cloze: 'fill_in_blank',
  short_answer: 'short_answer',
  written: 'written',
  open_ended: 'written',
  essay: 'written',
  coding: 'coding',
  code: 'coding',
  programming: 'coding',
};

/** A question as DeepTutor's `qa_pair` describes it, or null. */
export function quizQuestion(raw: unknown): DtQuizQuestion | null {
  const qa = record(raw);
  const question = text(qa.question);
  if (!question) return null;
  const kind = text(qa.question_type).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const options = Object.entries(record(qa.options))
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, value]) => ({ key, text: value }));
  return {
    id: text(qa.question_id) || question.slice(0, 40),
    question,
    type: QUIZ_TYPES[kind] ?? 'short_answer',
    options,
    answer: text(qa.correct_answer),
    explanation: text(qa.explanation),
    difficulty: text(qa.difficulty),
  };
}

function mergeQuiz(current: DtQuizQuestion[], incoming: DtQuizQuestion[]): DtQuizQuestion[] {
  const next = [...current];
  for (const question of incoming) {
    const index = next.findIndex((item) => item.id === question.id);
    if (index >= 0) next[index] = question;
    else next.push(question);
  }
  return next;
}

function askOf(raw: unknown): DtAsk | null {
  const payload = record(raw);
  const questions = (Array.isArray(payload.questions) ? payload.questions : []).flatMap((item): DtAskQuestion[] => {
    const question = record(item);
    const id = text(question.id);
    if (!id) return [];
    return [
      {
        id,
        header: text(question.header),
        prompt: text(question.prompt),
        options: (Array.isArray(question.options) ? question.options : []).flatMap((option) => {
          const value = record(option);
          const label = typeof option === 'string' ? option : text(value.label);
          return label ? [{ label, description: text(value.description) }] : [];
        }),
        multiSelect: question.multi_select === true,
        // Free text unless DeepTutor says otherwise (it does for strict choices).
        freeText: question.allow_free_text !== false,
        placeholder: text(question.placeholder),
      },
    ];
  });
  const intro = text(payload.intro);
  return intro || questions.length ? { intro, questions } : null;
}

function visualOf(meta: Record<string, unknown>): DtVisual | null {
  const renderType = text(meta.render_type).trim();
  if (!renderType) return null;
  const payload = record(meta.payload);
  const code = record(meta.code);
  const data = 'data' in payload ? payload.data : code.content;
  const serialized = typeof data === 'string' ? data : data === undefined || data === null ? '' : JSON.stringify(data, null, 2);
  if (!serialized.trim()) return null;
  const presentation = record(meta.presentation);
  return {
    renderType,
    data: serialized,
    title: text(presentation.title),
    description: text(presentation.description),
    code: { language: text(code.language) || 'json', content: text(code.content) || serialized },
  };
}

function outlineOf(meta: Record<string, unknown>): DtOutline | null {
  if (meta.outline_preview !== true) return null;
  const subTopics = (Array.isArray(meta.sub_topics) ? meta.sub_topics : []).flatMap((item) => {
    const topic = record(item);
    const title = text(topic.title);
    return title ? [{ title, overview: text(topic.overview) }] : [];
  });
  return { topic: text(meta.topic), subTopics, config: record(meta.research_config) };
}

function stageLabel(stage: string): string {
  const words = stage.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function appendThought(thoughts: DtThought[], id: string, chunk: string): DtThought[] {
  const last = thoughts[thoughts.length - 1];
  if (last && last.id === id) return [...thoughts.slice(0, -1), { id, text: last.text + chunk }];
  return [...thoughts, { id, text: chunk }];
}

function mergeSources(current: DtSource[], incoming: unknown): DtSource[] {
  if (!Array.isArray(incoming)) return current;
  const seen = new Set(current.map((source) => source.url));
  const next = [...current];
  for (const item of incoming) {
    const source = record(item);
    const url = text(source.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    next.push({ url, title: text(source.title) || url, type: text(source.type) });
  }
  return next;
}

/** Applies one event. Repeats (a `seq` already applied) leave the reply as it is. */
/** A mastery tool's payload in a `tool_result`: under `tool_metadata`, or at the top of the metadata. */
function toolPayload(meta: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const nested = record(meta.tool_metadata)[key];
  const value = nested === undefined ? meta[key] : nested;
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function masteryQuestion(raw: unknown, nested = false): DtMasteryQuestion | null {
  const item = record(raw);
  const id = text(item.question_id).trim();
  if (!id) return null;
  const type = text(item.question_type) || 'short';
  let parts: DtMasteryQuestion[] = [];
  if (type === 'group') {
    if (nested) return null;
    const list = Array.isArray(item.questions) ? item.questions.map((part) => masteryQuestion(part, true)) : [];
    // A group is two to four parts with their own ids; anything else isn't shown as a group.
    if (list.length < 2 || list.length > 4 || list.some((part) => !part)) return null;
    parts = list as DtMasteryQuestion[];
    if (new Set([id, ...parts.map((part) => part.id)]).size !== parts.length + 1) return null;
  }
  const attempt = count(item.attempt);
  return {
    id,
    prompt: text(item.prompt),
    type,
    pointName: text(record(item.objective).name).trim(),
    difficulty: text(item.difficulty).trim(),
    attempt: attempt && attempt > 0 ? Math.floor(attempt) : 1,
    options: (Array.isArray(item.options) ? item.options : []).map(record).map((option) => ({ label: text(option.label), body: text(option.body) })).filter((option) => option.label),
    freeText: item.allow_free_text !== false,
    parts,
  };
}

export function masteryGrade(raw: unknown): DtMasteryGrade | null {
  const item = record(raw);
  const questionId = text(item.question_id).trim();
  if (!questionId) return null;
  const parts = item.question_type === 'group' && Array.isArray(item.results) ? item.results.flatMap((part) => masteryGrade(part) ?? []) : [];
  return {
    questionId,
    correct: item.is_correct === null || item.is_correct === undefined ? null : item.is_correct === true,
    result: text(item.result),
    learnerAnswer: text(item.learner_answer),
    correctLabel: text(item.correct_label),
    correctBody: text(item.correct_body),
    explanation: text(item.explanation),
    feedback: text(item.feedback),
    final: item.final !== false && item.complete !== false,
    parts,
  };
}

function applyMasteryResult(mastery: DtMasteryInfo, meta: Record<string, unknown>): DtMasteryInfo {
  let next = mastery;
  const posed = masteryQuestion(toolPayload(meta, 'mastery_question'));
  // Cards in older history came inside an `ask_user` envelope.
  const legacy = toolPayload(meta, 'ask_user');
  const card = posed ?? (legacy?.kind === 'mastery_question' ? masteryQuestion(legacy.mastery_question) : null);
  if (card) next = { ...next, questions: [...next.questions.filter((question) => question.id !== card.id), card] };
  const grade = masteryGrade(toolPayload(meta, 'mastery_grade')?.result);
  if (grade) {
    next = {
      ...next,
      grades: [...next.grades.filter((item) => item.questionId !== grade.questionId), grade],
      rejected: next.rejected.filter((id) => id !== grade.questionId),
    };
  }
  const skip = toolPayload(meta, 'mastery_skip_question');
  if (skip?.skipped === true && text(skip.question_id)) next = { ...next, skipped: [...next.skipped, text(skip.question_id)] };
  const rejected = text(toolPayload(meta, 'mastery_answer_rejected')?.question_id);
  if (rejected) next = { ...next, rejected: [...next.rejected.filter((id) => id !== rejected), rejected] };
  const mode = toolPayload(meta, 'mastery_mode');
  if (mode?.status === 'switched' && text(mode.mode)) next = { ...next, mode: text(mode.mode) };
  const built = toolPayload(meta, 'mastery_build');
  if (built?.status === 'built') next = { ...next, built: { modules: count(built.modules_added) ?? 0, points: count(built.knowledge_points_added) ?? 0 } };
  return next;
}

export function applyTurnEvent(reply: DtReply, event: DtStreamEvent): DtReply {
  if (event.seq > 0 && event.seq <= reply.seq) return reply;
  const next: DtReply = { ...reply, seq: Math.max(reply.seq, event.seq) };
  const meta = event.metadata;
  if (next.status === 'waiting' && ['content', 'thinking', 'tool_call'].includes(event.type)) {
    // The answer to its question set the turn going again.
    next.status = 'running';
    next.question = null;
  }

  switch (event.type) {
    case 'session':
      next.sessionId = text(meta.session_id) || event.session_id || next.sessionId;
      next.turnId = text(meta.turn_id) || event.turn_id || next.turnId;
      break;
    case 'content':
      if (isAnswerContent(event)) next.answer += event.content;
      else if (text(meta.call_kind) === 'quiz_question_emitted') {
        // Quiz questions stream one at a time, each whole.
        const question = quizQuestion(meta.qa_pair);
        if (question) next.quiz = mergeQuiz(next.quiz, [question]);
      }
      break;
    case 'thinking':
    case 'observation':
      if (event.content) next.thoughts = appendThought(next.thoughts, text(meta.call_id) || event.stage || event.type, event.content);
      break;
    case 'tool_call': {
      const args = record(meta.args);
      if ((text(meta.tool_name) || event.content) === 'ask_user') next.ask = askOf(args) ?? next.ask;
      next.tools = [
        ...next.tools,
        {
          id: text(meta.call_id) || `tool-${next.tools.length}`,
          name: text(meta.tool_name) || event.content || 'tool',
          args,
          offset: count(meta.assistant_content_offset) ?? next.answer.length,
          done: false,
          result: '',
        },
      ];
      next.activity = text(meta.tool_name) || event.content || next.activity;
      break;
    }
    case 'tool_result': {
      const id = text(meta.call_id);
      next.mastery = applyMasteryResult(next.mastery, meta);
      const askPayload = record(record(meta.tool_metadata).ask_user);
      const asked = askPayload.kind === 'mastery_question' ? null : askOf(askPayload);
      if (asked) {
        // The turn now waits for your answers (sent with `submit_user_reply`).
        next.ask = asked;
        next.status = 'waiting';
        next.activity = null;
      }
      const index = next.tools.findIndex((tool) => tool.id === id && !tool.done);
      if (index >= 0) {
        next.tools = next.tools.map((tool, i) => (i === index ? { ...tool, done: true, result: event.content } : tool));
      } else {
        const name = text(meta.tool_name) || text(meta.tool) || 'tool';
        next.tools = [...next.tools, { id: id || `tool-${next.tools.length}`, name, args: {}, offset: next.answer.length, done: true, result: event.content }];
      }
      break;
    }
    case 'progress':
      if (text(meta.trace_kind) === 'user_reply') {
        // Your answers reached the turn (saved with the reply, so a reopened chat shows them).
        const answers: Record<string, string> = {};
        for (const item of Array.isArray(meta.answers) ? meta.answers : []) {
          const answer = record(item);
          if (text(answer.questionId)) answers[text(answer.questionId)] = text(answer.text);
        }
        next.askAnswers = answers;
        if (next.status === 'waiting') next.status = 'running';
      } else if (text(meta.trace_kind) === 'ask_user_draft') {
        // The questions as the model writes them; the tool result settles them.
        if (next.status !== 'waiting') next.ask = askOf(meta.ask_user_draft) ?? next.ask;
      } else if (text(meta.call_state) === 'running') next.activity = event.content || text(meta.label) || next.activity;
      break;
    case 'stage_start':
      next.activity = stageLabel(event.stage) || next.activity;
      if (event.stage && !next.stages.some((stage) => stage.name === event.stage)) next.stages = [...next.stages, { name: event.stage, done: false }];
      break;
    case 'stage_end':
      next.stages = next.stages.map((stage) => (stage.name === event.stage ? { ...stage, done: true } : stage));
      break;
    case 'sources':
      next.sources = mergeSources(next.sources, meta.sources);
      break;
    case 'result': {
      next.result = meta;
      const summary = record(meta.summary);
      if (Array.isArray(summary.results)) {
        const questions = summary.results.flatMap((item) => {
          const question = quizQuestion(record(item).qa_pair ?? item);
          return question ? [question] : [];
        });
        next.quiz = mergeQuiz(next.quiz, questions);
      }
      next.visual = visualOf(meta) ?? next.visual;
      next.outline = outlineOf(meta) ?? next.outline;
      // Some capabilities send their answer only here.
      const response = text(meta.response);
      if (!next.answer.trim() && response) next.answer = response;
      break;
    }
    case 'error':
      next.error = event.content || text(meta.message) || 'DeepTutor reported an error.';
      if (meta.turn_terminal === true || text(meta.status) === 'failed') next.status = 'failed';
      break;
    case 'wait_for_input':
      next.status = 'waiting';
      next.question = { prompt: event.content, details: meta };
      break;
    case 'done': {
      const status = text(meta.status);
      next.status = status === 'failed' || status === 'cancelled' ? status : next.status === 'failed' ? 'failed' : 'completed';
      next.userMessageId = count(meta.user_message_id) ?? next.userMessageId;
      next.assistantMessageId = count(meta.assistant_message_id) ?? next.assistantMessageId;
      next.activity = null;
      next.question = null;
      break;
    }
    case 'session_meta':
      break;
  }
  return next;
}

export function replyFromEvents(events: DtStreamEvent[], start: DtReply = emptyReply()): DtReply {
  return events.reduce(applyTurnEvent, start);
}

/**
 * A saved reply: its text, with the tool calls its saved events record (where they happened
 * and what they returned). Reasoning isn't saved with the message.
 */
export function savedReply(message: DtMessage): DtReply {
  const events = (Array.isArray(message.events) ? message.events : []).flatMap((raw) => {
    const event = parseServerEvent(raw);
    return event && 'seq' in event ? [{ ...event, seq: 0 }] : [];
  });
  const first = events[0];
  const reply = replyFromEvents(events, { ...emptyReply(first?.session_id || null, first?.turn_id || null), status: 'completed' });
  return { ...reply, answer: message.content ?? reply.answer, status: reply.status === 'running' ? 'completed' : reply.status, activity: null };
}

export type DtReplySegment = { kind: 'text'; text: string } | { kind: 'tools'; tools: DtToolStep[] };

/** The answer split where tools were called, for showing each call in its place. */
export function replySegments(reply: Pick<DtReply, 'answer' | 'tools'>): DtReplySegment[] {
  const segments: DtReplySegment[] = [];
  const tools = [...reply.tools].sort((a, b) => a.offset - b.offset);
  let position = 0;
  for (const tool of tools) {
    const offset = Math.min(Math.max(tool.offset, position), reply.answer.length);
    if (offset > position) segments.push({ kind: 'text', text: reply.answer.slice(position, offset) });
    position = offset;
    const last = segments[segments.length - 1];
    if (last?.kind === 'tools') last.tools.push(tool);
    else segments.push({ kind: 'tools', tools: [tool] });
  }
  if (position < reply.answer.length) segments.push({ kind: 'text', text: reply.answer.slice(position) });
  return segments.filter((segment) => segment.kind === 'tools' || segment.text.trim());
}

/** A short line for a tool step: what it looked for, when its arguments say. */
export function toolSummary(tool: DtToolStep): string {
  const query = text(tool.args.query) || text(tool.args.q) || text(tool.args.prompt) || text(tool.args.title) || text(tool.args.url);
  return query;
}
