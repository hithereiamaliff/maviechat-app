import { noteHtml } from '@maviechat/owui-markdown';
import {
  accessRights,
  attachmentLink,
  attachmentsIn,
  changeNotePages,
  createNote,
  deleteChat,
  deleteFile,
  deleteNote,
  droppedGrants,
  fileItemFromUpload,
  getChat,
  getNote,
  getNoteChat,
  isAtLeast,
  listChats,
  listNoteChats,
  listNotes,
  listPinnedNotes,
  newNoteChat,
  newPageTitle,
  noteChangeOf,
  openSocketSession,
  OwuiHttpError,
  pictureLink,
  saveKeepsSharing,
  saveNote,
  saveNoteNow,
  suggestNoteTitle,
  toggleNotePinned,
  updateAccess,
  uploadFile,
  uuidv4,
  withNoteFile,
  withoutAttachment,
  withoutNoteFile,
  type AccessGrant,
  type Capabilities,
  type NoteChange,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

interface NotesInput {
  client: OwuiClient;
  baseUrl: string;
  token: string;
  userId: string;
  capabilities: Capabilities;
  /** A model the account can use: a note's title is asked of it (one short completion). */
  modelId?: string;
}

/**
 * The native Notes slice, as the test account, on its own probe note only (deleted afterwards):
 * made with Markdown and the HTML the web's editor loads, found by search and by whose, saved
 * (the web's note event arriving on a socket that follows it, carrying the save's time), renamed,
 * pinned and unpinned, shared and kept shared through a save (and the trap a save without its
 * sharing would spring, shown on the probe note), a file attached the way the version keeps one
 * (0.11's list, 0.12's text), the note's chats (made, listed, kept out of the chat list), 0.12's
 * pages, and deleted, with its file and chats. With a model, a title is asked for a short text.
 */
export async function probeNotes(input: NotesInput): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client, capabilities } = input;
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  if (input.modelId) {
    await check('a title suggested for a note’s text, by a model', async () => {
      const title = await suggestNoteTitle(client, input.modelId ?? '', 'Buy milk, eggs and bread on Saturday morning. Pick up the dry cleaning on the way back.', `mc-probe-${uuidv4().slice(0, 8)}`);
      const words = title.split(/\s+/).length;
      fixture.title = { words, length: title.length };
      if (title.length > 80) throw new Error(`the title ran to ${title.length} characters`);
      return `a ${words}-word title`;
    });
  }
  if (!capabilities.feature('notes', true)) {
    steps.push({ name: 'notes', ok: true, note: 'skipped: notes are off for this account' });
    return { steps, fixture };
  }

  const word = `mcprobe${uuidv4().replace(/-/g, '').slice(0, 8)}`;
  const firstText = `APP PROBE ${word}\nsecond line\n\n- [ ] milk\n- [x] eggs`;
  let id: string | null = null;
  const pagesOn = isAtLeast(capabilities.version, '0.12.0');
  const files: string[] = [];
  const chats: string[] = [];
  const socket = openSocketSession({ baseUrl: input.baseUrl, token: input.token, expectedUserId: input.userId, websocketOnly: capabilities.websocketOnly, heartbeatIntervalSec: capabilities.heartbeatIntervalSec });
  try {
    await check('a note made with Markdown and the HTML the web loads', async () => {
      const note = await createNote(client, { title: `APP PROBE ${word}`, md: firstText, html: noteHtml(firstText) });
      id = note.id;
      const back = await getNote(client, note.id);
      const raw = await client.get<{ data?: { content?: { json?: unknown } } }>(`/api/v1/notes/${note.id}`);
      fixture.made = { json: raw.data?.content?.json ?? null, taskList: back.html.includes('data-type="taskList"'), lineBreak: back.html.includes('<br>') };
      if (back.md !== firstText) throw new Error('the Markdown didn’t read back as written');
      if (!back.html.includes('data-type="taskItem" data-checked="true"') || !back.html.includes('<br>second line')) throw new Error('the HTML didn’t read back as made');
      if (!back.writeAccess || back.accessGrants.length) throw new Error('a new note wasn’t yours alone');
      return 'read back: Markdown as written, HTML with the editor’s task list and line breaks, no editor JSON, private';
    });
    const noteId = (): string => {
      if (!id) throw new Error('no probe note');
      return id;
    };

    await check('found by a word in it, and by whose', async () => {
      const found = await listNotes(client, { query: word });
      const mine = await listNotes(client, { query: word, view: 'created' });
      const shared = await listNotes(client, { query: word, view: 'shared' });
      const readOnly = await listNotes(client, { query: word, readOnly: true });
      fixture.search = { found: found.items.length, mine: mine.items.length, shared: shared.items.length, readOnly: readOnly.items.length };
      if (!found.items.some((note) => note.id === noteId()) || !mine.items.some((note) => note.id === noteId())) throw new Error('the search didn’t find it');
      if (shared.items.length || readOnly.items.some((note) => note.id === noteId())) throw new Error('your own note was listed as shared or read-only');
      if (!found.items[0]?.preview.startsWith('APP PROBE')) throw new Error('the list didn’t carry the start of its text');
      return 'found by the word, under Yours; not under Shared with you or Read only';
    });

    await check('a save reaches a socket that follows the note, with the save’s time', async () => {
      await socket.joined;
      const changes: NoteChange[] = [];
      const stop = socket.watchNote(noteId(), (raw) => {
        const change = noteChangeOf(raw);
        if (change) changes.push(change);
      });
      // The server takes the room join a moment after it's asked.
      await new Promise((resolve) => setTimeout(resolve, 800));
      const text = `${firstText}\n\nchanged ${word}`;
      const saved = await saveNoteNow(client, noteId(), { md: text, html: noteHtml(text) });
      for (let waited = 0; waited < 4000 && !changes.length; waited += 200) await new Promise((resolve) => setTimeout(resolve, 200));
      stop();
      const change = changes[0];
      fixture.event = change ? { md: change.md === text, sameTime: change.updatedAt === saved.updatedAt } : null;
      if (!change) throw new Error('no note event came');
      if (change.md !== text) throw new Error('the event didn’t carry the new text');
      if (change.updatedAt !== saved.updatedAt) throw new Error('the event’s time differs from the save’s (the app tells its own saves by it)');
      if ((await getNote(client, noteId())).md !== text) throw new Error('the text didn’t save');
      return 'the event came with the new text and the save’s own time';
    });

    await check('renamed by its owner; an empty title saved as “Untitled”', async () => {
      await saveNoteNow(client, noteId(), { title: `APP PROBE ${word} renamed` });
      if ((await getNote(client, noteId())).title !== `APP PROBE ${word} renamed`) throw new Error('the rename didn’t take');
      await saveNoteNow(client, noteId(), { title: '  ' });
      const untitled = (await getNote(client, noteId())).title;
      await saveNoteNow(client, noteId(), { title: `APP PROBE ${word}` });
      if (untitled !== 'Untitled') throw new Error(`an empty title saved as "${untitled}"`);
      return 'renamed; empty became “Untitled”; named back';
    });

    await check('pinned to the sidebar, and unpinned', async () => {
      const pinned = await toggleNotePinned(client, noteId());
      const listed = (await listPinnedNotes(client)).some((note) => note.id === noteId());
      const unpinned = await toggleNotePinned(client, noteId());
      const after = (await listPinnedNotes(client)).some((note) => note.id === noteId());
      if (!pinned.pinned || !listed || unpinned.pinned || after) throw new Error(`pinned ${pinned.pinned}/${listed}, unpinned ${!unpinned.pinned}/${!after}`);
      return 'pinned (in the pinned list), unpinned (gone from it)';
    });

    await check('sharing kept through saves; a save without it un-shares the note', async () => {
      const rights = accessRights(capabilities, 'notes');
      const grant: AccessGrant = rights.everyone ? { principal_type: 'user', principal_id: '*', permission: 'read' } : { principal_type: 'user', principal_id: input.userId, permission: 'read' };
      let kept: AccessGrant[];
      try {
        kept = await updateAccess(client, 'notes', noteId(), [grant]);
      } catch (error) {
        // 0.12 refuses sharing this account may not give (0.11 drops it quietly).
        if (error instanceof OwuiHttpError && error.status === 403) return 'skipped: this account may not share notes (refused, as 0.12 does)';
        throw error;
      }
      fixture.sharing = { everyone: rights.everyone, people: rights.people, dropped: droppedGrants([grant], kept).length };
      if (!kept.length) return `skipped: this account may not share notes (everyone ${rights.everyone}, people ${rights.people})`;
      if (!saveKeepsSharing(kept, capabilities)) throw new Error('the app would think a save loses sharing the server just kept');
      await saveNoteNow(client, noteId(), { md: 'APP PROBE kept shared' });
      const afterSave = await getNote(client, noteId());
      if (!afterSave.accessGrants.length) throw new Error('a save took the sharing away');
      // The trap the app avoids: a save that leaves out the sharing.
      await client.post(`/api/v1/notes/${noteId()}/update`, { title: afterSave.title });
      const trapped = await getNote(client, noteId());
      fixture.saveWithoutSharing = trapped.accessGrants.length ? 'kept' : 'un-shared';
      await updateAccess(client, 'notes', noteId(), []);
      return `kept through the app’s save; a save without it ${trapped.accessGrants.length ? 'kept it' : 'un-shared the note'} (the app always sends it); private again`;
    });

    await check(pagesOn ? 'a file attached in the text (0.12), and a picture shown in it' : 'a file attached to the note’s list (0.11), the text left alone', async () => {
      const name = `app-probe-${word}.txt`;
      const form = new FormData();
      form.append('file', new Blob([`APP PROBE file ${word}`], { type: 'text/plain' }), name);
      const upload = await uploadFile(client, form, { process: true });
      files.push(upload.id);
      const entry = { ...fileItemFromUpload(upload, { name, itemId: uuidv4() }), id: upload.id };
      const before = await getNote(client, noteId());
      if (pagesOn) {
        const text = `${before.md}\n\n${attachmentLink(entry)}\n\n${pictureLink(entry)}`;
        await saveNoteNow(client, noteId(), { md: text, html: noteHtml(text), pageId: 'main' });
        const back = await getNote(client, noteId());
        fixture.attached = { version: '0.12', inText: attachmentsIn(back.md).length, block: back.html.includes(`data-file-id="${upload.id}"`), picture: back.html.includes(`<img src="/api/v1/files/${upload.id}/content"`) };
        if (!attachmentsIn(back.md).some((file) => file.id === upload.id)) throw new Error('the attachment link didn’t read back');
        let refused = false;
        try {
          await saveNote(client, back, { files: [entry] });
        } catch (error) {
          if (!(error instanceof OwuiHttpError) || error.status !== 400) throw error;
          refused = true;
        }
        if (!refused) throw new Error('0.12 took a file list (the app never sends one there)');
        const without = withoutAttachment(text, upload.id);
        await saveNoteNow(client, noteId(), { md: without, html: noteHtml(without), pageId: 'main' });
        if (attachmentsIn((await getNote(client, noteId())).md).length) throw new Error('the attachment didn’t come off');
        return 'in the text as an attachment (the HTML’s attachment block) and a picture; a file list refused (400), as expected; taken out again';
      }
      await saveNoteNow(client, noteId(), { files: (current) => withNoteFile(current, entry) });
      const back = await getNote(client, noteId());
      fixture.attached = { version: '0.11', listed: back.files.length, textKept: back.md === before.md };
      if (!back.files.some((file) => file.id === upload.id && file.name === name)) throw new Error('the file wasn’t listed on the note');
      if (back.md !== before.md) throw new Error('saving the file list changed the text');
      await saveNoteNow(client, noteId(), { files: (current) => withoutNoteFile(current, upload.id) });
      if ((await getNote(client, noteId())).files.length) throw new Error('the file didn’t come off');
      return 'listed on the note with its name (the text untouched), then taken off';
    });

    await check('the note’s chats: made once, a second, listed, opened as a chat, kept out of the chat list', async () => {
      const made = await getNoteChat(client, noteId());
      chats.push(made.id);
      const again = await getNoteChat(client, noteId());
      const second = await newNoteChat(client, noteId());
      chats.push(second.id);
      const listed = await listNoteChats(client, noteId());
      const opened = await getChat(client, made.id);
      const chatList = await listChats(client, 1);
      const system = String((made.chat?.params as { system?: unknown } | undefined)?.system ?? '');
      fixture.noteChats = { listed: listed.length, sameAgain: again.id === made.id, namesNote: system.includes(noteId()), inChatList: chatList.filter((chat) => chats.includes(chat.id)).length };
      if (again.id !== made.id) throw new Error('asking again made another chat');
      if (!listed.some((chat) => chat.id === made.id) || !listed.some((chat) => chat.id === second.id)) throw new Error('the note’s chats weren’t both listed');
      if (opened.id !== made.id) throw new Error('the chat didn’t open as a chat');
      if (!system.includes(noteId())) throw new Error('the chat’s instructions don’t name the note');
      if (chatList.some((chat) => chats.includes(chat.id))) throw new Error('a note’s chat showed in the chat list');
      return 'one made, the same one given again, a second made, both listed; it opens as a chat naming the note, and neither is in the chat list';
    });

    if (pagesOn) {
      await check('0.12 pages: added, written one at a time, refused when stale, renamed, nested, moved, deleted', async () => {
        const start = await getNote(client, noteId());
        const mainText = start.pages.find((page) => page.id === 'main')?.md ?? start.md;
        const made = await changeNotePages(client, start, { action: 'create', title: newPageTitle(start.pages), parentId: null });
        const pageId = made.pageId ?? '';
        const text = `second page ${word}`;
        await saveNoteNow(client, noteId(), { md: text, html: noteHtml(text), pageId });
        let note = await getNote(client, noteId());
        if (note.pages.find((page) => page.id === pageId)?.md !== text) throw new Error('the page’s text didn’t save');
        if (note.pages.find((page) => page.id === 'main')?.md !== mainText) throw new Error('the first page’s text changed');
        let unnamed = false;
        try {
          await saveNoteNow(client, noteId(), { md: 'x', html: '<p>x</p>' });
        } catch (error) {
          if (!(error instanceof OwuiHttpError) || error.status !== 409) throw error;
          unnamed = true;
        }
        if (!unnamed) throw new Error('a save naming no page went through with two pages (the app always names one)');
        let stale = false;
        try {
          await changeNotePages(client, { ...note, pagesRevision: note.pagesRevision - 1 }, { action: 'rename', pageId, title: 'stale' });
        } catch (error) {
          if (!(error instanceof OwuiHttpError) || error.status !== 409) throw error;
          stale = true;
        }
        if (!stale) throw new Error('a change from stale pages went through');
        note = (await changeNotePages(client, note, { action: 'rename', pageId, title: 'APP PROBE page' })).note;
        const sub = await changeNotePages(client, note, { action: 'create', title: 'Sub', parentId: pageId });
        if (sub.note.pages.find((page) => page.id === sub.pageId)?.depth !== 1) throw new Error('the subpage wasn’t nested');
        const moved = await changeNotePages(client, sub.note, { action: 'move', pageId: sub.pageId ?? '', parentId: null, beforeId: null });
        if (moved.note.pages.find((page) => page.id === sub.pageId)?.depth !== 0) throw new Error('the subpage didn’t move up');
        const gone = await changeNotePages(client, moved.note, { action: 'delete', pageId });
        fixture.pages = { made: 2, left: gone.note.pages.length, renamed: note.pages.some((page) => page.title === 'APP PROBE page') };
        if (gone.note.pages.some((page) => page.id === pageId)) throw new Error('the page wasn’t deleted');
        return 'a page made and written alone (the first kept its text); a save naming no page refused (409); a stale change refused (409); renamed, a subpage nested and moved up, the page deleted';
      });
    }
  } finally {
    socket.close();
    if (id) await deleteNote(client, id).catch(() => undefined);
    for (const chat of chats) await deleteChat(client, chat).catch(() => undefined);
    for (const file of files) await deleteFile(client, file).catch(() => undefined);
  }

  await check('the probe note is gone', async () => {
    if (!id) return 'none was made';
    try {
      await getNote(client, id);
    } catch (error) {
      if (error instanceof OwuiHttpError) return `reading it gives ${error.status}`;
      throw error;
    }
    throw new Error('the probe note is still there');
  });
  return { steps, fixture };
}
