import type { OwuiClient } from './http';

/*
 * User valves: per-user settings of a tool or function (Open WebUI 0.11.3), edited in the
 * Controls panel. A tool or function that defines `UserValves` describes them as a JSON schema;
 * a valve left at null uses the tool's own default.
 */

export type ValvesOwner = 'tools' | 'functions';

/** A function (filter, action or pipe) from `GET /api/v1/functions/`. */
export interface FunctionItem {
  id: string;
  name: string;
  type?: string;
  is_active?: boolean;
  is_global?: boolean;
  [key: string]: unknown;
}

export async function listFunctions(client: OwuiClient): Promise<FunctionItem[]> {
  return (await client.get<FunctionItem[] | null>('/api/v1/functions/')) ?? [];
}

/** One valve as the schema describes it (a Pydantic field). */
export interface ValveProperty {
  title?: string;
  description?: string;
  type?: string;
  enum?: unknown[];
  default?: unknown;
  anyOf?: { type?: string }[];
  input?: { type?: string; options?: unknown };
  [key: string]: unknown;
}

export interface ValvesSpec {
  properties?: Record<string, ValveProperty>;
  required?: string[];
  [key: string]: unknown;
}

const valvesPath = (owner: ValvesOwner, id: string) => `/api/v1/${owner}/id/${encodeURIComponent(id)}/valves/user`;

/** The schema, or null when it has no user valves. */
export function getUserValvesSpec(client: OwuiClient, owner: ValvesOwner, id: string): Promise<ValvesSpec | null> {
  return client.get<ValvesSpec | null>(`${valvesPath(owner, id)}/spec`);
}

/** Your values (null or missing: the default). */
export async function getUserValves(client: OwuiClient, owner: ValvesOwner, id: string): Promise<Record<string, unknown>> {
  return (await client.get<Record<string, unknown> | null>(valvesPath(owner, id))) ?? {};
}

/** Saves your values; the server drops nulls (defaults), checks the rest and answers with what it kept. */
export async function updateUserValves(client: OwuiClient, owner: ValvesOwner, id: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (await client.post<Record<string, unknown> | null>(`${valvesPath(owner, id)}/update`, values)) ?? {};
}

export type ValveKind = 'select' | 'multiselect' | 'boolean' | 'number' | 'integer' | 'list' | 'password' | 'color' | 'text';

/** A valve ready to edit. */
export interface ValveField {
  key: string;
  title: string;
  description: string;
  required: boolean;
  kind: ValveKind;
  options: { value: string; label: string }[];
  default: unknown;
}

function optionsOf(raw: unknown): { value: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((option) => {
    if (typeof option === 'string' || typeof option === 'number') return [{ value: String(option), label: String(option) }];
    if (option && typeof option === 'object' && 'value' in option) {
      const { value, label } = option as { value: unknown; label?: unknown };
      return [{ value: String(value), label: typeof label === 'string' ? label : String(value) }];
    }
    return [];
  });
}

/** The schema's type, looking through `Optional[...]` (anyOf with null). */
function typeOf(property: ValveProperty): string | undefined {
  return property.type ?? property.anyOf?.find((part) => part.type && part.type !== 'null')?.type;
}

/** The valves to show, in the schema's order, each with the input it needs. */
export function valveFields(spec: ValvesSpec | null | undefined): ValveField[] {
  const required = new Set(spec?.required ?? []);
  return Object.entries(spec?.properties ?? {}).map(([key, property]) => {
    const type = typeOf(property);
    const inputType = property.input?.type;
    const inputOptions = optionsOf(property.input?.options);
    let kind: ValveKind;
    let options: ValveField['options'] = [];
    if (Array.isArray(property.enum)) {
      kind = 'select';
      options = optionsOf(property.enum);
    } else if (type === 'boolean') kind = 'boolean';
    else if (inputType === 'multiselect' && inputOptions.length) {
      kind = 'multiselect';
      options = inputOptions;
    } else if (type === 'integer') kind = 'integer';
    else if (type === 'number') kind = 'number';
    else if (type === 'array') kind = 'list';
    else if (inputType === 'password') kind = 'password';
    else if (inputType === 'select' && inputOptions.length) {
      kind = 'select';
      options = inputOptions;
    } else if (inputType === 'color') kind = 'color';
    else kind = 'text';
    return { key, title: property.title ?? key, description: property.description ?? '', required: required.has(key), kind, options, default: property.default };
  });
}

/** What a valve starts at when switched from Default to Custom: its default, or empty. */
export function customStart(field: ValveField): unknown {
  if (field.kind === 'multiselect') return Array.isArray(field.default) ? [...(field.default as unknown[])] : [];
  if (field.kind === 'list') return Array.isArray(field.default) ? (field.default as unknown[]).join(', ') : '';
  if (field.kind === 'boolean') return typeof field.default === 'boolean' ? field.default : false;
  if (field.default === null || field.default === undefined) return '';
  return field.kind === 'number' || field.kind === 'integer' ? String(field.default) : field.default;
}

/** Saved values as the form edits them: lists as comma-separated text, numbers as text. */
export function valvesToForm(fields: ValveField[], values: Record<string, unknown>): Record<string, unknown> {
  const form: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.key];
    if (value === null || value === undefined) form[field.key] = null;
    else if (field.kind === 'list') form[field.key] = Array.isArray(value) ? value.join(', ') : String(value);
    else if (field.kind === 'number' || field.kind === 'integer') form[field.key] = String(value);
    else form[field.key] = value;
  }
  return form;
}

/**
 * The form's values as the server takes them: lists split at commas, numbers read (one that
 * isn't a number is reported, not sent). Null stays null: the default.
 */
export function valvesFromForm(fields: ValveField[], form: Record<string, unknown>): { values: Record<string, unknown>; invalid: string[] } {
  const values: Record<string, unknown> = {};
  const invalid: string[] = [];
  for (const field of fields) {
    const value = form[field.key];
    if (value === null || value === undefined) {
      values[field.key] = null;
    } else if (field.kind === 'list') {
      values[field.key] = String(value)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    } else if (field.kind === 'number' || field.kind === 'integer') {
      const text = String(value).trim();
      const number = field.kind === 'integer' ? Number(text) : Number.parseFloat(text);
      if (!text || !Number.isFinite(number) || (field.kind === 'integer' && !Number.isInteger(number))) invalid.push(field.title);
      else values[field.key] = number;
    } else {
      values[field.key] = value;
    }
  }
  return { values, invalid };
}
