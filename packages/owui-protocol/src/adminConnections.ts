import type { OwuiClient } from './http';

/*
 * Admin → Connections (Open WebUI 0.11.3): the OpenAI-compatible and Ollama servers models come
 * from. Each kind is saved whole (addresses, keys and per-connection settings, keyed "0", "1"…
 * by position); leaving out its on/off switch would store null and switch the kind off, so every
 * save is a fresh read with only the admin's change applied. Keys come back in plain text: the
 * app shows them masked and sends them back unchanged unless edited.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : '')) : []);

export type ConnectionKind = 'openai' | 'ollama';

const KEYS = {
  openai: { enable: 'ENABLE_OPENAI_API', urls: 'OPENAI_API_BASE_URLS', configs: 'OPENAI_API_CONFIGS' },
  ollama: { enable: 'ENABLE_OLLAMA_API', urls: 'OLLAMA_BASE_URLS', configs: 'OLLAMA_API_CONFIGS' },
} as const;

/** One connection: where, its key (for OpenAI-compatible ones, kept beside the addresses; Ollama's in its settings), and its settings as stored. */
export interface Connection {
  index: number;
  url: string;
  key: string;
  config: Tree;
  /** A connection is on unless its settings say `enable: false`. */
  enabled: boolean;
}

export async function getConnectionConfig(client: OwuiClient, kind: ConnectionKind): Promise<Tree> {
  return record(await client.get<unknown>(kind === 'openai' ? '/openai/config' : '/ollama/config'));
}

/** Saves a kind's whole config (built by the helpers below from a fresh read). */
export async function saveConnectionConfig(client: OwuiClient, kind: ConnectionKind, config: Tree): Promise<Tree> {
  const keys = KEYS[kind];
  const body: Tree = { [keys.enable]: config[keys.enable] ?? null, [keys.urls]: strings(config[keys.urls]), [keys.configs]: record(config[keys.configs]) };
  if (kind === 'openai') body.OPENAI_API_KEYS = strings(config.OPENAI_API_KEYS);
  return record(await client.post<unknown>(kind === 'openai' ? '/openai/config/update' : '/ollama/config/update', body));
}

export const connectionKindOn = (config: Tree, kind: ConnectionKind): boolean => config[KEYS[kind].enable] === true;

export function connectionsOf(config: Tree, kind: ConnectionKind): Connection[] {
  const urls = strings(config[KEYS[kind].urls]);
  const keys = strings(config.OPENAI_API_KEYS);
  const configs = record(config[KEYS[kind].configs]);
  return urls.map((url, index) => {
    const own = record(configs[String(index)]);
    return { index, url, key: kind === 'openai' ? (keys[index] ?? '') : typeof own.key === 'string' ? own.key : '', config: own, enabled: own.enable !== false };
  });
}

/** The kind switched on or off, everything else as read. */
export function withKindOn(config: Tree, kind: ConnectionKind, on: boolean): Tree {
  return { ...config, [KEYS[kind].enable]: on };
}

/** What an edit of one connection may change; settings are merged key by key (undefined removes one). */
export interface ConnectionChange {
  url?: string;
  key?: string;
  settings?: Record<string, unknown>;
}

/** One connection changed, the others (and everything it doesn't touch) exactly as read. */
export function withConnectionChange(config: Tree, kind: ConnectionKind, index: number, change: ConnectionChange): Tree {
  const keys = KEYS[kind];
  const urls = strings(config[keys.urls]);
  if (index < 0 || index >= urls.length) throw new Error('That connection is no longer there.');
  const next: Tree = { ...config };
  if (change.url !== undefined) next[keys.urls] = urls.map((url, at) => (at === index ? change.url?.trim() ?? url : url));
  const configs = { ...record(config[keys.configs]) };
  const own: Tree = { ...record(configs[String(index)]) };
  for (const [key, value] of Object.entries(change.settings ?? {})) {
    if (value === undefined) delete own[key];
    else own[key] = value;
  }
  if (change.key !== undefined) {
    if (kind === 'openai') {
      const apiKeys = strings(config.OPENAI_API_KEYS);
      while (apiKeys.length < urls.length) apiKeys.push('');
      apiKeys[index] = change.key;
      next.OPENAI_API_KEYS = apiKeys;
    } else own.key = change.key;
  }
  if (change.settings !== undefined || (kind === 'ollama' && change.key !== undefined)) {
    configs[String(index)] = own;
    next[keys.configs] = configs;
  }
  return next;
}

