import { EMOJI_GROUPS, EMOJI_LINES } from './emoji.generated';

/*
 * Emoji as Open WebUI names them: a status and a folder's icon keep an emoji's first short name
 * ("grinning"), and the web's picker remembers recent ones by code points ("1F600"), both from the
 * same emoji list the app carries (emoji-datasource). Skin tones aren't in it; an emoji it doesn't
 * have travels as itself, which the web shows as it is.
 */

export interface Emoji {
  /** Code points, hex, joined by "-": `1F600`, `0023-FE0F-20E3`. */
  code: string;
  /** The emoji itself. */
  char: string;
  /** Short names; the first is the one a status saves. */
  names: string[];
  /** Index into EMOJI_GROUPS; -1 for skin tones and other parts. */
  group: number;
}

const SKIN_TONES = /[\u{1F3FB}-\u{1F3FF}]/gu;
const VARIATION = /️/g;

/** The emoji for code points (`1F44D` → 👍). */
export const emojiChar = (code: string): string => String.fromCodePoint(...code.split('-').map((hex) => parseInt(hex, 16)));

/** An emoji's code points, as the list keys them. */
const codeOf = (char: string): string =>
  [...char].map((symbol) => (symbol.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')).join('-');

let table: { list: Emoji[]; byName: Map<string, Emoji>; byCode: Map<string, Emoji> } | null = null;

function emojiTable() {
  if (table) return table;
  const list: Emoji[] = [];
  const byName = new Map<string, Emoji>();
  const byCode = new Map<string, Emoji>();
  for (const line of EMOJI_LINES.split('\n')) {
    const [code = '', names = '', group = '-1'] = line.split(' ');
    const item: Emoji = { code, char: emojiChar(code), names: names.split(','), group: Number(group) };
    list.push(item);
    for (const name of item.names) byName.set(name, item);
    byCode.set(code, item);
    // Typed emoji often come without the variation selector the list writes.
    const bare = code.replace(/-FE0F/g, '');
    if (!byCode.has(bare)) byCode.set(bare, item);
  }
  table = { list, byName, byCode };
  return table;
}

/** The emoji a short name stands for (a status's or a folder's icon, with or without colons), or the text itself when it's no name. */
export function emojiOfName(saved: string): string {
  const name = saved.trim().replace(/^:(.+):$/, '$1');
  return emojiTable().byName.get(name)?.char ?? saved.trim();
}

/** The listed emoji for one typed or picked: skin tone left off, as the web's list has none. */
export function findEmoji(char: string): Emoji | undefined {
  const plain = char.replace(SKIN_TONES, '');
  const { byCode } = emojiTable();
  return byCode.get(codeOf(plain)) ?? byCode.get(codeOf(plain.replace(VARIATION, '')));
}

/** What a status or a folder's icon saves for an emoji: its short name, so the web shows it; else the emoji itself. */
export function nameOfEmoji(char: string): string {
  return findEmoji(char)?.names[0] ?? char;
}

// What joins onto an emoji: the variation selector, skin tones, the keycap mark and flag tags.
const JOINS = (point: number) => point === 0xfe0f || point === 0x20e3 || (point >= 0x1f3fb && point <= 0x1f3ff) || (point >= 0xe0020 && point <= 0xe007f);

/**
 * The first emoji in some text (what the emoji keyboard typed), or '': the longest listed one the
 * text starts with; else, for one newer than the list, its first symbol with what joins onto it.
 */
export function firstEmoji(text: string): string {
  const symbols = [...text.trim()];
  for (let length = Math.min(symbols.length, 14); length > 0; length -= 1) {
    const candidate = symbols.slice(0, length).join('');
    if (findEmoji(candidate)) return candidate;
  }
  const first = symbols[0]?.codePointAt(0) ?? 0;
  if (first < 0x2100) return '';
  let end = 1;
  while (end < symbols.length) {
    const point = symbols[end]?.codePointAt(0) ?? 0;
    if (JOINS(point)) end += 1;
    else if (point === 0x200d && end + 1 < symbols.length) end += 2;
    else break;
  }
  return symbols.slice(0, end).join('');
}

/** Emoji whose names hold every word of the search (`thumbs up`, `+1`), names that start with it first. */
export function searchEmoji(query: string, limit = 120): Emoji[] {
  const words = query.toLowerCase().trim().split(/[\s_]+/).filter(Boolean);
  if (!words.length) return [];
  const found = emojiTable().list.filter((item) => item.group >= 0 && words.every((word) => item.names.some((name) => name.includes(word))));
  const first = words[0] ?? '';
  return found.sort((a, b) => Number(!a.names.some((name) => name.startsWith(first))) - Number(!b.names.some((name) => name.startsWith(first)))).slice(0, limit);
}

/**
 * The message box's `:` list, as the web's: from two letters on, emoji whose short names hold
 * them, an exact name first, then names starting with them; 50 at most.
 */
export function emojiForShortName(query: string, limit = 50): Emoji[] {
  const wanted = query.toLowerCase();
  if (wanted.length < 2) return [];
  const rank = (item: Emoji) => (item.names.includes(wanted) ? 0 : item.names.some((name) => name.startsWith(wanted)) ? 1 : 2);
  return emojiTable()
    .list.filter((item) => item.names.some((name) => name.includes(wanted)))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, limit);
}

/** The picker's groups with their emoji, in order. */
export function emojiGroups(): { title: string; emoji: Emoji[] }[] {
  const list = emojiTable().list;
  return EMOJI_GROUPS.map((title, index) => ({ title, emoji: list.filter((item) => item.group === index) }));
}

/** Recently used emoji as the web keeps them (`ui.recentEmojis`: code points, newest first). */
export function recentEmoji(saved: unknown): Emoji[] {
  if (!Array.isArray(saved)) return [];
  const { byCode } = emojiTable();
  return saved.flatMap((code) => (typeof code === 'string' && byCode.get(code) ? [byCode.get(code) as Emoji] : [])).slice(0, RECENT_MOST);
}

const RECENT_MOST = 30;

/** The recent list with this emoji first, as the web keeps it (30 at most). */
export function withRecent(saved: unknown, emoji: Emoji): string[] {
  const codes = Array.isArray(saved) ? saved.filter((code): code is string => typeof code === 'string') : [];
  return [emoji.code, ...codes.filter((code) => code !== emoji.code)].slice(0, RECENT_MOST);
}
