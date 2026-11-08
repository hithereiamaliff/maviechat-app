import type { OwuiClient } from './http';
import { isAtLeast } from './version';

/*
 * Writing a Workspace tool's or an admin function's Python. **Saving runs the code on the
 * server** (it loads it, and installs the packages its header lists), so the app asks first.
 */

export type CodeKind = 'tools' | 'functions';

/** What a tool or function is saved as: its name, what it's for, and its code. */
export interface CodeFields {
  name: string;
  description: string;
  content: string;
}

const idPath = (kind: CodeKind, id: string) => `/api/v1/${kind}/id/${encodeURIComponent(id)}`;

/** Saves new code for a tool; its sharing stays as it is (none is sent). */
export async function updateWorkspaceTool(client: OwuiClient, id: string, fields: CodeFields): Promise<void> {
  await client.post<unknown>(`${idPath('tools', id)}/update`, { id, name: fields.name.trim(), meta: { description: fields.description.trim() }, content: fields.content });
}

/** Saves new code for a function; if it doesn't load, the server says why and keeps the old. */
export async function updateAdminFunction(client: OwuiClient, id: string, fields: CodeFields): Promise<void> {
  await client.post<unknown>(`${idPath('functions', id)}/update`, { id, name: fields.name.trim(), meta: { description: fields.description.trim() }, content: fields.content });
}

/** A tool's or function's code from a link (admins; a GitHub page becomes its raw file), named from the file. */
export async function loadCodeFromLink(client: OwuiClient, kind: CodeKind, url: string): Promise<{ name: string; content: string }> {
  const answer = await client.post<{ name?: unknown; content?: unknown } | null>(`/api/v1/${kind}/load/url`, { url: url.trim() });
  const content = typeof answer?.content === 'string' ? answer.content : '';
  if (!content) throw new Error('The link gave no code');
  return { name: typeof answer?.name === 'string' ? answer.name : '', content };
}

/** The code tidied by the server's Python formatter (admins); unchanged when it's tidy already. */
export async function formatPythonCode(client: OwuiClient, code: string): Promise<string> {
  const answer = await client.post<{ code?: unknown } | null>('/api/v1/utils/code/format', { code });
  return typeof answer?.code === 'string' ? answer.code : code;
}

/** An id made from a name, as Python wants it: lower case, words joined by `_`. */
export function codeIdFromName(name: string): string {
  const id = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(id) ? `_${id}` : id;
}

/** What's wrong with an id the server would refuse; null when it's fine. */
export function codeIdProblem(id: string): string | null {
  if (!id.trim()) return 'It needs an id.';
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(id.trim()) ? null : 'Letters, numbers and _ only, not starting with a number.';
}

/** The `key: value` lines of the docstring the code starts with (title, author, version, requirements…). */
export function frontmatterOf(code: string): Record<string, string> {
  const match = /^\s*("""|''')([\s\S]*?)\1/.exec(code);
  const result: Record<string, string> = {};
  if (!match) return result;
  for (const line of (match[2] ?? '').split('\n')) {
    const pair = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (pair?.[1]) result[pair[1]] = pair[2] ?? '';
  }
  return result;
}

/** Why the server is too old for the code (its `required_open_webui_version`), as the web checks; null otherwise. */
export function versionProblem(code: string, serverVersion: string | null | undefined): string | null {
  const required = frontmatterOf(code).required_open_webui_version?.trim();
  if (!required || !serverVersion || isAtLeast(serverVersion, required)) return null;
  return `It needs Open WebUI ${required} or later; this server runs ${serverVersion}.`;
}

/** What a header says to install on the server, if anything. */
export const requirementsOf = (code: string): string => frontmatterOf(code).requirements?.trim() ?? '';

/** The tools or functions in an export file (the web's and the app's), each with its code. */
export function importedCode(file: unknown): (CodeFields & { id: string })[] {
  const rows = Array.isArray(file) ? file : [file];
  return rows.flatMap((row) => {
    const item = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {};
    const meta = typeof item.meta === 'object' && item.meta !== null ? (item.meta as Record<string, unknown>) : {};
    const content = typeof item.content === 'string' ? item.content : '';
    const name = typeof item.name === 'string' ? item.name : '';
    if (!content || !name) return [];
    const id = typeof item.id === 'string' && item.id ? item.id : codeIdFromName(name);
    return [{ id, name, description: typeof meta.description === 'string' ? meta.description : '', content }];
  });
}

/** A new tool's starting code: one method a model can call. */
export const TOOL_TEMPLATE = `"""
title: My Tool
description: What it does, for people choosing tools.
"""


class Tools:
    def __init__(self):
        pass

    def repeat(self, text: str, times: int = 1) -> str:
        """
        Repeat the text. The model reads this to know when to use the tool.
        :param text: The text to repeat.
        :param times: How many times.
        """
        return " ".join([text] * max(1, times))
`;

/** A new function's starting code: a filter that sees each request and each reply. */
export const FUNCTION_TEMPLATE = `"""
title: My Filter
description: Changes what goes to the model and what comes back.
"""

from pydantic import BaseModel


class Filter:
    class Valves(BaseModel):
        pass

    def __init__(self):
        self.valves = self.Valves()

    def inlet(self, body: dict) -> dict:
        # The request, before the model sees it.
        return body

    def outlet(self, body: dict) -> dict:
        # The reply, before it's shown.
        return body
`;
