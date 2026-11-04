/**
 * A JSON value's structure without its content: strings become "string",
 * numbers "number", and so on. Arrays merge the shapes of their first items;
 * maps keyed by ids (such as `history.messages`) collapse to one `<id>` entry,
 * so fixtures never contain ids, text, emails or tokens.
 */
export type Shape = string | Shape[] | { [key: string]: Shape };

const ARRAY_SAMPLE = 20;

export function shapeOf(value: unknown, maxDepth = 8): Shape {
  return describe(value, 0, maxDepth);
}

function describe(value: unknown, depth: number, maxDepth: number): Shape {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const shapes = value.slice(0, ARRAY_SAMPLE).map((item) => describe(item, depth + 1, maxDepth));
    return [shapes.reduce(mergeShapes)];
  }
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      break;
    default:
      return typeof value;
  }
  if (depth >= maxDepth) return 'object';

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length > 0 && keys.every(isIdLike)) {
    const merged = keys.slice(0, ARRAY_SAMPLE).map((key) => describe(record[key], depth + 1, maxDepth)).reduce(mergeShapes);
    return { '<id>': merged };
  }
  const out: Record<string, Shape> = {};
  for (const key of keys) out[key] = describe(record[key], depth + 1, maxDepth);
  return out;
}

export function isIdLike(key: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key) || /^[0-9a-f]{24,}$/i.test(key);
}

/** Union of two shapes: objects merge keys; differing scalars become "a|b". */
export function mergeShapes(a: Shape, b: Shape): Shape {
  if (isObjectShape(a) && isObjectShape(b)) {
    const out: Record<string, Shape> = { ...a };
    for (const [key, shape] of Object.entries(b)) out[key] = key in out ? mergeShapes(out[key] as Shape, shape) : shape;
    return Object.fromEntries(Object.entries(out).sort(([x], [y]) => x.localeCompare(y)));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length === 0) return b;
    if (b.length === 0) return a;
    return [mergeShapes(a[0] as Shape, b[0] as Shape)];
  }
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  const parts = new Set([...label(a).split('|'), ...label(b).split('|')]);
  return [...parts].sort().join('|');
}

function isObjectShape(shape: Shape): shape is Record<string, Shape> {
  return typeof shape === 'object' && !Array.isArray(shape);
}

function label(shape: Shape): string {
  if (typeof shape === 'string') return shape;
  return Array.isArray(shape) ? 'array' : 'object';
}

/**
 * What changed between two shapes, as lines: `+ path: shape` (only in the second), `- path`
 * (only in the first), `~ path: a → b` (a different type). An empty list on either side says
 * nothing about its items, so it isn't counted as a change.
 */
export function shapeDiff(a: Shape, b: Shape, path = ''): string[] {
  if (isObjectShape(a) && isObjectShape(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((key) => {
      const at = path ? `${path}.${key}` : key;
      if (!(key in b)) return [`- ${at}`];
      if (!(key in a)) return [`+ ${at}: ${JSON.stringify(b[key])}`];
      return shapeDiff(a[key] as Shape, b[key] as Shape, at);
    });
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (!a.length || !b.length) return [];
    return shapeDiff(a[0] as Shape, b[0] as Shape, `${path}[]`);
  }
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  return [`~ ${path || '(top)'}: ${label(a)} → ${label(b)}`];
}