/** A new connection at the end, on unless its settings say otherwise. */
export function withConnectionAdded(config: Tree, kind: ConnectionKind, added: { url: string; key: string; settings: Record<string, unknown> }): Tree {
  const keys = KEYS[kind];
  const urls = strings(config[keys.urls]);
  const index = urls.length;
  const own: Tree = Object.fromEntries(Object.entries(added.settings).filter(([, value]) => value !== undefined));
  if (kind === 'ollama' && added.key) own.key = added.key;
  const next: Tree = { ...config, [keys.urls]: [...urls, added.url.trim()], [keys.configs]: { ...record(config[keys.configs]), [String(index)]: own } };
  if (kind === 'openai') {
    const apiKeys = strings(config.OPENAI_API_KEYS);
    while (apiKeys.length < urls.length) apiKeys.push('');
    next.OPENAI_API_KEYS = [...apiKeys, added.key];
  }
  return next;
}

/** One connection taken out: the ones after it move up, their keys and settings with them. */
export function withConnectionRemoved(config: Tree, kind: ConnectionKind, index: number): Tree {
  const keys = KEYS[kind];
  const urls = strings(config[keys.urls]);
  if (index < 0 || index >= urls.length) throw new Error('That connection is no longer there.');
  const configs = record(config[keys.configs]);
  const shifted: Tree = {};
  urls.forEach((_, at) => {
    if (at === index) return;
    const own = configs[String(at)];
    if (own !== undefined) shifted[String(at < index ? at : at - 1)] = own;
  });
  const next: Tree = { ...config, [keys.urls]: urls.filter((_, at) => at !== index), [keys.configs]: shifted };
  if (kind === 'openai') next.OPENAI_API_KEYS = strings(config.OPENAI_API_KEYS).filter((_, at) => at !== index);
  return next;
}

/** Whether the connection at an index is still the one the admin opened (same address). */
export const sameConnection = (config: Tree, kind: ConnectionKind, index: number, url: string): boolean => strings(config[KEYS[kind].urls])[index] === url;

/** Direct connections (people's own) and caching providers' model lists. */
export async function getConnectionSwitches(client: OwuiClient): Promise<{ direct: boolean; cache: boolean }> {
  const row = record(await client.get<unknown>('/api/v1/configs/connections'));
  return { direct: row.ENABLE_DIRECT_CONNECTIONS === true, cache: row.ENABLE_BASE_MODELS_CACHE === true };
}

export async function saveConnectionSwitches(client: OwuiClient, switches: { direct: boolean; cache: boolean }): Promise<void> {
  await client.post<unknown>('/api/v1/configs/connections', { ENABLE_DIRECT_CONNECTIONS: switches.direct, ENABLE_BASE_MODELS_CACHE: switches.cache });
}

/**
 * Asks the provider for its models with this address and key (the server calls it). Answers
 * how many models it listed, or throws with the provider's reason.
 */
export async function verifyConnection(client: OwuiClient, kind: ConnectionKind, connection: { url: string; key: string; config?: Tree }): Promise<number | null> {
  const body = kind === 'openai' ? { url: connection.url, key: connection.key, config: connection.config ?? {} } : { url: connection.url, key: connection.key || null };
  const answer = record(await client.post<unknown>(kind === 'openai' ? '/openai/verify' : '/ollama/verify', body, { timeoutMs: 30_000 }));
  const models = Array.isArray(answer.data) ? answer.data : Array.isArray(answer.models) ? answer.models : null;
  return models ? models.length : null;
}

/** Tags as stored (`{name}`), from a comma list. */
export const tagsFromText = (text: string): { name: string }[] =>
  text
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((name) => ({ name }));

/** Model ids from a comma or line list. */
export const idsFromText = (text: string): string[] =>
  text
    .split(/[,\n]/)
    .map((id) => id.trim())
    .filter(Boolean);

/** Headers as stored: a JSON object, or a reason it isn't one. */
export function headersFromText(text: string): { headers: Tree | null; problem: string | null } {
  if (!text.trim()) return { headers: null, problem: null };
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { headers: null, problem: 'Headers must be a JSON object, like {"X-Team": "a"}.' };
    return { headers: parsed as Tree, problem: null };
  } catch {
    return { headers: null, problem: 'That isn’t valid JSON.' };
  }
}
