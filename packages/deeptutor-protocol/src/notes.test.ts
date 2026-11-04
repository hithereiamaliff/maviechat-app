import { describe, expect, it } from 'vitest';
import { DtClient, type FetchLike } from './http';
import {
  acceptableHere,
  coverColor,
  createNotePage,
  dueFlashcards,
  getNotePage,
  listNotePages,
  listNoteSuggestions,
  pageTrail,
  reviewNoteSuggestion,
  topLevelPages,
  updateNotePage,
  wordExport,
} from './notes';
import { startTurnCommand } from './turns';

function recordingClient(...answers: (unknown | Response)[]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    const answer = answers.shift();
    return answer instanceof Response ? answer : new Response(JSON.stringify(answer ?? {}), { status: 200 });
  };
  return { client: new DtClient({ baseUrl: 'https://learn.test', token: 't', fetch }), calls };
}

describe('Co-Writer pages', () => {
  it('lists pages with their place in the tree', async () => {
    const pages = await listNotePages(
      recordingClient({
        documents: [
          { id: 'a1', title: 'Biology', preview: 'Cells', parent_id: null, icon: '🧬', cover: 'linear-gradient(135deg, #fde68a, #fca5a5)', pinned: true, revision: 3, created_at: 1_730_000_000, updated_at: 1_730_000_500 },
          { id: 'b2', title: '', parent_id: 'a1', revision: 1, created_at: 1_730_000_100.5, updated_at: 1_730_000_200 },
          { id: 'c3', title: 'Orphan', parent_id: 'gone', revision: 0 },
          { title: 'no id' },
        ],
      }).client,
    );
    expect(pages.map((page) => [page.id, page.parentId, page.pinned, page.updatedAt])).toEqual([
      ['a1', null, true, 1_730_000_500_000],
      ['b2', 'a1', false, 1_730_000_200_000],
      ['c3', 'gone', false, 0],
    ]);
    expect(topLevelPages(pages).map((page) => page.id)).toEqual(['a1', 'c3']);
    expect(pageTrail(pages, 'b2').map((page) => page.id)).toEqual(['a1']);
    expect(coverColor(pages[0]!.cover)).toBe('#fde68a');
    expect(coverColor('#e0f2fe')).toBe('#e0f2fe');
  });

  it('reads a page, older ones without blocks, and saves from the revision it had', async () => {
    const { client, calls } = recordingClient(
      { id: 'a1', title: 'Old', content: '# Old\n\nText', blocks: null, revision: 2 },
      { id: 'n1', title: '', content: '', blocks: [], revision: 0 },
      { id: 'a1', title: 'Old', content: '', blocks: [{ id: 'b', type: 'paragraph' }], pinned: true, revision: 3 },
    );
    const page = await getNotePage(client, 'a1');
    expect(page).toMatchObject({ content: '# Old\n\nText', blocks: null });
    await createNotePage(client, { parentId: 'a1' });
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'https://learn.test/api/documents', body: { title: '', parent_id: 'a1', content: '', blocks: [] } });
    const pinned = await updateNotePage(client, page, { pinned: true });
    expect(calls[2]).toMatchObject({ method: 'PUT', url: 'https://learn.test/api/documents/a1', body: { expected_revision: 2, pinned: true } });
    expect(pinned.revision).toBe(3);
  });

  it('reads due cards and exports a page to Word as bytes', async () => {
    const { client, calls } = recordingClient(
      { cards: [{ page_id: 'a1', page_title: 'Bio', block_id: 'x', card_id: 'k1', front: 'Cell?', back: 'Unit of life', due_at: 1_730_000_000 }, { front: 'no ids' }] },
      new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { status: 200 }),
    );
    expect(await dueFlashcards(client)).toEqual([{ pageId: 'a1', pageTitle: 'Bio', cardId: 'k1', front: 'Cell?', back: 'Unit of life', dueAt: 1_730_000_000_000 }]);
    const bytes = await wordExport(client, { title: '', content: '# Hi' });
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'https://learn.test/api/documents/export/docx', body: { title: 'Untitled', content: '# Hi' } });
  });

  it('accepts a suggestion here only when it needn’t be turned into blocks', async () => {
    const { client, calls } = recordingClient(
      {
        suggestions: [
          { id: 's1', operation: 'replace', block_id: 'b', markdown: 'New text', blocks: [{ id: 'b', type: 'paragraph' }], explanation: 'Clearer', status: 'pending' },
          { id: 's2', operation: 'insert', block_id: 'b', markdown: '- a list', blocks: null, status: 'pending' },
          { id: 's3', operation: 'comment', block_id: 'b', markdown: 'Note', status: 'dismissed' },
        ],
      },
      { id: 'a1', title: 'Bio', content: 'New text', blocks: [{ id: 'b', type: 'paragraph' }], revision: 4 },
    );
    const suggestions = await listNoteSuggestions(client, 'a1');
    expect(suggestions.map((suggestion) => [suggestion.id, acceptableHere(suggestion), suggestion.status])).toEqual([
      ['s1', true, 'pending'],
      ['s2', false, 'pending'],
      ['s3', true, 'dismissed'],
    ]);
    await reviewNoteSuggestion(client, 'a1', suggestions[0]!, true);
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'https://learn.test/api/documents/a1/suggestions/s1', body: { accept: true, blocks: [{ id: 'b', type: 'paragraph' }] } });
  });

  it('names the page a chat talks about on every turn', () => {
    expect(startTurnCommand({ content: 'Shorter?', sessionId: 's', noteDocumentId: 'a1b2c3d4e5f6' })).toMatchObject({ note_document_id: 'a1b2c3d4e5f6' });
    expect(startTurnCommand({ content: 'Hi' })).not.toHaveProperty('note_document_id');
  });
});
