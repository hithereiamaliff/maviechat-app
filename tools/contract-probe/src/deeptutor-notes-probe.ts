import {
  ankiExport,
  createNotePage,
  deleteNotePage,
  dueFlashcards,
  DtHttpError,
  getNotePage,
  gradeFlashcard,
  importWord,
  listModules,
  listNotePages,
  listNoteSuggestions,
  listNoteThreads,
  noteBacklinks,
  updateNotePage,
  wordExport,
  type DtClient,
} from '@maviechat/deeptutor-protocol';

async function statusOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'ok';
  } catch (error) {
    if (error instanceof DtHttpError) return `${error.status} ${error.detail ?? ''}`.trim();
    throw error;
  }
}

const paragraph = (id: string, words: string) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text: words, styles: {} }], children: [] });

/**
 * B8 against a live DeepTutor, in the test account's own notebook: a scratch page made, a block
 * saved from its revision, a stale save and a Markdown-only save refused, pinned and unpinned, a
 * subpage moving up when its parent goes, no backlinks, conversations or suggestions; a flashcard
 * block's card due and graded; the Anki and Word exports; that Word file imported as a page; all
 * deleted. No model, nothing outside DeepTutor.
 */
export async function probeNotes(client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const fixture: Record<string, unknown> = {};
  const module = (await listModules(client)).find((row) => row.id === 'co-writer');
  fixture.module = module ? { enabled: module.enabled, ready: module.ready } : 'absent';
  if (!module?.enabled) return { note: 'Co-Writer is off on this server', fixture };
  fixture.before = (await listNotePages(client)).length;
  const stamp = Date.now().toString(36);
  const made: string[] = [];
  try {
    const page = await createNotePage(client, { title: `APP PROBE page ${stamp}` });
    made.push(page.id);
    if (page.revision !== 0 || !Array.isArray(page.blocks)) throw new Error('a new page didn’t start at revision 0 with blocks');
    const saved = (await client.send<Record<string, unknown>>('PUT', `/api/documents/${page.id}`, { body: { blocks: [paragraph('p1', 'APP PROBE paragraph')], expected_revision: 0 } })).data;
    if (saved.revision !== 1) throw new Error(`saving a block gave revision ${String(saved.revision)}`);
    const read = await getNotePage(client, page.id);
    if (!read.content.includes('APP PROBE paragraph')) throw new Error('the Markdown copy didn’t follow the blocks');
    fixture.stale = await statusOf(() => client.send('PUT', `/api/documents/${page.id}`, { body: { blocks: [paragraph('p1', 'stale')], expected_revision: 0 } }));
    fixture.markdownOnly = await statusOf(() => client.send('PUT', `/api/documents/${page.id}`, { body: { content: 'plain' } }));
    if (!String(fixture.stale).startsWith('409') || !String(fixture.markdownOnly).startsWith('409')) throw new Error(`a stale save gave ${String(fixture.stale)}; a Markdown-only one ${String(fixture.markdownOnly)}`);
    const pinned = await updateNotePage(client, read, { pinned: true });
    const unpinned = await updateNotePage(client, pinned, { pinned: false });
    fixture.pinRevisions = [read.revision, pinned.revision, unpinned.revision];

    const child = await createNotePage(client, { title: `APP PROBE subpage ${stamp}`, parentId: page.id });
    made.push(child.id);
    if ((await listNotePages(client)).find((row) => row.id === child.id)?.parentId !== page.id) throw new Error('the subpage wasn’t listed under its page');
    fixture.backlinks = (await noteBacklinks(client, page.id)).length;
    fixture.threads = (await listNoteThreads(client, page.id)).length;
    fixture.suggestions = (await listNoteSuggestions(client, page.id)).length;

    const cards = { cards: [{ front: `APP PROBE front ${stamp}`, back: 'APP PROBE back' }] };
    const learning = { id: 'f1', type: 'learning', props: { kind: 'flashcards', prompt: 'APP PROBE', markdown: '', data: JSON.stringify(cards), sourceUrl: '' }, children: [] };
    const withCards = (await client.send<Record<string, unknown>>('PUT', `/api/documents/${page.id}`, { body: { blocks: [paragraph('p1', 'APP PROBE paragraph'), learning], expected_revision: unpinned.revision } })).data;
    fixture.withCardsRevision = withCards.revision;
    const due = (await dueFlashcards(client)).find((card) => card.pageId === page.id);
    if (!due || due.back !== 'APP PROBE back') throw new Error('the new card wasn’t due');
    const graded = await gradeFlashcard(client, due, true);
    if (graded.intervalDays < 1) throw new Error(`remembering a card gave ${graded.intervalDays} days`);
    if ((await dueFlashcards(client)).some((card) => card.pageId === page.id)) throw new Error('a remembered card was still due');
    const anki = await ankiExport(client, page.id);
    if (!anki.includes(`APP PROBE front ${stamp}`)) throw new Error('the Anki export missed the card');

    const docx = await wordExport(client, await getNotePage(client, page.id));
    if (docx[0] !== 0x50 || docx[1] !== 0x4b) throw new Error('the Word export isn’t a .docx (zip) file');
    fixture.wordBytes = docx.length > 1000 ? 'over 1 KB' : docx.length;
    const imported = await importWord(client, new Blob([new Uint8Array(docx)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `APP PROBE import ${stamp}.docx`);
    made.push(imported.id);
    if (imported.blocks !== null || !imported.content.includes('APP PROBE paragraph')) throw new Error('the imported Word file didn’t become a Markdown page with its text');
    fixture.importedTitle = imported.title.startsWith('APP PROBE import') ? 'the file’s name' : imported.title;

    await deleteNotePage(client, page.id);
    made.splice(made.indexOf(page.id), 1);
    const orphan = (await listNotePages(client)).find((row) => row.id === child.id);
    if (!orphan || orphan.parentId) throw new Error('the subpage didn’t move up when its page was deleted');
  } finally {
    for (const id of made.reverse()) await deleteNotePage(client, id).catch(() => undefined);
  }
  if ((await listNotePages(client)).some((row) => row.title.startsWith('APP PROBE'))) throw new Error('a probe page was left behind');
  return { note: 'a scratch page saved from its revision (stale and Markdown-only saves refused: 409), pinned and unpinned, a subpage moved up when its page went; a flashcard due, remembered, exported for Anki; a Word export (zip) imported back as a Markdown page; all deleted', fixture };
}
