/*
 * What the web offers on text you select in a reply ("floating action buttons", its "Quick
 * Actions"): Ask and Explain, or your own list (`ui.floatingActionButtons`), all switched off by
 * `ui.showFloatingActionButtons`. In 0.11.3 each one puts a prompt in the message box, the
 * selection quoted, and you send it.
 */

export interface SelectionAction {
  id: string;
  label: string;
  /** With `{{SELECTED_CONTENT}}` (the selection quoted), `{{CONTENT}}` (as is) and `{{INPUT_CONTENT}}` (what you type). */
  prompt: string;
  /** Asks you for `{{INPUT_CONTENT}}` first: as on the web, when the prompt has it. */
  input: boolean;
}

/** Whether an action's prompt wants something typed (the web asks only then). */
export const wantsInput = (prompt: string): boolean => prompt.includes('{{INPUT_CONTENT}}');

export const DEFAULT_SELECTION_ACTIONS: SelectionAction[] = [
  { id: 'ask', label: 'Ask', prompt: '{{SELECTED_CONTENT}}\n\n\n{{INPUT_CONTENT}}', input: true },
  { id: 'explain', label: 'Explain', prompt: '{{SELECTED_CONTENT}}\n\n\nExplain', input: false },
];

/** Your own list as saved, for the editor; null when you use the defaults. */
export function savedSelectionActions(ui: Record<string, unknown> | null | undefined): SelectionAction[] | null {
  const saved = ui?.floatingActionButtons;
  if (!Array.isArray(saved)) return null;
  return saved.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const prompt = typeof row.prompt === 'string' ? row.prompt : '';
    return [{ id: typeof row.id === 'string' && row.id ? row.id : `action-${index}`, label: typeof row.label === 'string' ? row.label : '', prompt, input: wantsInput(prompt) }];
  });
}

/** The actions offered on a selection: yours (those with a label and a prompt), else Ask and Explain. */
export function selectionActions(ui: Record<string, unknown> | null | undefined): SelectionAction[] {
  const saved = savedSelectionActions(ui);
  if (!saved) return DEFAULT_SELECTION_ACTIONS;
  return saved.flatMap((action) => (action.label.trim() && action.prompt ? [{ ...action, label: action.label.trim() }] : []));
}

/** What's saved for a list (null: back to the defaults), with `input` kept beside the prompt as the web keeps it. */
export function selectionActionsSetting(actions: SelectionAction[] | null): { id: string; label: string; input: boolean; prompt: string }[] | null {
  return actions === null ? null : actions.map((action) => ({ id: action.id, label: action.label.trim(), input: wantsInput(action.prompt), prompt: action.prompt }));
}

/** A new action, as the web adds one: "New Button", asking for input, with an id no other has. */
export function newSelectionAction(actions: SelectionAction[]): SelectionAction {
  let id = 'new-button';
  for (let index = 1; actions.some((action) => action.id === id); index += 1) id = `new-button-${index}`;
  return { id, label: 'New Button', prompt: '{{CONTENT}}\n\n\n{{INPUT_CONTENT}}', input: true };
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
  if (wantsInput(action.prompt)) prompt = prompt.replace('{{INPUT_CONTENT}}', () => input);
  return prompt.replace('{{CONTENT}}', () => selected).replace('{{SELECTED_CONTENT}}', () => quoted);
}
