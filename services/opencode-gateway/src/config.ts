import { hostname } from 'node:os';
import path from 'node:path';
import type { GatewayConfig, Login } from './gateway.ts';

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * The gateway's settings, from the environment:
 * - `PUBLIC_URL`: where phones reach it (`https://code.example.com`);
 * - `ALLOWED_FOLDERS`: project folders OpenCode may work in, separated by `:`;
 * - `OPENCODE_LOGINS`: JSON `[{id, name, url, username?, passwordEnv}]`, one per `opencode serve`,
 *   each password in the variable `passwordEnv` names;
 * - `MACHINE_NAME` (default: the host name).
 */
export function loadConfig(env: NodeJS.ProcessEnv, log: (line: string) => void): GatewayConfig {
  const publicUrl = required(env, 'PUBLIC_URL').replace(/\/+$/, '');
  if (!/^https:\/\//.test(publicUrl)) throw new Error('PUBLIC_URL must start with https://');
  const folders = required(env, 'ALLOWED_FOLDERS')
    .split(':')
    .map((folder) => folder.trim())
    .filter(Boolean)
    .map((folder) => path.posix.resolve(folder));
  if (folders.length === 0 || folders.some((folder) => folder === '/')) throw new Error('ALLOWED_FOLDERS must list project folders (not "/")');
  let raw: unknown;
  try {
    raw = JSON.parse(required(env, 'OPENCODE_LOGINS'));
  } catch {
    throw new Error('OPENCODE_LOGINS must be JSON');
  }
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('OPENCODE_LOGINS must list at least one OpenCode server');
  const logins: Login[] = raw.map((item: unknown, index) => {
    const value = (item ?? {}) as { id?: unknown; name?: unknown; url?: unknown; username?: unknown; passwordEnv?: unknown };
    if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id)) throw new Error(`OPENCODE_LOGINS[${index}].id must be letters, digits, - or _`);
    if (typeof value.url !== 'string' || !/^https?:\/\//.test(value.url)) throw new Error(`OPENCODE_LOGINS[${index}].url must be an http(s) address`);
    if (typeof value.passwordEnv !== 'string') throw new Error(`OPENCODE_LOGINS[${index}].passwordEnv must name a variable`);
    return {
      id: value.id,
      name: typeof value.name === 'string' && value.name ? value.name : value.id,
      url: value.url.replace(/\/+$/, ''),
      username: typeof value.username === 'string' && value.username ? value.username : 'opencode',
      password: required(env, value.passwordEnv),
    };
  });
  return { machineName: env.MACHINE_NAME || hostname(), publicUrl, folders, logins, log };
}
