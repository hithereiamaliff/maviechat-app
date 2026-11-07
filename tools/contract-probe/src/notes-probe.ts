import { noteHtml } from '@maviechat/owui-markdown';
import {
  accessRights,
  createNote,
  deleteNote,
  droppedGrants,
  getNote,
  listNotes,
  listPinnedNotes,
  noteChangeOf,
  openSocketSession,
  OwuiHttpError,
  saveKeepsSharing,
  saveNoteNow,
  toggleNotePinned,
  updateAccess,
  uuidv4,
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
}

/**
 * The native Notes slice, as the test account, on its own probe note only (deleted afterwards):
 * made with Markdown and the HTML the web's editor loads, found by search and by whose, saved
 * (the web's note event arriving on a socket that follows it, carrying the save's time), renamed,
 * pinned and unpinned, shared and kept shared through a save (and the trap a save without its
 * sharing would spring, shown on the probe note), and deleted.
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
  if (!capabilities.feature('notes', true)) {
    steps.push({ name: 'notes', ok: true, note: 'skipped: notes are off for this account' });
    return { steps, fixture };
  }

  const word = `mcprobe${uuidv4().replace(/-/g, '').slice(0, 8)}`;
  const firstText = `APP PROBE ${word}\nsecond line\n\n- [ ] milk\n- [x] eggs`;
  let id: string | null = null;
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
  } finally {
    socket.close();
    if (id) await deleteNote(client, id).catch(() => undefined);
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
