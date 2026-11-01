import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const DEFAULT_ENV_FILE = '~/.config/maviechat/owui-test.env';

export function expandHome(file: string): string {
  return file === '~' || file.startsWith('~/') ? path.join(homedir(), file.slice(1)) : file;
}

/** Parses KEY=VALUE lines (comments, blank lines and optional quotes allowed). Values are never logged. */
export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2] ?? '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1] as string] = value;
  }
  return values;
}

export function loadEnvFile(file: string): Record<string, string> | null {
  const resolved = expandHome(file);
  if (!existsSync(resolved)) return null;
  return parseEnv(readFileSync(resolved, 'utf8'));
}
