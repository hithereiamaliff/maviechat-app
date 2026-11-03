import type { OwuiClient } from './http';

/*
 * Saved prompts and their variables (Open WebUI 0.11.3), for the input's `/` menu. A prompt's
 * text can hold built-in variables (`{{USER_NAME}}`, `{{CURRENT_DATE}}`, `{{CLIPBOARD}}`, …),
 * filled in as it's inserted, and its own (`{{topic}}`, `{{tone | select:options=["Formal","Casual"]}}`),
 * asked for in a form.
 */

export interface SavedPrompt {
  /** What you type after `/` (without the slash). */
  command: string;
  name: string;
  content: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The saved prompts this account can use. */
export async function listPrompts(client: OwuiClient): Promise<SavedPrompt[]> {
  const body = await client.get<unknown>('/api/v1/prompts/');
  const rows = Array.isArray(body) ? body : Array.isArray((body as { items?: unknown })?.items) ? (body as { items: unknown[] }).items : [];
  return rows
    .flatMap((row): SavedPrompt[] => {
      const item = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>;
      const command = text(item.command).replace(/^\//, '').trim();
      if (!command) return [];
      return [{ command, name: text(item.name) || text(item.title) || command, content: text(item.content) }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Prompts whose command contains what you typed after `/`, by name. */
export function matchPrompts(prompts: SavedPrompt[], query: string): SavedPrompt[] {
  const wanted = query.toLowerCase();
  return prompts.filter((prompt) => prompt.command.toLowerCase().includes(wanted));
}

export interface BuiltinContext {
  name: string;
  email?: string;
  bio?: string;
  gender?: string;
  /** `YYYY-MM-DD`. */
  birthDate?: string;
  language?: string;
  /** Only when you allowed it; else the web's "LOCATION_UNKNOWN". */
  location?: string;
  clipboard?: string;
  timeZone?: string;
  now?: Date;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (value: number) => String(value).padStart(2, '0');

function age(birthDate: string, now: Date): string {
  const born = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(born.getTime())) return '';
  let years = now.getFullYear() - born.getFullYear();
  if (now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) years -= 1;
  return String(years);
}

/**
 * Fills in the built-in variables as the web does when a prompt is inserted. Profile ones you
 * haven't set are left as they are, as on the web; `{{CLIPBOARD}}` only when there's a clipboard.
 */
export function fillBuiltinVariables(content: string, context: BuiltinContext): string {
  const now = context.now ?? new Date();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const values: Record<string, string | undefined> = {
    CLIPBOARD: context.clipboard?.replace(/\r\n/g, '\n'),
    USER_LOCATION: context.location || 'LOCATION_UNKNOWN',
    USER_NAME: context.name || 'User',
    USER_EMAIL: context.email || undefined,
    USER_BIO: context.bio || undefined,
    USER_GENDER: context.gender || undefined,
    USER_BIRTH_DATE: context.birthDate || undefined,
    USER_AGE: context.birthDate ? age(context.birthDate, now) || undefined : undefined,
    USER_LANGUAGE: context.language || 'en-US',
    CURRENT_DATE: date,
    CURRENT_TIME: time,
    CURRENT_DATETIME: `${date} ${time}`,
    CURRENT_TIMEZONE: context.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    CURRENT_WEEKDAY: WEEKDAYS[now.getDay()],
  };
  return content.replace(/{{\s*([A-Z_]+)\s*}}/g, (whole, key: string) => values[key] ?? whole);
}

/** A variable a prompt asks you for, and how (its type and settings, as written after `|`). */
export interface InputVariable {
  name: string;
  /** text (default), textarea, select, number, range, checkbox, date, time, datetime-local, month, week, email, url, tel, color, … */
  type: string;
  placeholder?: string;
  default?: string;
  required: boolean;
  options: string[];
  min?: number;
  max?: number;
  step?: number;
}

/** Splits at `separator` where it isn't inside quotes or brackets. */
function splitOutside(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] as string;
    if (char === '\\' && index + 1 < value.length) {
      current += char + value[index + 1];
      index += 1;
      continue;
    }
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '[' || char === '{')) depth += 1;
    else if (!quoted && (char === ']' || char === '}')) depth -= 1;
    if (char === separator && !quoted && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += char;
  }
  parts.push(current.trim());
  return parts;
}

function propertyValue(raw: string): unknown {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  if (/^[[{]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (raw === 'true' || raw === 'false') return raw === 'true';
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

const asNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * The variables a prompt asks for, in the order they appear (each once): `{{name}}` is a line of
 * text; `{{name | type:prop=value:flag}}` says how to ask. Fill in the built-ins first.
 */
export function inputVariables(content: string): InputVariable[] {
  const found = new Map<string, InputVariable>();
  for (const match of content.matchAll(/{{\s*([^|}\s]+)\s*(?:\|\s*((?:[^}"]|"[^"]*")*))?}}/g)) {
    const name = (match[1] as string).trim();
    const definition = match[2]?.trim();
    if (found.has(name) && !definition) continue;
    const [first = '', ...rest] = definition ? splitOutside(definition, ':') : [];
    const properties: Record<string, unknown> = {};
    for (const part of rest) {
      if (!part) continue;
      const [key = '', ...value] = splitOutside(part, '=');
      if (value.length === 0) properties[key] = true;
      else properties[key] = propertyValue(value.join('='));
    }
    const type = (first.startsWith('type=') ? first.slice(5) : first) || 'text';
    const options = Array.isArray(properties.options) ? properties.options.map((option) => String(option)) : [];
    found.set(name, {
      name,
      type,
      placeholder: typeof properties.placeholder === 'string' ? properties.placeholder : undefined,
      default: properties.default === undefined ? undefined : String(properties.default),
      required: properties.required === true,
      options,
      min: asNumber(properties.min),
      max: asNumber(properties.max),
      step: asNumber(properties.step),
    });
  }
  return [...found.values()];
}

/** Puts your values in for the prompt's variables (`{{name}}` and `{{name | …}}` alike). */
export function applyInputVariables(content: string, values: Record<string, string>): string {
  return content.replace(/{{\s*([^|}\s]+)\s*(?:\|\s*((?:[^}"]|"[^"]*")*))?}}/g, (whole, name: string) => (name in values ? (values[name] as string) : whole));
}

/** The word being typed after a menu character (`/`, `@`, `#`) where the cursor is, if any. */
export interface MenuTrigger {
  char: '/' | '@' | '#';
  query: string;
  /** Where the character is; the text from here to the cursor is replaced on picking. */
  start: number;
}

export function menuTrigger(input: string, cursor: number): MenuTrigger | null {
  const before = input.slice(0, cursor);
  const match = /(^|\s)([/@#])([^\s/@#]*)$/.exec(before);
  if (!match) return null;
  const char = match[2] as MenuTrigger['char'];
  return { char, query: match[3] as string, start: before.length - (match[3] as string).length - 1 };
}

/** The text after picking from a menu: the trigger and query replaced by `insert`, and where the cursor goes. */
export function replaceTrigger(input: string, trigger: MenuTrigger, cursor: number, insert: string): { text: string; cursor: number } {
  const text = input.slice(0, trigger.start) + insert + input.slice(cursor);
  return { text, cursor: trigger.start + insert.length };
}
