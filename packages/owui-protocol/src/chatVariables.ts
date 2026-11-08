import type { OwuiClient } from './http';
import type { ModelItem } from './models';
import type { InputVariable } from './prompts';

/**
 * A value a model's system prompt asks each chat for (`{{chat.variables.key | type:…}}`). The
 * server reads the prompt and lists them in the model's `info.meta.chat_variables_schema`.
 */
export interface ChatVariableField {
  key: string;
  /** text (default), textarea, select, number, … as for a prompt's variables. */
  type: string;
  required: boolean;
  label?: string;
  placeholder?: string;
  default?: string;
  options: string[];
  min?: number;
  max?: number;
  step?: number;
}

type Tree = Record<string, unknown>;

const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined);
const optional = (value: unknown): string | undefined => (value === undefined || value === null ? undefined : String(value));

/** The raw fields as the server lists them, each with its settings, `required` aside. */
function rawFields(model: ModelItem | undefined): Tree[] {
  const schema = record(record(model?.info?.meta).chat_variables_schema);
  return (Array.isArray(schema.fields) ? schema.fields : []).map(record).filter((field) => typeof field.key === 'string' && field.key.length > 0);
}

function fieldOf(raw: Tree): ChatVariableField {
  return {
    key: String(raw.key),
    type: typeof raw.type === 'string' && raw.type ? raw.type : 'text',
    required: Boolean(raw.required),
    ...(typeof raw.label === 'string' && raw.label ? { label: raw.label } : {}),
    ...(optional(raw.placeholder) !== undefined ? { placeholder: optional(raw.placeholder) } : {}),
    ...(optional(raw.default) !== undefined ? { default: optional(raw.default) } : {}),
    options: Array.isArray(raw.options) ? raw.options.map((option) => String(option)) : [],
    ...(number(raw.min) !== undefined ? { min: number(raw.min) } : {}),
    ...(number(raw.max) !== undefined ? { max: number(raw.max) } : {}),
    ...(number(raw.step) !== undefined ? { step: number(raw.step) } : {}),
  };
}

/** Whether any of these models asks the chat for values (the web's Chat Variables button). */
export const hasChatVariables = (models: (ModelItem | undefined)[]): boolean => models.some((model) => rawFields(model).length > 0);

/** The same key asked for in different ways by the chosen models. */
export interface ChatVariableConflict {
  key: string;
  modelIds: string[];
}

export interface ChatVariablesForm {
  fields: ChatVariableField[];
  conflicts: ChatVariableConflict[];
  /** Nothing filled in, and no defaults: the web asks before the first message. */
  empty: boolean;
  /** A required one with no value and no default. */
  missing: boolean;
}

const hasValue = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

/**
 * The chosen models' chat variables as one form, as the web merges them: a key asked for the
 * same way by several models is one field (required if any requires it); asked for differently,
 * it's a conflict the chat can't go on with.
 */
export function chatVariablesForm(models: (ModelItem | undefined)[], values: Tree): ChatVariablesForm {
  const byKey = new Map<string, { field: ChatVariableField; shape: string; modelIds: string[] }>();
  const conflicts: ChatVariableConflict[] = [];
  for (const model of models) {
    if (!model) continue;
    for (const raw of rawFields(model)) {
      const field = fieldOf(raw);
      // Its settings but `required`, which merges instead of conflicting.
      const rest: Tree = { ...raw, type: field.type };
      delete rest.required;
      const shape = JSON.stringify(Object.keys(rest).sort().map((key) => [key, rest[key]]));
      const seen = byKey.get(field.key);
      if (!seen) {
        byKey.set(field.key, { field, shape, modelIds: [model.id] });
      } else if (seen.shape !== shape) {
        const conflict = conflicts.find((item) => item.key === field.key);
        if (conflict) conflict.modelIds.push(model.id);
        else conflicts.push({ key: field.key, modelIds: [...seen.modelIds, model.id] });
      } else {
        seen.field = { ...seen.field, required: seen.field.required || field.required };
        seen.modelIds.push(model.id);
      }
    }
  }
  const fields = [...byKey.values()].map((item) => item.field);
  return {
    fields,
    conflicts,
    empty: fields.length > 0 && fields.every((field) => !hasValue(values[field.key]) && !hasValue(field.default)),
    missing: fields.some((field) => field.required && !hasValue(values[field.key]) && !hasValue(field.default)),
  };
}

/** The form's fields for the variables sheet, each starting from the chat's value or its default. */
export function chatVariableInputs(form: ChatVariablesForm, values: Tree): InputVariable[] {
  return form.fields.map((field) => ({
    name: field.key,
    type: field.type,
    required: field.required,
    options: field.options,
    ...(field.label ? { label: field.label } : {}),
    ...(field.placeholder !== undefined ? { placeholder: field.placeholder } : {}),
    ...(hasValue(values[field.key]) ? { default: String(values[field.key]) } : field.default !== undefined ? { default: field.default } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.step !== undefined ? { step: field.step } : {}),
  }));
}

/** A saved chat's own values (`variables`). */
export const chatVariablesOf = (chat: unknown): Tree => record(record(chat).variables);

/** Keeps a saved chat's values (the web's Save in Chat Variables); the rest of the chat stays as it is. */
export async function saveChatVariables(client: OwuiClient, chatId: string, variables: Tree): Promise<Tree> {
  const saved = await client.post<{ variables?: unknown } | null>(`/api/v1/chats/${encodeURIComponent(chatId)}`, { chat: {}, variables });
  return chatVariablesOf(saved);
}
