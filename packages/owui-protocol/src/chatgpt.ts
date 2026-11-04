/*
 * ChatGPT's data export (`conversations.json` in the zip ChatGPT emails you): a list of
 * conversations, each a tree of messages (`mapping`: node id → {message, parent, children}) with
 * `current_node` at the end of the thread you last saw. Read here into plain conversations, one
 * thread each, that any importer can use (Open WebUI's here; DeepTutor's later).
 */

export interface PlainMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Unix seconds, when the export has it. */
  at: number | null;
  /** The model that wrote it (assistant messages), when the export says. */
  model: string | null;
}

export interface PlainConversation {
  /** ChatGPT's own id for the conversation, when it has one. */
  id: string | null;
  title: string;
  /** Unix seconds. */
  created: number;
  updated: number;
  /** The first model named in the thread, or null. */
  model: string | null;
  messages: PlainMessage[];
}

type Tree = Record<string, unknown>;
const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value);
const seconds = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Whether a list looks like ChatGPT's export: any entry carries a message tree. */
export function isChatGptExport(list: unknown[]): boolean {
  return list.some((item) => isTree(item) && isTree(item.mapping));
}

/** The thread to keep: back from `current_node` to the start; without one, the newest reply at each step from the start. */
function thread(mapping: Tree, current: unknown): Tree[] {
  const nodes: Tree[] = [];
  const seen = new Set<string>();
  const node = (id: unknown) => (typeof id === 'string' && isTree(mapping[id]) ? (mapping[id] as Tree) : undefined);
  if (node(current)) {
    let id: unknown = current;
    while (typeof id === 'string' && node(id) && !seen.has(id)) {
      seen.add(id);
      const at = node(id) as Tree;
      nodes.push(at);
      id = at.parent;
    }
    return nodes.reverse();
  }
  const ids = Object.keys(mapping);
  let id: string | undefined = ids.find((key) => !node((mapping[key] as Tree | undefined)?.parent));
  while (id && node(id) && !seen.has(id)) {
    seen.add(id);
    const at = node(id) as Tree;
    nodes.push(at);
    const children = Array.isArray(at.children) ? at.children.filter((child): child is string => typeof child === 'string') : [];
    id = children[children.length - 1];
  }
  return nodes;
}

/** A message's words: its text parts (pictures and other attachments aren't in the export's text), else its `text`. */
function words(message: Tree): string {
  const content = isTree(message.content) ? message.content : {};
  const parts = Array.isArray(content.parts) ? content.parts.filter((part): part is string => typeof part === 'string') : [];
  const joined = parts.length ? parts.join('\n') : text(content.text);
  return joined.trim() ? joined : '';
}

/**
 * The messages of the conversation as it was shown: your messages and the replies, in order.
 * Left out: system and tool messages, anything hidden from the conversation (custom
 * instructions), the model's calls to its tools, and messages with no words.
 */
function plainMessages(nodes: Tree[]): PlainMessage[] {
  const out: PlainMessage[] = [];
  for (const node of nodes) {
    const message = isTree(node.message) ? node.message : null;
    if (!message) continue;
    const role = text(isTree(message.author) ? message.author.role : '');
    if (!role || role === 'system' || role === 'tool') continue;
    const metadata = isTree(message.metadata) ? message.metadata : {};
    if (metadata.is_visually_hidden_from_conversation === true) continue;
    if (typeof message.recipient === 'string' && message.recipient !== 'all') continue;
    const said = words(message);
    if (!said) continue;
    const user = role === 'user';
    out.push({ role: user ? 'user' : 'assistant', text: said, at: seconds(message.create_time), model: user ? null : text(metadata.model_slug) || null });
  }
  return out;
}

/** The export's conversations, one thread each; ones with nothing to keep are counted as skipped. */
export function readChatGptExport(list: unknown[], nowSeconds = Date.now() / 1000): { conversations: PlainConversation[]; skipped: number } {
  const conversations: PlainConversation[] = [];
  let skipped = 0;
  for (const item of list) {
    if (!isTree(item) || !isTree(item.mapping)) {
      skipped += 1;
      continue;
    }
    const messages = plainMessages(thread(item.mapping, item.current_node));
    if (!messages.length) {
      skipped += 1;
      continue;
    }
    const created = seconds(item.create_time) ?? messages[0]?.at ?? nowSeconds;
    conversations.push({
      id: text(item.conversation_id) || text(item.id) || null,
      title: text(item.title).trim(),
      created,
      updated: seconds(item.update_time) ?? messages[messages.length - 1]?.at ?? created,
      model: messages.find((message) => message.model)?.model ?? null,
      messages,
    });
  }
  return { conversations, skipped };
}
