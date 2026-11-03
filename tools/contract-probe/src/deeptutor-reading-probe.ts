import {
  addBookmark,
  clock,
  addToCollection,
  applyTurnEvent,
  createCollection,
  deleteAnnotation,
  deleteCollection,
  deleteMaterial,
  DtTurnConnection,
  emptyReply,
  getCollection,
  getMaterial,
  getPosition,
  getSession,
  getSupportedFormats,
  getTranscript,
  getUnit,
  importLinks,
  listAnnotations,
  listBookmarks,
  listCollectionChats,
  listCollections,
  listLibrary,
  passageSelectors,
  readingOfPreferences,
  readingTurnFields,
  removeBookmark,
  removeFromCollection,
  saveAnnotation,
  savePosition,
  socketCookieHeader,
  textBlocks,
  turnSocketUrl,
  uploadMaterial,
  type DtClient,
  type DtReply,
} from '@maviechat/deeptutor-protocol';
import { shapeOf } from './shape';

const NodeWebSocket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;

const PROBE_TEXT = [
  'Photosynthesis turns light into chemical energy.',
  '',
  'Plants take in carbon dioxide and water, and with the energy of sunlight they make glucose and give off oxygen.',
  '',
  'The light reactions happen in the thylakoid membranes; the Calvin cycle happens in the stroma.',
].join('\n');

/**
 * B5.3 against a live DeepTutor, in the test account: the formats it reads; an "APP PROBE:"
 * collection; a small text file uploaded (read at once) and a web page imported by link (fetched in
 * the background, polled); a unit read; a highlight checked against the unit's text, its note
 * changed, then deleted; a bookmark added and removed; the reading place saved and read back; one
 * tutor message about a passage (the chat filed under the collection); a material taken out of
 * the collection; then the collection (with its chat) and both materials deleted. Uses the
 * account's model for one reply.
 */
