import { getAdminConfig, saveAdminConfig } from './adminSettings';
import type { OwuiClient } from './http';
import { INTERFACE_SETTINGS, uiValue, withUiChanges } from './settings';

type Tree = Record<string, unknown>;

const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The Interface settings everyone starts with (Admin → General → Default Interface Settings on
 * the web; the admin config's `DEFAULT_INTERFACE_SETTINGS`). The server merges them under each
 * person's own when it hands out settings, and leaves a value equal to them out when it saves
 * someone's, so whatever a person hasn't set follows them.
 */
export function interfaceDefaultsOf(config: Tree | null | undefined): Tree {
  const value = config?.DEFAULT_INTERFACE_SETTINGS;
  return isTree(value) ? value : {};
}

/** Whether a setting (a dotted path) has a value in these settings. */
export function hasSettingAt(tree: Tree, path: string): boolean {
  const value = uiValue(tree, path);
  return value !== undefined && value !== null;
}

/** Top-level settings the app shows (its Interface switches, and the chat direction). */
const SHOWN = new Set([...Object.values(INTERFACE_SETTINGS).map((setting) => setting.path.split('.')[0] ?? ''), 'chatDirection']);

/** What the defaults set that the app doesn't show: the web's other display settings, by name. */
export function otherDefaultKeys(defaults: Tree): string[] {
  return Object.keys(defaults)
    .filter((key) => !SHOWN.has(key) && defaults[key] !== null && defaults[key] !== undefined)
    .sort();
}

/** Without the empty groups a removed nested setting leaves behind. */
export function withoutEmpty(tree: Tree): Tree {
  const result: Tree = {};
  for (const [key, value] of Object.entries(tree)) {
    if (value === undefined || value === null) continue;
    if (isTree(value)) {
      const inner = withoutEmpty(value);
      if (Object.keys(inner).length) result[key] = inner;
    } else result[key] = value;
  }
  return result;
}

/**
 * Saves changes to the defaults (dotted paths; `undefined` takes one away), or clears them first,
 * over the server's admin config as it is now: nothing else in it, and no default changed
 * elsewhere meanwhile, is lost. Answers with the defaults the server kept.
 */
export async function saveInterfaceDefaults(client: OwuiClient, changes: Record<string, unknown>, options: { clear?: boolean } = {}): Promise<Tree> {
  const config = await getAdminConfig(client);
  const next = withoutEmpty(withUiChanges(options.clear ? {} : interfaceDefaultsOf(config), changes));
  const saved = await saveAdminConfig(client, { ...config, DEFAULT_INTERFACE_SETTINGS: next });
  return isTree(saved.DEFAULT_INTERFACE_SETTINGS) ? saved.DEFAULT_INTERFACE_SETTINGS : next;
}
