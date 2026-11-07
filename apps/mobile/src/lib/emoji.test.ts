import { describe, expect, it } from 'vitest';
import { emojiChar, emojiForShortName, emojiGroups, findEmoji, firstEmoji, recentEmoji, searchEmoji, statusEmoji, statusShortName, withRecent } from './emoji';

describe('emoji as Open WebUI names them', () => {
  it('shows a status’s short name as its emoji, and anything else as it is', () => {
    expect(statusEmoji('grinning')).toBe('😀');
    expect(statusEmoji(':+1:')).toBe('👍');
    expect(statusEmoji('🫠')).toBe('🫠');
    expect(statusEmoji('not_a_name')).toBe('not_a_name');
  });

  it('saves an emoji by its first short name, skin tone left off; one without a name as itself', () => {
    expect(statusShortName('😀')).toBe('grinning');
    expect(statusShortName('👍🏽')).toBe('+1');
    expect(statusShortName('❤')).toBe('heart');
    expect(statusShortName('❤️')).toBe('heart');
    expect(statusShortName('🇲🇾')).toBe('flag-my');
    expect(statusShortName('#️⃣')).toBe('hash');
    expect(statusShortName('x')).toBe('x');
  });

  it('finds the emoji the keyboard typed, joined sequences and flags whole', () => {
    expect(firstEmoji(' 👩🏽‍💻 at work')).toBe('👩🏽‍💻');
    expect(firstEmoji('🇲🇾🇸🇬')).toBe('🇲🇾');
    expect(firstEmoji('👍🏽')).toBe('👍🏽');
    expect(firstEmoji('hello')).toBe('');
    expect(findEmoji('👩🏽‍💻')?.names[0]).toBe('female-technologist');
  });

  it('searches names by every word, names starting with the first word first', () => {
    const found = searchEmoji('thumbs');
    expect(found[0]?.char).toBe('👍');
    expect(searchEmoji('heart eyes').map((item) => item.names[0])).toContain('heart_eyes');
    expect(searchEmoji('  ')).toEqual([]);
    expect(searchEmoji('skin-tone').every((item) => item.group >= 0)).toBe(true);
  });

  it('lists the picker’s groups in order, without skin tones', () => {
    const groups = emojiGroups();
    expect(groups.map((group) => group.title)).toEqual(['Smileys & Emotion', 'People & Body', 'Animals & Nature', 'Food & Drink', 'Travel & Places', 'Activities', 'Objects', 'Symbols', 'Flags']);
    expect(groups[0]?.emoji[0]?.char).toBe('😀');
    expect(groups.flatMap((group) => group.emoji).some((item) => item.code === '1F3FB')).toBe(false);
  });

  it('keeps recent emoji as the web does: code points, newest first, 30 at most', () => {
    const smile = findEmoji('😄');
    if (!smile) throw new Error('no smile');
    expect(withRecent(['1F600', '1F604'], smile)).toEqual(['1F604', '1F600']);
    expect(withRecent(Array.from({ length: 30 }, (_, index) => `X${index}`), smile)).toHaveLength(30);
    expect(recentEmoji(['1F604', 'nope', 7]).map((item) => item.char)).toEqual(['😄']);
    expect(emojiChar('0023-FE0F-20E3')).toBe('#️⃣');
  });

  it('lists emoji for the message box’s `:` as the web does: two letters on, exact names first', () => {
    expect(emojiForShortName('s')).toEqual([]);
    expect(emojiForShortName('smile')[0]?.names[0]).toBe('smile');
    expect(emojiForShortName('heart').length).toBeLessThanOrEqual(50);
    expect(emojiForShortName('THUMBSUP')[0]?.char).toBe('👍');
  });
});
