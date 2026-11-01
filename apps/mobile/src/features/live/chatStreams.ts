import { applyMessageEvent, type ChatEventEnvelope, type ChatRecord, type HistoryMessage } from '@maviechat/owui-protocol';
import type { QueryClient } from '@tanstack/react-query';

type Reply = (response: unknown) => void;

/** UI the manager needs; supplied by the app layout (alerts, toasts, navigation state). */
export interface StreamHooks {
  confirm(title: string, message: string): Promise<boolean>;
  prompt(title: string, message: string, placeholder?: string, value?: string): Promise<string | false>;
  notify(message: string, tone?: 'info' | 'error' | 'success'): void;
  /** True when the user is looking at this chat right now. */
  isViewing(chatId: string): boolean;
}

interface QueuedEvent {
  messageId: string;
  type: string;
  data: unknown;
}

const CHAT_LEVEL = new Set(['chat:title', 'chat:list', 'chat:active', 'chat:tags', 'chat:reload', 'chat:outlet', 'notification']);
const NEEDS_REPLY = new Set([
  'confirmation',
  'input',
  'execute',
  'execute:python',
  'execute:tool',
  'request:chat:completion',
  'request:user_input',
  'request:elicitation',
  'request:terminal',
]);

/**
 * Routes socket events into the cached chats (`['chat', id]` queries):
 * - message events are queued and applied at most once per frame;
 * - events for a reply whose new chat id isn't known yet are held until `bind`;
 * - requests that wait for an answer get one (prompts, or "unsupported");
 * - when a reply finishes, the chat is refetched so it converges with the server.
 */
