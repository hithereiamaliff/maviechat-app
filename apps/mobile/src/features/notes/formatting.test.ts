import { describe, expect, it } from 'vitest';
import { applyFormat, noteCounts, toggleTask } from './formatting';

const at = (start: number, end = start) => ({ start, end });

describe('the note editor’s formatting bar', () => {
  it('wraps the selection in marks, and unwraps it on a second press', () => {
    const bold = applyFormat('say hi now', at(4, 6), 'bold');
    expect(bold).toEqual({ text: 'say **hi** now', selection: at(6, 8) });
    expect(applyFormat(bold.text, bold.selection, 'bold')).toEqual({ text: 'say hi now', selection: at(4, 6) });
    expect(applyFormat('say **hi** now', at(4, 10), 'bold')).toEqual({ text: 'say hi now', selection: at(4, 6) });
  });

  it('puts empty marks at the cursor, ready to type into', () => {
    expect(applyFormat('ab', at(1), 'italic')).toEqual({ text: 'a__b', selection: at(2) });
    expect(applyFormat('ab', at(1), 'code')).toEqual({ text: 'a``b', selection: at(2) });
  });

  it('cycles a heading through three levels and off', () => {
    let edit = applyFormat('Title', at(2), 'heading');
    expect(edit).toEqual({ text: '# Title', selection: at(4) });
    edit = applyFormat(edit.text, edit.selection, 'heading');
    expect(edit.text).toBe('## Title');
    edit = applyFormat(edit.text, edit.selection, 'heading');
    expect(edit.text).toBe('### Title');
    edit = applyFormat(edit.text, edit.selection, 'heading');
    expect(edit.text).toBe('Title');
  });

  it('makes every selected line a list item, numbers them, and switches one kind for another', () => {
    const text = 'milk\neggs\n\nbread';
    const bullets = applyFormat(text, at(0, text.length), 'bullet');
    expect(bullets.text).toBe('- milk\n- eggs\n\n- bread');
    expect(bullets.selection).toEqual(at(0, bullets.text.length));
    const numbers = applyFormat(bullets.text, bullets.selection, 'number');
    expect(numbers.text).toBe('1. milk\n2. eggs\n\n3. bread');
    expect(applyFormat(numbers.text, numbers.selection, 'number').text).toBe('milk\neggs\n\nbread');
    expect(applyFormat('- milk', at(3), 'task')).toEqual({ text: '- [ ] milk', selection: at(7) });
    expect(applyFormat('- [x] milk', at(8), 'task')).toEqual({ text: 'milk', selection: at(2) });
    expect(applyFormat('a\nb', at(2), 'quote').text).toBe('a\n> b');
  });

  it('does not take in the next line when the selection ends at a line break', () => {
    expect(applyFormat('one\ntwo', at(0, 4), 'bullet').text).toBe('- one\ntwo');
  });

  it('fences a code block, and makes a link with its address selected', () => {
    expect(applyFormat('let x', at(1), 'codeBlock')).toEqual({ text: '```\nlet x\n```', selection: at(4, 9) });
    expect(applyFormat('see docs', at(4, 8), 'link')).toEqual({ text: 'see [docs](https://)', selection: at(11, 19) });
    expect(applyFormat('', at(0), 'link')).toEqual({ text: '[link](https://)', selection: at(7, 15) });
  });

  it('ticks the n-th checklist box', () => {
    const list = '- [ ] milk\n- [x] eggs\n  - [ ] nested';
    expect(toggleTask(list, 0)).toBe('- [x] milk\n- [x] eggs\n  - [ ] nested');
    expect(toggleTask(list, 1)).toBe('- [ ] milk\n- [ ] eggs\n  - [ ] nested');
    expect(toggleTask(list, 2)).toBe('- [ ] milk\n- [x] eggs\n  - [x] nested');
    expect(toggleTask('```\n- [ ] code\n```\n1. [ ] first', 0)).toBe('```\n- [ ] code\n```\n1. [x] first');
  });

  it('counts words and characters without the marks', () => {
    expect(noteCounts('# Shopping\n\n- [ ] **milk** and [eggs](https://x.test)')).toEqual({ words: 4, characters: 21 });
    expect(noteCounts('')).toEqual({ words: 0, characters: 0 });
  });
});
