import type { OwuiClient } from './http';
import type { ServerConfig } from './server';

/** What running Python answers: what it printed, its errors, and the value of its last line. */
export interface CodeOutput {
  stdout: string;
  stderr: string;
  result: unknown;
}

/**
 * Where a code block's Run runs on this server, as the web decides: the server's Jupyter when the
 * admin chose it, otherwise Pyodide (in the browser on the web, in the app here). Null when the
 * admin turned code execution off.
 */
export function codeRunEngine(config: ServerConfig | undefined): 'jupyter' | 'pyodide' | null {
  if (config?.features?.enable_code_execution === false) return null;
  const engine = (config?.code as { engine?: unknown } | undefined)?.engine;
  return engine === 'jupyter' ? 'jupyter' : 'pyodide';
}

/** Where the server keeps Pyodide (the web loads it from there too), ending in a slash. */
export function pyodideIndexUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/pyodide/`;
}

/** `POST /api/v1/utils/code/execute`: Python run on the server's Jupyter (refused unless the admin chose Jupyter). */
export async function executeCode(client: OwuiClient, code: string): Promise<CodeOutput> {
  const reply = await client.post<Record<string, unknown> | null>('/api/v1/utils/code/execute', { code });
  return { stdout: text(reply?.stdout), stderr: text(reply?.stderr), result: reply?.result ?? null };
}

/**
 * Takes the pictures out of printed output: lines that are `data:image/…;base64,…` (how a
 * plot's `show()` prints in the browser), returned apart, in order.
 */
export function splitOutputImages(output: string): { text: string; images: string[] } {
  const images: string[] = [];
  const lines = output.split('\n').filter((line) => {
    const picture = /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/.test(line.trim());
    if (picture) images.push(line.trim());
    return !picture;
  });
  return { text: lines.join('\n'), images };
}

/** A code block's language as Python, or code without one that reads like Python. */
export function isPythonBlock(lang: string | undefined, code: string): boolean {
  const name = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (name === 'python' || name === 'py' || name === 'python3') return true;
  if (name) return false;
  return /^\s*(?:def \w+\(|class \w+[(:]|import \w|from [\w.]+ import |print\(|if __name__ ==|for \w+(?:, ?\w+)* in .+:\s*$)/m.test(code);
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
