/*
 * The words the server's chat search understands besides the text (`GET /api/v1/chats/search`):
 * `tag:id` (`tag:none` for chats without tags), `folder:name` (lower case, spaces as underscores,
 * with the folder's subfolders), and `pinned:`, `archived:`, `shared:` with `true` or `false`.
 */

/** The server answers 60 chats a page. */
export const SEARCH_PAGE_SIZE = 60;

const FILTER_PREFIXES = ['tag:', 'folder:', 'pinned:', 'archived:', 'shared:'];

/** The filter word for a folder, as the web writes it. */
export function folderSearch(folder: { name: string }): string {
  return `folder:${folder.name.trim().replace(/\s+/g, '_').toLowerCase()}`;
}

/** What's typed after `prefix` at the end of a search (`folder:wor` → `wor`), lower case; null when the last word isn't one. */
export function typedFilter(search: string, prefix: 'tag:' | 'folder:'): string | null {
  const last = search.split(/\s+/).pop() ?? '';
  return last.toLowerCase().startsWith(prefix) ? last.slice(prefix.length).toLowerCase() : null;
}

/** The search with `word` added, replacing a last word that was being typed with the same prefix. */
export function withFilterWord(search: string, word: string): string {
  const prefix = word.slice(0, word.indexOf(':') + 1).toLowerCase();
  const words = search.split(/\s+/).filter(Boolean);
  if (prefix && words.length && (words[words.length - 1] as string).toLowerCase().startsWith(prefix)) words.pop();
  return [...words.filter((item) => item !== word), word].join(' ');
}

/** The words of a search that aren't filters: what to match in the chats' text. */
export function searchText(search: string): string {
  return search
    .split(/\s+/)
    .filter((word) => word && !FILTER_PREFIXES.some((prefix) => word.toLowerCase().startsWith(prefix)))
    .join(' ');
}

/**
 * A result's snippet in parts, those matching the search marked: the whole text where it's
 * there, else each word of two letters or more (the server cuts the snippet around either).
 */
export function snippetParts(snippet: string, search: string): { text: string; match: boolean }[] {
  const text = searchText(search).toLowerCase();
  const lower = snippet.toLowerCase();
  const needles = text && lower.includes(text) ? [text] : text.split(' ').filter((word) => word.length >= 2);
  const marks = new Array<boolean>(snippet.length).fill(false);
  for (const needle of needles) {
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) marks.fill(true, at, at + needle.length);
  }
  const parts: { text: string; match: boolean }[] = [];
  for (let index = 0; index < snippet.length; index += 1) {
    const last = parts[parts.length - 1];
    if (last && last.match === marks[index]) last.text += snippet[index];
    else parts.push({ text: snippet[index] as string, match: marks[index] as boolean });
  }
  return parts;
}
