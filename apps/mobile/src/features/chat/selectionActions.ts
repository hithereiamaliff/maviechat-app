/*
 * What the web offers on text you select in a reply ("floating action buttons"): Ask and
 * Explain, or your own from Settings → Interface on the web (`ui.floatingActionButtons`). In
 * 0.11.3 each one puts a prompt in the message box, the selection quoted, and you send it.
 */

export interface SelectionAction {
  id: string;
  label: string;
  /** With `{{SELECTED_CONTENT}}` (the selection quoted), `{{CONTENT}}` (as is) and `{{INPUT_CONTENT}}` (what you type). */
  prompt: string;
  /** Asks you for `{{INPUT_CONTENT}}` first. */
  input: boolean;
}

export const DEFAULT_SELECTION_ACTIONS: SelectionAction[] = [
  { id: 'ask', label: 'Ask', prompt: '{{SELECTED_CONTENT}}\n\n\n{{INPUT_CONTENT}}', input: true },
  { id: 'explain', label: 'Explain', prompt: '{{SELECTED_CONTENT}}\n\n\nExplain', input: false },
];

/** Yours from the web's settings, else Ask and Explain. */
export function selectionActions(ui: Record<string, unknown> | null | undefined): SelectionAction[] {
  const saved = ui?.floatingActionButtons;
  if (!Array.isArray(saved)) return DEFAULT_SELECTION_ACTIONS;
  return saved.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    const prompt = typeof row.prompt === 'string' ? row.prompt : '';
    if (!label || !prompt) return [];
    return [{ id: typeof row.id === 'string' && row.id ? row.id : `action-${index}`, label, prompt, input: row.input === true }];
  });
}

/** The prompt an action puts in the message box, built as the web builds it. */
export function selectionPrompt(action: SelectionAction, selected: string, input: string): string {
  const quoted = selected
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  let prompt = action.prompt
    // A tool's variable keeps its name; the old {{TOOL:id}} marks go. (The name can't hold braces,
    // so it never reaches back into an earlier {{…}}.)
    .replace(/\{\{([^{}|]*)\|tool:id="([^"]+)"\}\}/g, '$1')
    .replace(/\{\{TOOL:([^}]+)\}\}/g, '');
  if (action.input) prompt = prompt.replace('{{INPUT_CONTENT}}', () => input);
  return prompt.replace('{{CONTENT}}', () => selected).replace('{{SELECTED_CONTENT}}', () => quoted);
}
