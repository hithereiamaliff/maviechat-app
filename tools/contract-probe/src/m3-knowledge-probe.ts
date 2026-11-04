import {
  addFileToKnowledge,
  createKnowledgeFolder,
  createWorkspaceKnowledge,
  deleteFile,
  deleteKnowledgeFolder,
  deleteWorkspaceKnowledge,
  fetchUrl,
  getFileText,
  getWorkspaceKnowledge,
  knowledgeUploadMetadata,
  listKnowledgeFiles,
  listWorkspaceKnowledge,
  moveKnowledgeFile,
  OwuiHttpError,
  pendingKnowledgeFiles,
  removeKnowledgeFile,
  renameFile,
  resetWorkspaceKnowledge,
  updateFileText,
  updateKnowledgeFolder,
  updateWorkspaceKnowledge,
  uploadFile,
  urlFileName,
  type Capabilities,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
    return 200;
  } catch (error) {
    if (error instanceof OwuiHttpError) return error.status;
    throw error;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * M3.5: knowledge. Where the account may make collections (an admin on the scratch instance): a
 * probe collection renamed (sharing kept), folders made, renamed, moved and a name clash; a text
 * file uploaded into a folder and followed until the server has read it, its text read, changed
 * and renamed, moved to the top; a web page fetched by the server and added as text; a file
 * taken out without deleting it; a folder deleted with its files moved up; the collection
 * emptied, then deleted, and the probe's files with it. Where it may not (the test account on
 * production), the list reads, a readable collection's files read, and making one is refused.
 */
