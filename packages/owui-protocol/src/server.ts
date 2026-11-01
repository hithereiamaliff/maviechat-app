import type { OwuiClient } from './http';

export interface ServerVersion {
  version: string;
  deployment_id?: string;
}

/**
 * `GET /api/config`. Anonymous callers get name, version, auth options and a few
 * features; signed-in callers get about 45 `features.enable_*` flags plus defaults.
 * Unknown keys are kept so newer servers don't break the app.
 */
export interface ServerConfig {
  status?: boolean;
  name?: string;
  version?: string;
  default_locale?: string;
  oauth?: { providers?: Record<string, string> };
  features?: Record<string, unknown>;
  default_models?: string | null;
  default_prompt_suggestions?: unknown[];
  ui?: Record<string, unknown>;
  [key: string]: unknown;
}

export function getVersion(client: OwuiClient): Promise<ServerVersion> {
  return client.get<ServerVersion>('/api/version');
}

/** Sends the Bearer token when the client has one; the server then returns the signed-in view. */
export function getConfig(client: OwuiClient): Promise<ServerConfig> {
  return client.get<ServerConfig>('/api/config');
}

export function featureFlag(config: ServerConfig, flag: string): boolean {
  return config.features?.[flag] === true;
}

export function featureNumber(config: ServerConfig, key: string, fallback: number): number {
  const value = config.features?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