export class ChatStreams {
  private pending = new Map<string, string | null>();
  private held = new Map<string, QueuedEvent[]>();
  private queue = new Map<string, QueuedEvent[]>();
  private scheduled = false;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly hooks: StreamHooks,
    private readonly schedule: (flush: () => void) => void = (flush) => requestAnimationFrame(flush),
    private readonly later: (run: () => void, ms: number) => void = (run, ms) => setTimeout(run, ms),
  ) {}

  /** Replies this device started; `chatId` is null until the server names the new chat. */
  track(replyIds: string[], chatId: string | null): void {
    for (const id of replyIds) this.pending.set(id, chatId);
  }

  /** The server created the chat: route held events for these replies into it. */
  bind(replyIds: string[], chatId: string): void {
    for (const id of replyIds) {
      this.pending.set(id, chatId);
      const events = this.held.get(id) ?? [];
      this.held.delete(id);
      for (const event of events) this.enqueue(chatId, event);
    }
  }

  untrack(replyIds: string[]): void {
    for (const id of replyIds) {
      this.pending.delete(id);
      this.held.delete(id);
    }
  }

  handle(envelope: ChatEventEnvelope, reply?: Reply): void {
    const type = envelope.data.type;
    const data = envelope.data.data;
    const chatId = envelope.chat_id;
    const messageId = envelope.message_id;

    if (NEEDS_REPLY.has(type)) {
      void this.answer(type, data, reply);
      return;
    }

    if (CHAT_LEVEL.has(type)) {
      this.chatEvent(type, data, chatId);
      return;
    }

    if (!messageId) return;
    const known = chatId && this.cachedMessage(chatId, messageId);
    if (known) {
      this.enqueue(chatId, { messageId, type, data });
    } else if (this.pending.has(messageId)) {
      const target = this.pending.get(messageId);
      if (target) this.enqueue(target, { messageId, type, data });
      else this.held.set(messageId, [...(this.held.get(messageId) ?? []), { messageId, type, data }]);
    } else if (type === 'chat:completion' && (data as { done?: boolean } | undefined)?.done && chatId) {
      // A reply finished in a chat that isn't open here (another device, or a chat left mid-reply).
      void this.queryClient.invalidateQueries({ queryKey: ['chats'] });
      if (!this.hooks.isViewing(chatId)) this.hooks.notify(`Reply ready in “${this.titleOf(chatId) ?? 'a chat'}”`, 'success');
    }
  }

  /** Applies everything queued so far (also called by the frame scheduler). */
  flush(): void {
    this.scheduled = false;
    const work = this.queue;
    this.queue = new Map();
    for (const [chatId, events] of work) {
      let finished = false;
      this.queryClient.setQueryData<ChatRecord>(['chat', chatId], (record) => {
        const history = record?.chat?.history;
        if (!record || !history) return record;
        const messages = { ...history.messages };
        for (const event of events) {
          const message = messages[event.messageId];
          if (!message) continue;
          const updated = applyMessageEvent(message, event.type, event.data);
          if (updated.done && !message.done) finished = true;
          messages[event.messageId] = updated;
        }
        return { ...record, chat: { ...record.chat, history: { ...history, messages } } };
      });
      if (finished) {
        this.converge(chatId);
        // A reply you started here and then left (for another chat or settings) is announced like any other.
        if (!this.hooks.isViewing(chatId)) this.hooks.notify(`Reply ready in “${this.titleOf(chatId) ?? 'a chat'}”`, 'success');
      }
    }
  }

  private enqueue(chatId: string, event: QueuedEvent): void {
    const list = this.queue.get(chatId) ?? [];
    list.push(event);
    this.queue.set(chatId, list);
    if (!this.scheduled) {
      this.scheduled = true;
      this.schedule(() => this.flush());
    }
  }

  private chatEvent(type: string, data: unknown, chatId: string | undefined): void {
    switch (type) {
      case 'notification': {
        const note = (data ?? {}) as { type?: string; content?: string };
        if (note.content) this.hooks.notify(note.content, note.type === 'error' ? 'error' : note.type === 'success' ? 'success' : 'info');
        return;
      }
      case 'chat:list':
        // Also sent when a chat is read or marked unread, with new folder unread counts.
        void this.queryClient.invalidateQueries({ queryKey: ['chats'] });
        void this.queryClient.invalidateQueries({ queryKey: ['folder-chats'] });
        void this.queryClient.invalidateQueries({ queryKey: ['folders'] });
        return;
      case 'chat:title':
        if (chatId && typeof data === 'string') {
          this.queryClient.setQueryData<ChatRecord>(['chat', chatId], (record) =>
            record ? { ...record, title: data, chat: { ...record.chat, title: data } } : record,
          );
        }
        void this.queryClient.invalidateQueries({ queryKey: ['chats'] });
        return;
      case 'chat:active':
        void this.queryClient.invalidateQueries({ queryKey: ['chats'] });
        if (chatId && (data as { active?: boolean } | undefined)?.active === false) this.converge(chatId);
        return;
      case 'chat:reload':
        if (chatId) void this.queryClient.invalidateQueries({ queryKey: ['chat', chatId] });
        return;
      case 'chat:outlet': {
        // Server-side outlet filters rewrote some messages: keep the original text, as the web does.
        const patches = ((data as { messages?: Partial<HistoryMessage>[] } | undefined)?.messages ?? []).filter((m) => m?.id);
        if (!chatId || patches.length === 0) return;
        this.queryClient.setQueryData<ChatRecord>(['chat', chatId], (record) => {
          const history = record?.chat?.history;
          if (!record || !history) return record;
          const messages = { ...history.messages };
          for (const patch of patches) {
            const existing = messages[patch.id as string];
            if (existing && patch.content !== undefined && existing.content !== patch.content) {
              messages[existing.id] = { ...existing, originalContent: existing.content, ...patch } as HistoryMessage;
            }
          }
          return { ...record, chat: { ...record.chat, history: { ...history, messages } } };
        });
        return;
      }
      default:
        return;
    }
  }

  private async answer(type: string, data: unknown, reply?: Reply): Promise<void> {
    const payload = (data ?? {}) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    switch (type) {
      case 'confirmation':
        reply?.(await this.hooks.confirm(text(payload.title) || 'Confirm', text(payload.message)));
        return;
      case 'input':
        reply?.(await this.hooks.prompt(text(payload.title) || 'Input', text(payload.message), text(payload.placeholder), text(payload.value)));
        return;
      case 'request:user_input':
        reply?.({ status: 'cancelled', answers: {} });
        this.hooks.notify('A tool asked you a question. Answering tool questions arrives in a later update.');
        return;
      case 'request:elicitation':
        reply?.({ action: 'cancel' });
        return;
      case 'execute:python':
        reply?.({ stdout: '', stderr: "MavieChat can't run Python on the phone. Use the server's code interpreter instead.", result: null });
        return;
      default:
        // execute (JavaScript), tool servers, direct connections, terminals: not available in the app.
        reply?.({ error: `MavieChat can't handle “${type}” requests yet.` });
    }
  }

  /**
   * Refetch shortly after a reply finishes, so title, follow-ups and saved output match the server.
   * Not while another reply in the chat is still streaming (e.g. a queued message went out at once):
   * its events build on the local copy, and that reply's own finish refetches.
   */
  private converge(chatId: string): void {
    this.later(() => {
      void this.queryClient.invalidateQueries({ queryKey: ['chats'] });
      const messages = this.queryClient.getQueryData<ChatRecord>(['chat', chatId])?.chat?.history?.messages ?? {};
      if (Object.values(messages).some((message) => message.role === 'assistant' && message.done === false)) return;
      void this.queryClient.invalidateQueries({ queryKey: ['chat', chatId] });
    }, 1500);
  }

  private cachedMessage(chatId: string, messageId: string): boolean {
    const record = this.queryClient.getQueryData<ChatRecord>(['chat', chatId]);
    return Boolean(record?.chat?.history?.messages?.[messageId]);
  }

  private titleOf(chatId: string): string | undefined {
    return this.queryClient.getQueryData<ChatRecord>(['chat', chatId])?.title;
  }
}