export async function probeM3Knowledge({ client, capabilities }: { client: OwuiClient; capabilities: Capabilities }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const step = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
      return true;
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };
  const stamp = Date.now().toString(36);
  const canCreate = capabilities.isAdmin || capabilities.can('workspace.knowledge');

  await step('knowledge: the list reads', async () => {
    const all = await listWorkspaceKnowledge(client, {});
    const local = await listWorkspaceKnowledge(client, { source: 'local' });
    fixture.counts = { all: all.total, local: local.total };
    const first = all.items.find((item) => !item.external);
    if (first) {
      const page = await listKnowledgeFiles(client, first.id, {});
      fixture.firstFolder = { files: page.total, folders: page.folders.length };
      return `${all.total} readable (${local.total} local); the first has ${page.total} files and ${page.folders.length} folders at the top`;
    }
    return `${all.total} readable (${local.total} local)`;
  });

  if (!canCreate) {
    await step('knowledge: making one refused without the permission', async () => {
      const status = await statusOf(() => createWorkspaceKnowledge(client, { name: `APP PROBE ${stamp}`, description: 'APP PROBE' }));
      if (status === 200) throw new Error('a collection was made without workspace.knowledge');
      return `refused (${status})`;
    });
    return { steps, fixture };
  }

  let kbId = '';
  const fileIds: string[] = [];
  try {
    let folderA = '';
    await step('knowledge: made, renamed with its sharing kept, folders made, renamed, moved, a clash', async () => {
      const made = await createWorkspaceKnowledge(client, { name: `APP PROBE kb ${stamp}`, description: 'APP PROBE' });
      kbId = made.id;
      const renamed = await updateWorkspaceKnowledge(client, kbId, { name: `APP PROBE kb ${stamp} renamed`, description: 'APP PROBE, changed' });
      if (renamed.name !== `APP PROBE kb ${stamp} renamed`) throw new Error('the new name didn’t take');
      if ((await getWorkspaceKnowledge(client, kbId)).accessGrants.length) throw new Error('a rename shared it');
      folderA = (await createKnowledgeFolder(client, kbId, 'A', null)).id;
      const folderB = (await createKnowledgeFolder(client, kbId, 'B', folderA)).id;
      await updateKnowledgeFolder(client, kbId, folderB, { name: 'B renamed' });
      const inside = await listKnowledgeFiles(client, kbId, { folderId: folderA });
      if (!inside.folders.some((folder) => folder.name === 'B renamed') || inside.path.map((folder) => folder.id).join() !== folderA) throw new Error('A didn’t show B renamed, or the way down was wrong');
      await updateKnowledgeFolder(client, kbId, folderB, { parentId: null });
      const top = await listKnowledgeFiles(client, kbId, {});
      if (!top.folders.some((folder) => folder.id === folderB)) throw new Error('B didn’t move to the top');
      // Inside a folder a name is taken once; 0.11.3's rule doesn't reach the top level (no parent there).
      const inner = (await createKnowledgeFolder(client, kbId, 'C', folderA)).id;
      const clash = await statusOf(() => createKnowledgeFolder(client, kbId, 'C', folderA));
      fixture.folderClash = clash;
      if (clash === 200) throw new Error('a second C was allowed inside A');
      const topTwin = await statusOf(async () => {
        const twin = await createKnowledgeFolder(client, kbId, 'A', null);
        await deleteKnowledgeFolder(client, kbId, twin.id, { moveFiles: true });
      });
      fixture.topLevelTwinAllowed = topTwin === 200;
      await deleteKnowledgeFolder(client, kbId, inner, { moveFiles: true });
      const loop = await statusOf(() => updateKnowledgeFolder(client, kbId, folderA, { parentId: folderA }));
      fixture.folderIntoItself = loop;
      if (loop === 200) throw new Error('A was moved into itself');
      return `renamed (still private); A › B made, renamed, moved to the top; a second C inside A refused (${clash}); a second A at the top ${topTwin === 200 ? 'allowed (0.11.3)' : `refused (${topTwin})`}; A into itself refused (${loop})`;
    });

    let fileId = '';
    const uploaded = await step('knowledge: a text file uploaded into a folder is read and linked', async () => {
      if (!folderA) throw new Error('no folder to upload into');
      const form = new FormData();
      form.append('file', new Blob(['APP PROBE knowledge text about photosynthesis.'], { type: 'text/plain' }), `app-probe-${stamp}.txt`);
      form.append('metadata', knowledgeUploadMetadata(kbId, folderA));
      const file = await uploadFile(client, form, { process: true });
      fileId = file.id;
      fileIds.push(fileId);
      const started = Date.now();
      let sawPending = false;
      for (;;) {
        const pending = await pendingKnowledgeFiles(client, kbId);
        if (pending.some((item) => item.id === fileId)) sawPending = true;
        const page = await listKnowledgeFiles(client, kbId, { folderId: folderA });
        if (page.files.some((item) => item.id === fileId)) break;
        const read = await getFileText(client, fileId);
        if (read.status === 'failed') throw new Error(`the server couldn’t read it: ${read.error || 'no reason given'}`);
        if (Date.now() - started > 180_000) throw new Error(`not linked after 3 minutes (status ${read.status || 'none'})`);
        await sleep(2000);
      }
      fixture.uploadSeconds = Math.round((Date.now() - started) / 1000);
      return `linked into A after ${fixture.uploadSeconds} s${sawPending ? ', listed as pending meanwhile' : ''}`;
    });

    if (uploaded && fileId) {
      await step('knowledge: the file’s text read, changed, renamed, moved to the top', async () => {
        const read = await getFileText(client, fileId);
        if (!read.content.includes('photosynthesis')) throw new Error('its text didn’t read back');
        await updateFileText(client, fileId, 'APP PROBE knowledge text, changed.');
        if (!(await getFileText(client, fileId)).content.includes('changed')) throw new Error('the new text didn’t take');
        await renameFile(client, fileId, `app-probe-${stamp}-renamed.txt`);
        await moveKnowledgeFile(client, kbId, fileId, null);
        const top = await listKnowledgeFiles(client, kbId, {});
        const moved = top.files.find((item) => item.id === fileId);
        if (!moved) throw new Error('it didn’t move to the top');
        fixture.renamedShows = moved.name;
        return `read; changed and read back; renamed (the list shows “${moved.name.includes('renamed') ? 'the new name' : 'the old name'}”); moved to the top`;
      });

      await step('knowledge: a file taken out without deleting it, then put back', async () => {
        await removeKnowledgeFile(client, kbId, fileId, { deleteFile: false });
        const top = await listKnowledgeFiles(client, kbId, {});
        if (top.files.some((item) => item.id === fileId)) throw new Error('still listed');
        if ((await getFileText(client, fileId)).id !== fileId) throw new Error('the file itself went');
        await addFileToKnowledge(client, kbId, fileId, folderA);
        const inA = await listKnowledgeFiles(client, kbId, { folderId: folderA });
        if (!inA.files.some((item) => item.id === fileId)) throw new Error('putting it back (into A) didn’t take');
        return 'out of the list, the file kept; back into A';
      });
    }

    await step('knowledge: a web page fetched by the server, added as text', async () => {
      const url = 'https://example.com/';
      let page;
      try {
        page = await fetchUrl(client, url);
      } catch (error) {
        fixture.webPage = 'unreachable';
        return `skipped: the server couldn’t fetch ${url} (${error instanceof Error ? error.message : String(error)})`;
      }
      if (page.kind !== 'page') throw new Error(`it came back as a ${page.kind}`);
      const form = new FormData();
      form.append('file', new Blob([page.content], { type: 'text/plain' }), urlFileName(url));
      form.append('metadata', knowledgeUploadMetadata(kbId, null, url));
      const file = await uploadFile(client, form, { process: true });
      fileIds.push(file.id);
      const started = Date.now();
      for (;;) {
        const top = await listKnowledgeFiles(client, kbId, {});
        if (top.files.some((item) => item.id === file.id)) break;
        const read = await getFileText(client, file.id);
        if (read.status === 'failed') throw new Error(`the server couldn’t read it: ${read.error || 'no reason given'}`);
        if (Date.now() - started > 120_000) throw new Error('not linked after 2 minutes');
        await sleep(2000);
      }
      fixture.webPage = 'added';
      return `“${page.name}” (${page.content.length} characters) added as ${urlFileName(url)}`;
    });

    await step('knowledge: a folder deleted with its files moved up, then the collection emptied', async () => {
      if (!folderA) throw new Error('no folder');
      await deleteKnowledgeFolder(client, kbId, folderA, { moveFiles: true });
      const top = await listKnowledgeFiles(client, kbId, {});
      if (top.folders.some((folder) => folder.id === folderA)) throw new Error('A is still there');
      if (fileId && uploaded && !top.files.some((item) => item.id === fileId)) throw new Error('A’s file didn’t move up');
      await resetWorkspaceKnowledge(client, kbId);
      const empty = await listKnowledgeFiles(client, kbId, {});
      if (empty.total || empty.folders.length) throw new Error(`${empty.total} files and ${empty.folders.length} folders left after emptying`);
      const kept = fileId ? await statusOf(() => getFileText(client, fileId)) : 0;
      fixture.resetDeletesOwnFiles = kept === 404;
      return `A gone, its file moved up; emptied (the probe’s own file ${kept === 404 ? 'deleted with it' : `kept (${kept})`})`;
    });
  } finally {
    if (kbId) await deleteWorkspaceKnowledge(client, kbId).catch(() => undefined);
    for (const id of fileIds) await deleteFile(client, id).catch(() => undefined);
  }
  await step('knowledge: deleting a collection keeps the files in it', async () => {
    // What the app's delete warning says: the collection goes, the files stay in their owner's files.
    let other = '';
    let kept = '';
    try {
      other = (await createWorkspaceKnowledge(client, { name: `APP PROBE kb ${stamp} delete`, description: 'APP PROBE' })).id;
      const form = new FormData();
      form.append('file', new Blob(['APP PROBE file that outlives its collection.'], { type: 'text/plain' }), `app-probe-${stamp}-kept.txt`);
      form.append('metadata', knowledgeUploadMetadata(other, null));
      kept = (await uploadFile(client, form, { process: true })).id;
      const started = Date.now();
      while (!(await listKnowledgeFiles(client, other, {})).files.some((item) => item.id === kept)) {
        if ((await getFileText(client, kept)).status === 'failed') throw new Error('the server couldn’t read it');
        if (Date.now() - started > 120_000) throw new Error('not linked after 2 minutes');
        await sleep(2000);
      }
      await deleteWorkspaceKnowledge(client, other);
      other = '';
      const status = await statusOf(() => getFileText(client, kept));
      fixture.deleteKeepsFiles = status === 200;
      if (status !== 200) throw new Error(`the file went with it (${status})`);
      return 'the collection deleted; its file still there (then deleted by the probe)';
    } finally {
      if (other) await deleteWorkspaceKnowledge(client, other).catch(() => undefined);
      if (kept) await deleteFile(client, kept).catch(() => undefined);
    }
  });

  if (kbId) {
    await step('knowledge: the probe collection is gone', async () => {
      const status = await statusOf(() => getWorkspaceKnowledge(client, kbId));
      if (status === 200) throw new Error('still there');
      return `reading it gives ${status}`;
    });
  }
  return { steps, fixture };
}
