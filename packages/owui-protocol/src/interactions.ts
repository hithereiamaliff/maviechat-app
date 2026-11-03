import type { HistoryMessage } from './history';
import type { OwuiClient } from './http';

/*
 * When a reply stops for you (Open WebUI 0.11.3): a tool call waiting for approval (with tool
 * permissions set to "Ask for approval"), or the model's `ask_user` questions. Both are saved in
 * the reply's `output[]`, so they survive the app being closed, and both are answered with
 * `POST /api/v1/chats/{id}/messages/{mid}/resolve`; the server then carries on with the reply.
 * The same questions can also arrive live over the socket (`request:user_input`).
 */

export interface PendingApproval {
  callId: string;
  name: string;
  /** The call's arguments, pretty-printed. */
  argumentsText: string;
}

export interface AskUserOption {
  label: string;
  description: string;
}

export interface AskUserQuestion {
  id: string;
  /** A few words naming the question ("Question 1" when the model gave none). */
  header: string;
  question: string;
  /** Two or three; the first is the model's recommendation. */
  options: AskUserOption[];
  /** Whether you may write your own answer instead. */
  allowOther: boolean;
}

/** An answer as the web sends it: a picked option (by position) or your own words. */
export type AskUserAnswer = { type: 'option'; option_index: number; label: string; description: string } | { type: 'other'; text: string };

export interface PendingQuestions {
  callId: string;
  questions: AskUserQuestion[];
}

type OutputLike = { type?: string; name?: string; status?: string; call_id?: string; id?: string; arguments?: unknown };

const WAITING = new Set(['pending', 'requires_approval']);

function outputOf(message: Pick<HistoryMessage, 'output'> | undefined): OutputLike[] {
  return Array.isArray(message?.output) ? (message.output as OutputLike[]) : [];
}

function answeredCalls(output: OutputLike[]): Set<string> {
  return new Set(output.filter((item) => item.type === 'function_call_output' && item.call_id).map((item) => item.call_id as string));
}

/** Tool arguments arrive as an object or as JSON text, sometimes encoded twice. */
export function toolArguments(raw: unknown): Record<string, unknown> {
  let value = raw;
  for (let depth = 0; typeof value === 'string' && depth < 3; depth += 1) {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Tool calls in a reply that wait for your approval. */
export function pendingApprovals(message: Pick<HistoryMessage, 'output'> | undefined): PendingApproval[] {
  const output = outputOf(message);
  const answered = answeredCalls(output);
  return output.flatMap((item) => {
    const callId = item.call_id ?? item.id;
    if (item.type !== 'function_call' || item.name === 'ask_user' || !WAITING.has(item.status ?? '') || !callId || answered.has(callId)) return [];
    const args = toolArguments(item.arguments);
    return [{ callId, name: item.name ?? 'tool', argumentsText: Object.keys(args).length ? JSON.stringify(args, null, 2) : '' }];
  });
}

/** The model's questions, as `ask_user` or a `request:user_input` event sends them (1–3, each with 2–3 options). */
export function askUserQuestions(raw: unknown, allowOther = true): AskUserQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index): AskUserQuestion[] => {
    const question = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const id = typeof question.id === 'string' && question.id.trim() ? question.id.trim() : '';
    const text = typeof question.question === 'string' ? question.question.trim() : '';
    if (!id || !text) return [];
    const options = (Array.isArray(question.options) ? question.options : []).flatMap((option): AskUserOption[] => {
      const value = (typeof option === 'object' && option !== null ? option : {}) as Record<string, unknown>;
      const label = typeof value.label === 'string' ? value.label.trim() : '';
      return label ? [{ label, description: typeof value.description === 'string' ? value.description.trim() : '' }] : [];
    });
    return [
      {
        id,
        header: typeof question.header === 'string' && question.header.trim() ? question.header.trim() : `Question ${index + 1}`,
        question: text,
        options,
        allowOther: typeof question.allow_other === 'boolean' ? question.allow_other : allowOther,
      },
    ];
  });
}

/** The model's questions waiting in a reply (saved, so answerable after the app was closed). */
export function pendingAskUser(message: Pick<HistoryMessage, 'output'> | undefined): PendingQuestions | null {
  const output = outputOf(message);
  const answered = answeredCalls(output);
  const call = output.find((item) => item.type === 'function_call' && item.name === 'ask_user' && item.status === 'pending' && (item.call_id ?? item.id) && !answered.has((item.call_id ?? item.id) as string));
  if (!call) return null;
  const args = toolArguments(call.arguments);
  const questions = askUserQuestions(args.questions, args.allow_other !== false);
  return questions.length ? { callId: (call.call_id ?? call.id) as string, questions } : null;
}

/** A reply that has stopped until you approve something or answer it (not still being written). */
export function awaitingYou(message: Pick<HistoryMessage, 'output'> | undefined): boolean {
  return pendingApprovals(message).length > 0 || pendingAskUser(message) !== null;
}

/** Every question answered (an option, or words for "Other"). */
export function askUserComplete(questions: AskUserQuestion[], answers: Record<string, AskUserAnswer | undefined>): boolean {
  return (
    questions.length > 0 &&
    questions.every((question) => {
      const answer = answers[question.id];
      return answer?.type === 'option' || (answer?.type === 'other' && answer.text.trim() !== '');
    })
  );
}

/** The answers as the server takes them, keyed by question id, words trimmed. */
export function askUserPayload(questions: AskUserQuestion[], answers: Record<string, AskUserAnswer | undefined>): Record<string, AskUserAnswer> {
  const result: Record<string, AskUserAnswer> = {};
  for (const question of questions) {
    const answer = answers[question.id];
    if (answer?.type === 'option') result[question.id] = answer;
    else if (answer?.type === 'other' && answer.text.trim()) result[question.id] = { type: 'other', text: answer.text.trim() };
  }
  return result;
}

export type ResolveAction = 'approve' | 'reject' | 'answer';

/**
 * Answers a stopped reply: approve or reject a tool call, or answer the model's questions
 * (`timedOut` says you let them lapse). The server saves it and carries on with the reply as a
 * new task, whose events reach every open connection of yours.
 */
export function resolveToolCall(
  client: OwuiClient,
  chatId: string,
  messageId: string,
  callId: string,
  action: ResolveAction,
  options: { answers?: Record<string, AskUserAnswer>; timedOut?: boolean } = {},
): Promise<{ status?: boolean; task_ids?: string[]; [key: string]: unknown }> {
  return client.post(`/api/v1/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/resolve`, {
    call_id: callId,
    action,
    ...(options.answers ? { answers: options.answers } : {}),
    ...(options.timedOut ? { timed_out: true } : {}),
  });
}
