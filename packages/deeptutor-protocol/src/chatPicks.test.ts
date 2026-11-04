import { describe, expect, it } from 'vitest';
import { listChatResources } from './chatOptions';
import { DtClient, type FetchLike } from './http';
import { applyTurnEvent, emptyReply } from './turnReply';
import { startTurnCommand, type DtStreamEvent } from './turns';

let seq = 0;
function event(type: DtStreamEvent['type'], content = '', metadata: Record<string, unknown> = {}): DtStreamEvent {
  seq += 1;
  return { type, content, metadata, source: 'chat', stage: 'responding', session_id: 's', turn_id: 't', seq, timestamp: 1 };
}

describe('what a chat picks for itself', () => {
  it('sends a persona, skills, MCP servers and memory only when given, empty ones too', () => {
    const plain = startTurnCommand({ content: 'Hi', sessionId: 's' });
    expect(plain).not.toHaveProperty('persona');
    expect(plain).not.toHaveProperty('skills');
    expect(plain).not.toHaveProperty('mcp');
    expect(plain).not.toHaveProperty('memory_references');
    expect(startTurnCommand({ content: 'Hi', persona: '', skills: [], mcp: [], memoryReferences: [] })).toMatchObject({ persona: '', skills: [], mcp: [] });
    expect(startTurnCommand({ content: 'Hi', memoryReferences: [] })).not.toHaveProperty('memory_references');
    expect(startTurnCommand({ content: 'Hi', persona: 'teacher', skills: ['pdf'], mcp: ['account:notes'], memoryReferences: ['summary', 'profile'] })).toMatchObject({
      persona: 'teacher',
      skills: ['pdf'],
      mcp: ['account:notes'],
      memory_references: ['summary', 'profile'],
    });
  });

  it('reads the skills and MCP servers a chat may use', async () => {
    const calls: string[] = [];
    const fetch: FetchLike = async (url) => {
      calls.push(url);
      return new Response(JSON.stringify({ skills: [{ id: 'pdf', name: 'pdf', description: 'PDFs', source: 'builtin' }, { name: 'no id' }], mcp: [{ id: 'account:notes', name: 'notes', source: 'account', available: false }], knowledge_bases: [] }));
    };
    const resources = await listChatResources(new DtClient({ baseUrl: 'https://learn.test', token: 't', fetch }));
    expect(calls[0]).toBe('https://learn.test/api/settings/workspace/resources?workspace_id=');
    expect(resources).toEqual({ skills: [{ id: 'pdf', name: 'pdf', description: 'PDFs' }], mcp: [{ id: 'account:notes', name: 'notes', available: false }] });
  });
});

describe('tools from MCP servers and CLI apps', () => {
  it('keeps which server a tool belongs to, and its progress while it runs', () => {
    seq = 0;
    let reply = emptyReply();
    reply = applyTurnEvent(reply, event('tool_call', 'mcp_notes_search', { call_id: 'c1', tool_name: 'mcp_notes_search', args: { query: 'x' }, tool_source: 'mcp', tool_provider: 'notes' }));
    reply = applyTurnEvent(reply, event('tool_call', 'web_search', { call_id: 'c2', tool_name: 'web_search', args: {} }));
    expect(reply.tools.map((tool) => tool.provider)).toEqual([{ source: 'mcp', name: 'notes' }, undefined]);
    reply = applyTurnEvent(reply, event('progress', 'Indexing (40%)', { call_id: 'c1', trace_kind: 'tool_progress', tool_source: 'mcp', tool_provider: 'notes', progress_fraction: 0.4 }));
    expect(reply.tools[0]).toMatchObject({ progress: 'Indexing (40%)', fraction: 0.4 });
    expect(reply.activity).toBe('Indexing (40%)');
    reply = applyTurnEvent(reply, event('tool_result', 'Found 3 notes', { call_id: 'c1', tool_name: 'mcp_notes_search', tool_source: 'mcp', tool_provider: 'notes' }));
    expect(reply.tools[0]).toMatchObject({ done: true, result: 'Found 3 notes', progress: undefined, provider: { source: 'mcp', name: 'notes' } });
  });

  it('marks a CLI app’s tool, and a result without a call before it', () => {
    seq = 0;
    let reply = emptyReply();
    reply = applyTurnEvent(reply, event('tool_result', 'done', { call_id: 'c9', tool_name: 'cli_pandoc', tool_source: 'cli', tool_provider: 'pandoc' }));
    expect(reply.tools[0]).toMatchObject({ name: 'cli_pandoc', done: true, provider: { source: 'cli', name: 'pandoc' } });
  });
});
