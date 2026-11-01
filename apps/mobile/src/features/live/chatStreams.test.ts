import type { ChatEventEnvelope, ChatRecord } from '@maviechat/owui-protocol';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ChatStreams, type StreamHooks } from './chatStreams';

function setup(viewing = 'c1') {
  const queryClient = new QueryClient();
  const frames: (() => void)[] = [];
  const timers: (() => void)[] = [];
  const hooks: StreamHooks = {
    confirm: vi.fn(async () => true),
    prompt: vi.fn(async () => 'typed'),
    notify: vi.fn(),
    isViewing: (id) => id === viewing,
  };
  const streams = new ChatStreams(
    queryClient,
    hooks,
    (flush) => frames.push(flush),
    (run) => timers.push(run),
  );
  const seed = (chatId: string) =>
    queryClient.setQueryData<ChatRecord>(['chat', chatId], {
      id: chatId,
      title: 'Chat',
      updated_at: 0,
      created_at: 0,
      chat: {
        history: {
          currentId: 'a1',
          messages: {
            u1: { id: 'u1', parentId: null, childrenIds: ['a1'], role: 'user', content: 'Hi' },
            a1: { id: 'a1', parentId: 'u1', childrenIds: [], role: 'assistant', content: '', done: false },
          },
        },
      },
    });
  const event = (chatId: string, messageId: string, type: string, data?: unknown): ChatEventEnvelope => ({
    chat_id: chatId,
    message_id: messageId,
    data: { type, data },
  });
  const reply = () => queryClient.getQueryData<ChatRecord>(['chat', 'c1'])?.chat.history?.messages.a1;
  return { queryClient, frames, timers, hooks, streams, seed, event, reply };
}

describe('ChatStreams', () => {
  it('batches message events into one cache update per frame', () => {
    const { streams, seed, event, frames, reply } = setup();
    seed('c1');
    streams.handle(event('c1', 'a1', 'response:completion', { type: 'response.output_text.delta', output_index: 0, delta: 'Hel' }));
    streams.handle(event('c1', 'a1', 'response:completion', { type: 'response.output_text.delta', output_index: 0, delta: 'lo' }));
    expect(frames).toHaveLength(1);
    expect(reply()?.content).toBe('');
    frames[0]?.();
    expect(reply()?.content).toBe('Hello');
  });

  it('holds events for a new chat until the server names it', () => {
    const { streams, seed, event, frames, reply } = setup();
    streams.track(['a1'], null);
    streams.handle(event('server-id', 'a1', 'chat:message:delta', { content: 'early' }));
    expect(frames).toHaveLength(0);
    seed('c1');
    streams.bind(['a1'], 'c1');
    frames[0]?.();
    expect(reply()?.content).toBe('early');
  });

  it('refetches the chat shortly after a reply finishes', () => {
    const { streams, seed, event, frames, timers, queryClient } = setup();
    seed('c1');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    streams.handle(event('c1', 'a1', 'chat:completion', { done: true, content: 'Done' }));
    frames[0]?.();
    expect(timers).toHaveLength(1);
    timers[0]?.();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chat', 'c1'] });
  });

  it('waits to refetch while another reply in the chat is still streaming', () => {
    const { streams, seed, event, frames, timers, queryClient } = setup();
    seed('c1');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    streams.handle(event('c1', 'a1', 'chat:completion', { done: true, content: 'Done' }));
    frames[0]?.();
    // A queued message went out right away: a new reply is streaming in the same chat.
    queryClient.setQueryData<ChatRecord>(['chat', 'c1'], (record) => {
      const history = record!.chat.history!;
      const next = { id: 'a2', parentId: 'u1', childrenIds: [], role: 'assistant', content: '', done: false };
      return { ...record!, chat: { ...record!.chat, history: { ...history, messages: { ...history.messages, a2: next } } } };
    });
    timers[0]?.();
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['chat', 'c1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chats'] });
  });

  it('updates titles live and refreshes the sidebar on list changes', () => {
    const { streams, seed, event, queryClient } = setup();
    seed('c1');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    streams.handle(event('c1', 'a1', 'chat:title', 'Weather plans'));
    expect(queryClient.getQueryData<ChatRecord>(['chat', 'c1'])?.title).toBe('Weather plans');
    streams.handle(event('c1', 'a1', 'chat:list', {}));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chats'] });
  });

  it('keeps the original text when an outlet filter rewrites a message', () => {
    const { streams, seed, event, reply } = setup();
    seed('c1');
    streams.handle(event('c1', 'a1', 'chat:outlet', { messages: [{ id: 'a1', content: 'Filtered' }] }));
    expect(reply()?.content).toBe('Filtered');
    expect(reply()?.originalContent).toBe('');
  });

  it('answers requests that wait for a reply', async () => {
    const { streams, event, hooks } = setup();
    const answers: unknown[] = [];
    streams.handle(event('c1', 'a1', 'confirmation', { title: 'Run?', message: 'Sure?' }), (value) => answers.push(value));
    streams.handle(event('c1', 'a1', 'execute', { code: 'alert(1)' }), (value) => answers.push(value));
    streams.handle(event('c1', 'a1', 'request:user_input', { questions: [] }), (value) => answers.push(value));
    await Promise.resolve();
    await Promise.resolve();
    expect(hooks.confirm).toHaveBeenCalledWith('Run?', 'Sure?');
    expect(answers).toContainEqual(true);
    expect(answers).toContainEqual({ status: 'cancelled', answers: {} });
    expect(answers.some((value) => typeof value === 'object' && value !== null && 'error' in value)).toBe(true);
  });

  it('announces replies finishing in chats you are not viewing', () => {
    const { streams, event, hooks } = setup('somewhere-else');
    streams.handle(event('c9', 'x1', 'chat:completion', { done: true }));
    expect(hooks.notify).toHaveBeenCalledWith('Reply ready in “a chat”', 'success');
  });
});
