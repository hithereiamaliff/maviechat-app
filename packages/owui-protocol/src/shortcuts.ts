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

/** The pinned shortcuts this account sees, in the user's order. Unknown ids are skipped. */
export function sidebarShortcuts(capabilities: Capabilities, pinned: unknown): ShortcutId[] {
  const ids = Array.isArray(pinned) ? pinned.filter((id): id is ShortcutId => KNOWN.includes(id as ShortcutId)) : DEFAULT_SHORTCUTS;
  return [...new Set(ids)].filter((id) => {
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
  });
}
