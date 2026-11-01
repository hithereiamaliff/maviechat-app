import { modelTags, type ModelItem, type PromptSuggestion } from '@maviechat/owui-protocol';
import Fuse from 'fuse.js';

/** Longer input than this hides the suggestions, as on the web. */
export const SUGGESTION_INPUT_LIMIT = 500;

/**
 * The web shuffles suggestions each time the list appears. A seeded shuffle does the same
 * while keeping one order for as long as the screen stays open.
 */
export function shuffled<T>(items: readonly T[], seed: number, key: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, rank: hash(`${seed}:${key(item)}`) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}

/** Suggestions fuzzy-matched to what's typed (their text and title lines), best match first. */
export function filterSuggestions(suggestions: PromptSuggestion[], input: string): PromptSuggestion[] {
  if (input.length > SUGGESTION_INPUT_LIMIT) return [];
  const query = input.trim();
  if (!query) return suggestions;
  return new Fuse(suggestions, { keys: ['content', 'title'], threshold: 0.5 }).search(query).map((result) => result.item);
}

/** Fuzzy model search over id, name and tags, as the web's picker searches. */
export function searchModels(models: ModelItem[], query: string): ModelItem[] {
  const needle = query.trim();
  if (!needle) return models;
  const entries = models.map((model) => ({ model, id: model.id, name: model.name, tags: modelTags(model).join(' ') }));
  return new Fuse(entries, { keys: ['id', 'tags', 'name'], threshold: 0.4 }).search(needle).map((result) => result.item.model);
}

/** FNV-1a: a small, stable string hash. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}
