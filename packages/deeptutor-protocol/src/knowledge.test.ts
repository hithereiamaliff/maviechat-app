import { describe, expect, it } from 'vitest';
import { DtClient } from './http';
import { createKnowledgeBase, deleteKbFile, getKbProgress, kbNameProblem, listKnowledgeCenter, providerAccepts, ragPreflight, reindexKnowledgeBase } from './knowledge';

function client(...answers: unknown[]) {
  const calls: { url: string; method: string; body: unknown; type: string | null }[] = [];
  const dt = new DtClient({
    baseUrl: 'https://learn.example.com',
    token: 'tok',
    fetch: async (url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body, type: headers['Content-Type'] ?? null });
      return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
    },
  });
  return { dt, calls };
}

describe('knowledge center', () => {
  it('lists knowledge bases with their engine, documents and progress', async () => {
    const { dt } = client([
      {
        name: 'Biology',
        is_default: true,
        status: 'ready',
        statistics: { raw_documents: 3, rag_provider: 'pageindex-oss', needs_reindex: false },
        metadata: { description: 'Notes', last_indexed_at: '2026-11-03T07:00:00Z' },
      },
      { name: 'Hidden', available: false },
      { name: 'New', status: 'processing', statistics: {}, metadata: { rag_provider: 'llamaindex' }, progress: { stage: 'processing_documents', progress_percent: 40, current: 2, total: 5 } },
    ]);
    const list = await listKnowledgeCenter(dt);
    expect(list.map((kb) => kb.name)).toEqual(['Biology', 'New']);
    expect(list[0]).toMatchObject({ isDefault: true, status: 'ready', provider: 'pageindex-oss', documents: 3, description: 'Notes' });
    expect(list[1]).toMatchObject({ provider: 'llamaindex', progress: { stage: 'processing_documents', percent: 40, current: 2, total: 5 } });
  });

  it('reads progress, or none before indexing starts', async () => {
    const { dt } = client({ status: 'not_started' }, { stage: 'completed', progress_percent: 100, current: 1, total: 1, file_name: 'a.pdf' });
    expect(await getKbProgress(dt, 'x')).toBeNull();
    expect(await getKbProgress(dt, 'x')).toMatchObject({ stage: 'completed', percent: 100, fileName: 'a.pdf' });
  });

  it("says what an engine still needs", async () => {
    const { dt } = client({ ok: false, checks: [{ label: 'Active embedding model', ok: false, detail: 'Configure one in the model catalog.' }, { label: 'BM25', ok: false, optional: true }] });
    expect(await ragPreflight(dt, 'llamaindex')).toEqual({ ok: false, missing: ['Active embedding model: Configure one in the model catalog.'] });
  });

  it('sends a new knowledge base as a form, with its documents', async () => {
    const { dt, calls } = client({ task_id: 'kb_init_1' });
    const file = new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' });
    expect(await createKnowledgeBase(dt, { name: ' Biology ', provider: 'pageindex-oss', pageindexMode: 'flash', files: [file] })).toEqual({ taskId: 'kb_init_1' });
    const form = calls[0]!.body as FormData;
    expect(calls[0]).toMatchObject({ url: 'https://learn.example.com/api/knowledge-bases', method: 'POST', type: null });
    expect([form.get('name'), form.get('rag_provider'), form.get('pageindex_mode'), (form.get('files') as File).name]).toEqual(['Biology', 'pageindex-oss', 'flash', 'notes.pdf']);
  });

  it('removes a document by its path, saying whether its text is still indexed', async () => {
    const { dt, calls } = client({ status: 'ok', was_indexed: true }, {});
    expect(await deleteKbFile(dt, 'My KB', 'week 1/notes #1.pdf')).toEqual({ wasIndexed: true });
    expect(calls[0]).toMatchObject({ url: 'https://learn.example.com/api/knowledge-bases/My%20KB/files/week%201/notes%20%231.pdf', method: 'DELETE' });
    expect(await deleteKbFile(dt, 'My KB', 'a.pdf')).toEqual({ wasIndexed: false });
  });

  it('re-indexes with a form', async () => {
    const { dt, calls } = client({ task_id: 'kb_reindex_1' });
    expect(await reindexKnowledgeBase(dt, 'My KB')).toEqual({ taskId: 'kb_reindex_1' });
    expect(calls[0]).toMatchObject({ url: 'https://learn.example.com/api/knowledge-bases/My%20KB/reindex', method: 'POST', type: null });
    expect(calls[0]!.body).toBeInstanceOf(FormData);
  });

  it("knows names DeepTutor refuses, and each engine's file types", () => {
    expect(kbNameProblem('Biology 101')).toBeNull();
    expect(kbNameProblem('  ')).toBe('Give it a name.');
    expect(kbNameProblem('a/b?')).toBe('Leave out / ?');
    expect(kbNameProblem('x'.repeat(121))).toBe('Use at most 120 characters.');
    expect(providerAccepts('pageindex-oss', 'a.PDF')).toBe(true);
    expect(providerAccepts('pageindex-oss', 'a.docx')).toBe(false);
    expect(providerAccepts('llamaindex', 'a.docx')).toBe(true);
  });
});
