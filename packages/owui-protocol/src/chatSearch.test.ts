import { describe, expect, it } from 'vitest';
import { folderSearch, searchText, snippetParts, typedFilter, withFilterWord } from './chatSearch';

describe('chat search words', () => {
  it('writes a folder as the web does, and reads what is being typed', () => {
    expect(folderSearch({ name: 'Work Notes' })).toBe('folder:work_notes');
    expect(typedFilter('report folder:wor', 'folder:')).toBe('wor');
    expect(typedFilter('report folder:', 'folder:')).toBe('');
    expect(typedFilter('report', 'folder:')).toBeNull();
  });

  it('adds a filter, replacing one being typed and never twice', () => {
    expect(withFilterWord('report folder:wo', 'folder:work_notes')).toBe('report folder:work_notes');
    expect(withFilterWord('report', 'tag:none')).toBe('report tag:none');
    expect(withFilterWord('tag:none report', 'tag:none')).toBe('report tag:none');
  });

  it('keeps only the words to match', () => {
    expect(searchText('budget pinned:true folder:work q3')).toBe('budget q3');
  });

  it('marks the matching parts of a snippet: the phrase, else each word', () => {
    expect(snippetParts('...the Budget plan for Q3...', 'budget plan')).toEqual([
      { text: '...the ', match: false },
      { text: 'Budget plan', match: true },
      { text: ' for Q3...', match: false },
    ]);
    expect(snippetParts('plan the budget', 'budget plan tag:x')).toEqual([
      { text: 'plan', match: true },
      { text: ' the ', match: false },
      { text: 'budget', match: true },
    ]);
    expect(snippetParts('nothing here', 'zzz')).toEqual([{ text: 'nothing here', match: false }]);
  });
});