export async function probeReading(baseUrl: string, token: string, client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const notes: string[] = [];
  const fixture: Record<string, unknown> = {};
  const materials: string[] = [];
  let collectionId: string | null = null;
  let reply: DtReply = emptyReply();
  let wake: () => void = () => undefined;
  const connection = new DtTurnConnection({
    url: turnSocketUrl(baseUrl),
    connect: (url, handlers) => {
      const socket = new NodeWebSocket(url, { headers: { Cookie: socketCookieHeader(token) } });
      socket.onopen = () => handlers.onOpen();
      socket.onmessage = (event) => handlers.onMessage(event.data);
      socket.onclose = (event) => handlers.onClose(event.code);
      return { send: (data) => socket.send(data), close: () => socket.close() };
    },
    onEvent: (event) => {
      reply = applyTurnEvent(reply, event);
      if (event.type === 'done') wake();
    },
    onError: (error) => {
      reply = { ...reply, status: 'failed', error: `${error.error_code}: ${error.message}` };
      wake();
    },
  });

  try {
    const formats = await getSupportedFormats(client);
    fixture.formats = { extensions: formats.extensions.length, maxBytes: formats.maxBytes, txt: formats.extensions.includes('txt'), pdf: formats.extensions.includes('pdf') };
    if (!formats.extensions.includes('txt')) throw new Error('DeepTutor does not read .txt files');
    const listed = await listCollections(client);
    if (!listed.canCreate) throw new Error('the test account may not make collections');

    const collection = await createCollection(client, { title: 'APP PROBE: reading', color: 'teal' });
    collectionId = collection.id;
    if (!/^rw_[0-9a-f]{32}$/.test(collection.id)) throw new Error(`unexpected collection id ${collection.id}`);

    // A file is read before DeepTutor answers.
    const detail = await uploadMaterial(client, new Blob([PROBE_TEXT], { type: 'text/plain' }), 'app-probe-photosynthesis.txt', false);
    materials.push(detail.id);
    if (detail.unitCount < 1 || detail.contentFormat !== 'plain_text') throw new Error(`the upload came back with ${detail.unitCount} units, ${detail.contentFormat}`);
    await addToCollection(client, collection.id, detail.id, true);
    fixture.material = shapeOf(await getMaterial(client, detail.id));
    notes.push(`collection made; a text file read at once (${detail.unitCount} ${detail.unit})`);

    // A link is fetched in the background.
    const imported = await importLinks(client, ['https://example.com/'], { collectionId: collection.id });
    const link = imported.materials[0];
    if (!link) throw new Error('the link import gave no material');
    materials.push(link.id);
    let linkStatus = link.status;
    for (let tries = 0; tries < 30 && (linkStatus === 'queued' || linkStatus === 'processing'); tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      linkStatus = (await getCollection(client, collection.id)).collection.materials.find((item) => item.id === link.id)?.status ?? 'missing';
    }
    fixture.link = { status: linkStatus };
    notes.push(`a link imported (${linkStatus})`);

    // Reading: a unit, a highlight checked against it, a bookmark, your place.
    const unit = await getUnit(client, detail.id, 1);
    const block = textBlocks(unit)[1];
    if (!block) throw new Error('the unit has fewer than two paragraphs');
    const saved = await saveAnnotation(client, detail.id, { locator: 1, quote: block.text, color: 'green', selectors: passageSelectors(unit, block.start, block.end) });
    if (saved.quote !== block.text || saved.color !== 'green') throw new Error('the highlight came back different');
    const noted = await saveAnnotation(client, detail.id, { id: saved.id, locator: 1, quote: saved.quote, color: 'green', note: 'probe note', selectors: saved.selectors });
    if (noted.id !== saved.id || noted.note !== 'probe note') throw new Error('changing the note made a new highlight');
    const wrong = await saveAnnotation(client, detail.id, { locator: 1, quote: 'not in the text', selectors: passageSelectors('not in the text', 0, 15) }).then(
      () => false,
      () => true,
    );
    if (!wrong) throw new Error('a highlight of text not in the unit was accepted');
    fixture.annotation = shapeOf(noted, 3);
    await deleteAnnotation(client, detail.id, saved.id);
    if ((await listAnnotations(client, detail.id)).length) throw new Error('the highlight stayed');
    const bookmark = await addBookmark(client, detail.id, 1, 'Probe');
    if (!(await listBookmarks(client, detail.id)).some((item) => item.id === bookmark.id)) throw new Error('the bookmark is not listed');
    await removeBookmark(client, detail.id, bookmark.id);
    await savePosition(client, detail.id, { locator: 1, anchor: '', percentage: 1 });
    const place = await getPosition(client, detail.id);
    if (place?.locator !== 1) throw new Error('the reading place was not kept');
    notes.push('unit read; highlight checked, noted and deleted (wrong text refused); bookmark; place kept');

    // The tutor beside the text: one message about the passage.
    reply = emptyReply();
    const answered = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no answer within 3 minutes')), 180_000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    const started = await connection.startTurn({
      content: 'In one short sentence: where does the Calvin cycle happen, according to my reading?',
      ...readingTurnFields({ collectionId: collection.id, materialId: detail.id, revision: detail.revision, viewport: { locator: 1, selection: block.text } }),
    });
    await answered;
    if (reply.status === 'failed') throw new Error(`the tutor's reply failed: ${reply.error ?? ''}`);
    const chat = await getSession(client, started.sessionId);
    const filed = readingOfPreferences(chat.preferences as Record<string, unknown>);
    if (filed?.collectionId !== collection.id || filed.materialId !== detail.id) throw new Error('the chat is not filed under the collection');
    const chats = await listCollectionChats(client, collection.id);
    if (!chats.some((item) => item.id === started.sessionId)) throw new Error("the collection's chats don't list it");
    fixture.chat = { preferences: shapeOf(chat.preferences), answerMentionsStroma: /stroma/i.test(reply.answer) };
    notes.push(`tutor answered${/stroma/i.test(reply.answer) ? ' from the passage' : ''}; chat filed under the collection`);

    // Out of the collection, then everything deleted.
    const smaller = await removeFromCollection(client, collection.id, link.id);
    if (smaller.materials.some((item) => item.id === link.id)) throw new Error('the link stayed in the collection');
    const library = await listLibrary(client);
    if (!materials.every((id) => library.some((item) => item.id === id))) throw new Error('the library lacks the probe materials');
    await deleteCollection(client, collection.id);
    collectionId = null;
    const chatGone = await getSession(client, started.sessionId).then(
      () => false,
      () => true,
    );
    for (const id of materials.splice(0)) await deleteMaterial(client, id);
    const left = await listLibrary(client);
    if (left.some((item) => item.id === detail.id || item.id === link.id)) throw new Error('a deleted material is still in the library');
    notes.push(`taken out of the collection; collection deleted${chatGone ? ' with its chat' : ' (its chat stayed)'}; materials deleted`);
    return { note: notes.join('; '), fixture };
  } catch (error) {
    throw new Error(`${notes.join('; ')}${notes.length ? '; then ' : ''}${error instanceof Error ? error.message : String(error)}`);
  } finally {
    connection.close();
    if (collectionId) await deleteCollection(client, collectionId).catch(() => undefined);
    for (const id of materials) await deleteMaterial(client, id).catch(() => undefined);
  }
}

