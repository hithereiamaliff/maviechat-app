import { emptyReply } from '@maviechat/deeptutor-protocol';
import { describe, expect, it } from 'vitest';
import type { DtListItem } from './DtMessageList';
import { findInChat } from './find';

const items: DtListItem[] = [
  { key: 'm1', kind: 'user', text: 'What is   photosynthesis?' },
  { key: 'm2', kind: 'reply', last: true, reply: { ...emptyReply(), answer: `${'Plants '.repeat(10)}use Photosynthesis to make sugar from light.` } },
];

describe('Find in Chat', () => {
  it('finds each message once, ignoring case, with text around the match', () => {
    const matches = findInChat(items, 'PHOTOSYNTHESIS');
    expect(matches.map((match) => [match.key, match.who, match.hit])).toEqual([
      ['m1', 'You', 'photosynthesis'],
      ['m2', 'DeepTutor', 'Photosynthesis'],
    ]);
    expect(matches[0]?.before).toBe('What is ');
    expect(matches[1]?.before.startsWith('…')).toBe(true);
  });

  it('waits for two letters', () => {
    expect(findInChat(items, 'p')).toEqual([]);
    expect(findInChat(items, 'zebra')).toEqual([]);
  });
});
