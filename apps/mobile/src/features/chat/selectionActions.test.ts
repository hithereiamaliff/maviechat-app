import { describe, expect, it } from 'vitest';
import { DEFAULT_SELECTION_ACTIONS, newSelectionAction, savedSelectionActions, selectionActions, selectionActionsSetting, selectionPrompt } from './selectionActions';

const [ask, explain] = DEFAULT_SELECTION_ACTIONS;

describe('actions on selected text', () => {
  it('quotes the selection, then asks or explains, as the web does', () => {
    expect(selectionPrompt(explain!, 'Line one\nLine two', '')).toBe('> Line one\n> Line two\n\n\nExplain');
    expect(selectionPrompt(ask!, 'A fact', 'Why?')).toBe('> A fact\n\n\nWhy?');
  });

  it('reads your own actions, keeps tool variables by name and leaves `$` in the text alone', () => {
    const mine = selectionActions({
      floatingActionButtons: [
        { id: 'x', label: 'Translate', input: false, prompt: 'Translate {{CONTENT}} {{lang|tool:id="t1"}}{{TOOL:t2}}' },
        { label: '', prompt: 'skipped' },
        'junk',
      ],
    });
    expect(mine).toEqual([{ id: 'x', label: 'Translate', input: false, prompt: 'Translate {{CONTENT}} {{lang|tool:id="t1"}}{{TOOL:t2}}' }]);
    expect(selectionPrompt(mine[0]!, 'costs $& and $1', '')).toBe('Translate costs $& and $1 lang');
  });

  it('falls back to Ask and Explain, and keeps an empty list you saved', () => {
    expect(selectionActions({}).map((action) => action.label)).toEqual(['Ask', 'Explain']);
    expect(selectionActions(null).map((action) => action.label)).toEqual(['Ask', 'Explain']);
    expect(selectionActions({ floatingActionButtons: [] })).toEqual([]);
  });
});

describe('editing quick actions', () => {
  it('asks for input when the prompt wants it, whatever the saved flag says, as the web does', () => {
    const [own] = selectionActions({ floatingActionButtons: [{ id: 'q', label: 'Quiz', input: false, prompt: '{{CONTENT}} {{INPUT_CONTENT}}' }] });
    expect(own?.input).toBe(true);
    expect(selectionPrompt(own!, 'text', 'why')).toBe('text why');
  });

  it('reads your list for the editor, blanks included, and null for the defaults', () => {
    expect(savedSelectionActions({})).toBeNull();
    expect(savedSelectionActions({ floatingActionButtons: [{ id: 'a', label: '', prompt: 'p' }, 7] })).toEqual([{ id: 'a', label: '', prompt: 'p', input: false }]);
  });

  it('saves a list as the web keeps it, or null to go back to the defaults', () => {
    expect(selectionActionsSetting(null)).toBeNull();
    expect(selectionActionsSetting([{ id: 'a', label: ' Sum up ', prompt: '{{CONTENT}}\n\nSum up', input: true }])).toEqual([{ id: 'a', label: 'Sum up', input: false, prompt: '{{CONTENT}}\n\nSum up' }]);
  });

  it('adds a new action with an id nobody has', () => {
    expect(newSelectionAction([]).id).toBe('new-button');
    expect(newSelectionAction([{ ...DEFAULT_SELECTION_ACTIONS[0]!, id: 'new-button' }, { ...DEFAULT_SELECTION_ACTIONS[0]!, id: 'new-button-1' }]).id).toBe('new-button-2');
    expect(newSelectionAction([])).toMatchObject({ label: 'New Button', input: true });
  });
});