/**
 * B5.4 against a live DeepTutor, in the test account, with no model calls: a short YouTube video
 * imported into an "APP PROBE:" collection (DeepTutor fetches its captions, or files it without
 * them), its transcript read with each segment's start time, the place saved at a time
 * (`#t=`) and read back, a note at a time kept and deleted; then the collection and the video
 * deleted.
 */
export async function probeVideo(client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const notes: string[] = [];
  const fixture: Record<string, unknown> = {};
  let collectionId: string | null = null;
  let materialId: string | null = null;
  try {
    const collection = await createCollection(client, { title: 'APP PROBE: video', color: 'rose' });
    collectionId = collection.id;
    const imported = await importLinks(client, ['https://www.youtube.com/watch?v=jNQXAC9IVRw'], { collectionId: collection.id });
    const video = imported.materials[0];
    if (!video) throw new Error('the import gave no material');
    materialId = video.id;
    if (video.kind !== 'youtube') throw new Error(`the link was filed as ${video.kind}`);
    let status = video.status;
    for (let tries = 0; tries < 45 && (status === 'queued' || status === 'processing'); tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      status = (await getCollection(client, collection.id)).collection.materials.find((item) => item.id === video.id)?.status ?? 'missing';
    }
    if (status !== 'ready') throw new Error(`the video came out ${status}`);
    const detail = await getMaterial(client, video.id);
    const transcript = await getTranscript(client, video.id);
    fixture.video = { renderMode: detail.renderMode, unit: detail.unit, units: detail.unitCount, segments: transcript.segments.length, timed: transcript.segments.every((segment) => segment.start >= 0), refs: shapeOf(detail.unitRefs.slice(0, 1)) };
    notes.push(`a YouTube video imported (${detail.renderMode}, ${transcript.segments.length} transcript segments${transcript.segments.length ? `, the last at ${clock(transcript.segments[transcript.segments.length - 1]!.start)}` : ', no captions'})`);

    await savePosition(client, video.id, { locator: 1, anchor: '#t=7', percentage: 0.35 });
    const place = await getPosition(client, video.id);
    if (place?.anchor !== '#t=7') throw new Error(`the place came back as ${place?.anchor ?? 'nothing'}`);
    const quote = transcript.segments[0]?.text ?? 'Probe note';
    const note = await saveAnnotation(client, video.id, { locator: 1, kind: 'note', quote: quote.slice(0, 2000), note: 'probe note', anchor: '#t=5' });
    if (note.kind !== 'note' || note.anchor !== '#t=5') throw new Error('the note at a time came back different');
    await deleteAnnotation(client, video.id, note.id);
    notes.push('place kept at #t=7; a note at #t=5 kept and deleted');

    await deleteCollection(client, collection.id);
    collectionId = null;
    await deleteMaterial(client, video.id);
    materialId = null;
    notes.push('collection and video deleted');
    return { note: notes.join('; '), fixture };
  } catch (error) {
    throw new Error(`${notes.join('; ')}${notes.length ? '; then ' : ''}${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (collectionId) await deleteCollection(client, collectionId).catch(() => undefined);
    if (materialId) await deleteMaterial(client, materialId).catch(() => undefined);
  }
}
