import type { ModelItem } from './models';

/*
 * A model's knobs (Open WebUI 0.12: "model controls"): choices its admin defines in
 * `info.params.model_controls`, each a set of options, such as a reasoning level. Yours are kept in
 * your settings (`ui.params.model_controls[modelId][key]`), which go with every message (the app
 * sends `ui.params`), and the server turns the option into the model's parameters.
 */

export interface ModelControlInfo {
  key: string;
  label: string;
  description: string;
  /** The option used when you haven't picked one, or null. */
  defaultValue: string | null;
  options: { value: string; label: string }[];
}

type Tree = Record<string, unknown>;
const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A model's knobs, in the admin's order; none for direct connections and pipes, as on the web. */
export function modelControls(model: ModelItem | undefined): ModelControlInfo[] {
  if (!model || (model as { direct?: unknown }).direct || (model as { pipe?: unknown }).pipe) return [];
  const params = (model.info as { params?: unknown } | undefined)?.params;
  const controls = isTree(params) ? params.model_controls : undefined;
  if (!isTree(controls)) return [];
  return Object.entries(controls).flatMap(([key, raw]) => {
    if (!isTree(raw) || !isTree(raw.options)) return [];
    const options = Object.entries(raw.options).flatMap(([value, option]) =>
      isTree(option) ? [{ value, label: typeof option.label === 'string' && option.label ? option.label : value }] : [],
    );
    if (!options.length) return [];
    return [
      {
        key,
        label: typeof raw.label === 'string' && raw.label ? raw.label : key,
        description: typeof raw.description === 'string' ? raw.description : '',
        defaultValue: typeof raw.default === 'string' && raw.default ? raw.default : null,
        options,
      },
    ];
  });
}

const choices = (ui: Tree | null | undefined): Record<string, Record<string, string>> => {
  const params = ui?.params;
  const saved = isTree(params) ? params.model_controls : undefined;
  if (!isTree(saved)) return {};
  return Object.fromEntries(
    Object.entries(saved).flatMap(([modelId, picks]) =>
      isTree(picks) ? [[modelId, Object.fromEntries(Object.entries(picks).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0))]] : [],
    ),
  );
};

/** What you picked for a model's knob, or null for its default. */
export function controlChoice(ui: Tree | null | undefined, modelId: string, key: string): string | null {
  return choices(ui)[modelId]?.[key] ?? null;
}

/** Your knob choices with one changed (null goes back to the default), to save as `params.model_controls`. */
export function withControlChoice(ui: Tree | null | undefined, modelId: string, key: string, value: string | null): Record<string, Record<string, string>> {
  const all = choices(ui);
  const mine = { ...(all[modelId] ?? {}) };
  if (value) mine[key] = value;
  else delete mine[key];
  return { ...all, [modelId]: mine };
}
