import { describe, expect, it } from 'vitest';
import { DtClient, type FetchLike } from './http';
import { describeMemoryRef, editMemoryFact, getMemoryOverview, getMemoryRun, getMemoryRunLimits, memoryDocLabel, memoryRunModes, parseMemorySheet, startMemoryRun } from './memory';

function recordingClient(...answers: unknown[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
  };
  return { client: new DtClient({ baseUrl: 'https://learn.test', token: 't', fetch }), calls };
}

const A = 'm_01JC0000000000000000000000';
const B = 'm_01JC0000000000000000000001';
const C = 'm_01JC0000000000000000000002';

describe('fact sheets', () => {
  it('reads facts with their sources, numbered footnotes shared between facts', () => {
    const sheet = parseMemorySheet(
      [
        '# chat memory',
        '',
        '## Study habits',
        `- Revises calculus on weekends [^1], [^2] <!--${A}-->`,
        `- Prefers worked examples [^2] <!-- ${B} -->`,
        '## Goals',
        `- Wants to pass the exam in June <!--${C}-->`,
        '',
        '---',
        '[^1]: chat:sess_abc',
        '[^2]: notebook:rec_9',
      ].join('\n'),
    );
    expect(sheet.title).toBe('chat memory');
    expect(sheet.sections).toEqual([
      {
        name: 'Study habits',
        entries: [
          { id: A, text: 'Revises calculus on weekends', refs: ['chat:sess_abc', 'notebook:rec_9'] },
          { id: B, text: 'Prefers worked examples', refs: ['notebook:rec_9'] },
        ],
      },
      { name: 'Goals', entries: [{ id: C, text: 'Wants to pass the exam in June', refs: [] }] },
    ]);
  });

  it('reads the older style, where each fact’s footnote lists its sources', () => {
    const sheet = parseMemorySheet(['# User profile', '## Who', `- A first-year student[^${A}]`, '- A bullet without an id', '', `[^${A}]: chat, notebook`].join('\n'));
    expect(sheet.sections[0]?.entries).toEqual([
      { id: A, text: 'A first-year student', refs: ['chat', 'notebook'] },
      { id: '', text: 'A bullet without an id', refs: [] },
    ]);
    expect(parseMemorySheet('').sections).toEqual([]);
  });

  it('says what each source is', () => {
    expect(describeMemoryRef('chat:sess_abc')).toEqual({ kind: 'item', surface: 'chat', id: 'sess_abc' });
    expect(describeMemoryRef('partner:p1:web-abc')).toEqual({ kind: 'item', surface: 'partner', id: 'p1:web-abc' });
    expect(describeMemoryRef('chat')).toEqual({ kind: 'sheet', surface: 'chat' });
    expect(describeMemoryRef(A)).toEqual({ kind: 'fact', id: A });
    expect(describeMemoryRef('chat:01JC0000000000000000000000')).toEqual({ kind: 'turn', surface: 'chat' });
    expect(describeMemoryRef('what?')).toEqual({ kind: 'unknown', ref: 'what?' });
    expect(memoryDocLabel('L3', 'scope')).toBe('Knowledge Scope');
    expect(memoryDocLabel('L2', 'notebook')).toBe('Favorites');
  });

  it('reads the overview', async () => {
    const overview = await getMemoryOverview(
      recordingClient({ docs: [{ layer: 'L2', key: 'chat', exists: true, updated_at: '2026-11-04T08:00:00Z', entry_count: 4, backlog: 0 }, { layer: 'L9', key: 'x' }], backups: [] }).client,
    );
    expect(overview).toEqual({ docs: [{ layer: 'L2', key: 'chat', exists: true, updatedAt: '2026-11-04T08:00:00Z', entries: 4 }], archived: false });
  });

  it('rewords a fact keeping its sources', async () => {
    const { client, calls } = recordingClient({ accepted: true, results: [] }, { accepted: false, reason: 'edit: text length must be 1..240' });
    await editMemoryFact(client, 'L2', 'chat', { id: A, refs: ['chat:sess_abc'] }, 'Revises on Sundays');
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://learn.test/api/memory/doc/L2/chat/apply', body: { ops: [{ op: 'edit', target_id: A, new_text: 'Revises on Sundays', new_refs: ['chat:sess_abc'] }] } });
    await expect(editMemoryFact(client, 'L2', 'chat', { id: A, refs: [] }, 'x')).rejects.toThrow('240');
  });
});

describe('memory runs', () => {
  it('keeps a run to the web’s limits and reads its state', async () => {
    const { client, calls } = recordingClient({ id: 'r1', layer: 'L2', key: 'chat', mode: 'update', status: 'queued', event_count: 0 }, { id: 'r1', layer: 'L2', key: 'chat', mode: 'update', status: 'done', event_count: 42, undo_count: 0 });
    const run = await startMemoryRun(client, { layer: 'L2', key: 'chat', mode: 'update', budget: 900 });
    expect(calls[0]?.body).toEqual({ layer: 'L2', key: 'chat', mode: 'update', language: 'en', budget: 200 });
    expect(run.status).toBe('queued');
    expect(await getMemoryRun(client, 'r1')).toMatchObject({ status: 'done', events: 42 });
  });

  it('offers only tidying for preferences, and reads the run sizes', async () => {
    expect(memoryRunModes('L3', 'preferences')).toEqual(['dedup']);
    expect(memoryRunModes('L2', 'chat')).toEqual(['update', 'audit', 'dedup']);
    expect(await getMemoryRunLimits(recordingClient({ update: { l2_budget: 20, l3_budget: 10 }, audit: { l2_budget: 500 }, dedup: { iterations: 3 } }).client)).toEqual({
      update: { L2: 20, L3: 10 },
      audit: { L2: 200, L3: 10 },
      dedupIterations: 3,
    });
  });
});
