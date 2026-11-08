import type { Capabilities } from './capabilities';

/** Pages the web pins under Search in the sidebar (`ui.pinnedMenuItems`). */
export type ShortcutId = 'notes' | 'workspace' | 'automations' | 'calendar' | 'playground';

/** What the web pins when the user never changed it. */
export const DEFAULT_SHORTCUTS: readonly ShortcutId[] = ['notes', 'workspace'];

const KNOWN: readonly ShortcutId[] = ['notes', 'workspace', 'automations', 'calendar', 'playground'];

/** Workspace is open to admins and to anyone holding one of its permissions. */
export function canUseWorkspace(capabilities: Capabilities): boolean {
  return ['models', 'knowledge', 'prompts', 'tools', 'skills'].some((area) => capabilities.can(`workspace.${area}`));
}

/** Whether this account may use a page (and so pin it). */
export function canUseShortcut(capabilities: Capabilities, id: ShortcutId): boolean {
  switch (id) {
    case 'notes':
      return capabilities.feature('notes', true);
    case 'workspace':
      return canUseWorkspace(capabilities);
    case 'automations':
      return capabilities.feature('automations');
    case 'calendar':
      return capabilities.feature('calendar');
    case 'playground':
      return capabilities.isAdmin;
  }
}

/** Every page this account may pin, the pinned ones first in their order, then the rest. */
export function shortcutChoices(capabilities: Capabilities, pinned: unknown): { order: ShortcutId[]; pinned: ShortcutId[] } {
  const shown = sidebarShortcuts(capabilities, pinned);
  const rest = KNOWN.filter((id) => !shown.includes(id) && canUseShortcut(capabilities, id));
  return { order: [...shown, ...rest], pinned: shown };
}

/**
 * The pins to save (`ui.pinnedMenuItems`) after choosing and ordering this account's pages: the
 * chosen ones in their order; ids the app doesn't know (a newer server's pages) and pages this
 * account can't use now stay pinned, after them, as they were.
 */
export function withShortcuts(capabilities: Capabilities, saved: unknown, order: readonly ShortcutId[], chosen: readonly ShortcutId[]): string[] {
  const before = Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string' && id.length > 0) : [...DEFAULT_SHORTCUTS];
  const picked = order.filter((id) => chosen.includes(id));
  const kept = before.filter((id) => !KNOWN.includes(id as ShortcutId) || !canUseShortcut(capabilities, id as ShortcutId));
  return [...new Set([...picked, ...kept])];
}

/** The pinned shortcuts this account sees, in the user's order. Unknown ids are skipped. */
export function sidebarShortcuts(capabilities: Capabilities, pinned: unknown): ShortcutId[] {
  const ids = Array.isArray(pinned) ? pinned.filter((id): id is ShortcutId => KNOWN.includes(id as ShortcutId)) : DEFAULT_SHORTCUTS;
  return [...new Set(ids)].filter((id) => canUseShortcut(capabilities, id));
}
