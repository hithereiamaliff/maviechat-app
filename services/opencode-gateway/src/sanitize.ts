/*
 * OpenCode answers some routes with more than the phone should ever hold: its provider list
 * carries each provider's API key (`key`, `options.apiKey`), its config carries MCP servers'
 * keys and headers, and its event stream carries every kind of event the server has. What the
 * gateway forwards keeps only what the app shows.
 */

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});

/** Only what's needed to pick a model: no keys, options, headers or endpoints. */
function cleanModel(value: unknown): Tree {
  const model = record(value);
  const variants = record(model.variants);
  return {
    id: model.id,
    providerID: model.providerID,
    name: model.name,
    family: model.family,
    status: model.status,
    release_date: model.release_date,
    capabilities: model.capabilities,
    limit: model.limit,
    ...(Object.keys(variants).length ? { variants: Object.fromEntries(Object.keys(variants).map((name) => [name, {}])) } : {}),
  };
}

/** `GET /config/providers`: providers by name and their models, with no API keys or settings. */
export function cleanProviders(body: unknown): unknown {
  const value = record(body);
  const providers = Array.isArray(value.providers)
    ? value.providers.map((item) => {
        const provider = record(item);
        const models = record(provider.models);
        return { id: provider.id, name: provider.name, source: provider.source, models: Object.fromEntries(Object.entries(models).map(([key, model]) => [key, cleanModel(model)])) };
      })
    : [];
  const defaults = record(value.default);
  return { providers, default: Object.fromEntries(Object.entries(defaults).filter(([, model]) => typeof model === 'string')) };
}

/** A model as OpenCode's config names it (`provider/model`), or null for anything else. */
const modelRef = (value: unknown): string | null => (typeof value === 'string' && value.length <= 200 && /^[^/\s]+\/\S+$/.test(value) ? value : null);

/**
 * `GET /config`: the default model and nothing else. MCP servers (with their keys and headers),
 * provider options, permissions and plugins stay on the machine.
 */
export function cleanConfig(body: unknown): unknown {
  return { model: modelRef(record(body).model) };
}

/**
 * The one change the phone may make to OpenCode's settings: its default model, a plain
 * `provider/model` name. Anything else in the body (MCP servers, plugins, permissions) is dropped.
 */
export function defaultModelPatch(body: unknown): { model: string } | null {
  const model = record(body).model;
  return typeof model === 'string' && model.length <= 200 && /^[A-Za-z0-9][\w.-]*\/[\w.:@+/-]+$/.test(model) ? { model } : null;
}

/** `GET /agent`: each agent's name and kind, without its prompt, options or permissions. */
export function cleanAgents(body: unknown): unknown {
  return Array.isArray(body)
    ? body.map((item) => {
        const agent = record(item);
        return { name: agent.name, description: agent.description, mode: agent.mode, hidden: agent.hidden, native: agent.native, color: agent.color, model: agent.model };
      })
    : [];
}

/** The event types the app uses; the gateway drops every other kind from the stream. */
export const EVENT_TYPES: ReadonlySet<string> = new Set([
  'server.connected',
  'server.heartbeat',
  'session.created',
  'session.updated',
  'session.deleted',
  'session.status',
  'session.idle',
  'session.error',
  'session.diff',
  'message.updated',
  'message.removed',
  'message.part.updated',
  'message.part.removed',
  'message.part.delta',
  'todo.updated',
  'permission.asked',
  'permission.replied',
  'question.asked',
  'question.replied',
  'question.rejected',
]);

/** Whether one server-sent event block (its `data:` lines) is a kind the app uses. */
export function eventAllowed(block: string): boolean {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!data) return false;
  try {
    const type = record(JSON.parse(data)).type;
    return typeof type === 'string' && EVENT_TYPES.has(type);
  } catch {
    return false;
  }
}

/**
 * A stream filter for OpenCode's event stream: complete events of allowed kinds pass through
 * unchanged, every other block is dropped.
 */
export function eventFilter(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  const flushBlocks = (controller: TransformStreamDefaultController<Uint8Array>) => {
    let end = buffer.indexOf('\n\n');
    while (end >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (eventAllowed(block)) controller.enqueue(encoder.encode(`${block}\n\n`));
      end = buffer.indexOf('\n\n');
    }
  };
  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, '\n');
      flushBlocks(controller);
    },
    flush(controller) {
      buffer += decoder.decode();
      flushBlocks(controller);
    },
  });
}
