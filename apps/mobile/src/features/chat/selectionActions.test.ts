import { describe, expect, it } from 'vitest';
import { DEFAULT_SELECTION_ACTIONS, selectionActions, selectionPrompt } from './selectionActions';

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
