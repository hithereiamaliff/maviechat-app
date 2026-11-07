import { describe, expect, it } from 'vitest';
import { BURST_MS, emptyHistory, redo, remember, undo } from './history';

describe('the note editor’s Undo and Redo', () => {
  it('keeps a burst of typing as one step, and starts another after a pause', () => {
    let history = remember(emptyHistory(), '', 1000, true);
    history = remember(history, 'a', 1100, true);
    history = remember(history, 'ab', 1200, true);
    expect(history.past).toEqual(['']);
    history = remember(history, 'abc', 1200 + BURST_MS, true);
    expect(history.past).toEqual(['', 'abc']);
  });

  it('keeps other changes as steps of their own', () => {
    let history = remember(emptyHistory(), 'a', 1000, true);
    history = remember(history, 'ab', 1100, false);
    history = remember(history, '**ab**', 1150, true);
    expect(history.past).toEqual(['a', 'ab', '**ab**']);
  });

  it('goes back and forward, and a new change drops what was undone', () => {
    let history = remember(remember(emptyHistory(), 'one', 0, false), 'two', 10, false);
    const back = undo(history, 'three');
    expect(back?.text).toBe('two');
    const forward = back ? redo(back.history, back.text) : null;
    expect(forward?.text).toBe('three');
    history = back ? remember(back.history, 'two', 20, true) : history;
    expect(history.future).toEqual([]);
    expect(undo(emptyHistory(), 'x')).toBeNull();
    expect(redo(emptyHistory(), 'x')).toBeNull();
  });
});
