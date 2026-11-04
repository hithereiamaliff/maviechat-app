import Fuse from 'fuse.js';

/** One model OpenCode can use: the provider that serves it, and the names to show. */
export interface ModelChoice {
  providerID: string;
  modelID: string;
  name: string;
  provider: string;
}

/** A provider's heading in the model picker, with its models. */
export interface ModelSection {
  key: string;
  title: string;
  data: ModelChoice[];
}

const chunks = (text: string) => text.toLowerCase().match(/\d+|\D+/g) ?? [];

/** A to Z ignoring case, with numbers in number order: "V4" before "V4.1" before "V10". */
export function naturalCompare(a: string, b: string): number {
  const left = chunks(a);
  const right = chunks(b);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const x = left[index];
    const y = right[index];
    if (x === y) continue;
    if (/^\d/.test(x) && /^\d/.test(y)) return Number(x) - Number(y) || x.length - y.length;
    return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

/**
 * Models whose provider, name or id hold every word typed ("go flash", "v4.1"). When nothing
 * matches that way, a fuzzy match still catches typos ("deepsek").
 */
export function searchModelChoices(models: ModelChoice[], query: string): ModelChoice[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return models;
  const matching = models.filter((model) => {
    const text = `${model.provider} ${model.providerID} ${model.name} ${model.modelID}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  if (matching.length) return matching;
  return new Fuse(models, { keys: ['name', 'modelID', 'provider'], threshold: 0.4, ignoreLocation: true }).search(query.trim()).map((result) => result.item);
}

/** The picker's list: the matching models under their provider, providers and models A to Z. */
export function modelSections(models: ModelChoice[], query = ''): ModelSection[] {
  const groups = new Map<string, ModelSection>();
  for (const model of searchModelChoices(models, query)) {
    const group = groups.get(model.providerID);
    if (group) group.data.push(model);
    else groups.set(model.providerID, { key: model.providerID, title: model.provider, data: [model] });
  }
  return [...groups.values()]
    .sort((a, b) => naturalCompare(a.title, b.title))
    .map((group) => ({ ...group, data: group.data.sort((a, b) => naturalCompare(a.name, b.name)) }));
}
