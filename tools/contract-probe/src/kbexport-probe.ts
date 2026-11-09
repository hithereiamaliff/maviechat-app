import { inflateRawSync } from 'node:zlib';
import {
  addUser,
  createWorkspaceKnowledge,
  deleteFile,
  deleteUser,
  deleteWorkspaceKnowledge,
  exportWorkspaceKnowledge,
  getFileText,
  knowledgeUploadMetadata,
  listKnowledgeFiles,
  OwuiHttpError,
  signIn,
  uploadFile,
  zipEntryCount,
  type Capabilities,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A ZIP's files, names and text (stored or deflated), read from its central directory. */
function unzip(bytes: Uint8Array): { name: string; text: string }[] {
  const zip = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = zip.length - 22; at >= 0; at -= 1) {
    if (zip.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('not a ZIP');
  const files: { name: string; text: string }[] = [];
  let at = zip.readUInt32LE(end + 16);
  for (let n = zip.readUInt16LE(end + 10); n > 0; n -= 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('a broken ZIP directory');
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    files.push({ name: zip.subarray(at + 46, at + 46 + nameLength).toString('utf8'), text: (method === 8 ? inflateRawSync(data) : data).toString('utf8') });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return files;
}

/**
 * Knowledge export, the app's way (admins, scratch servers only: it makes collections, files and
 * an account). A throwaway collection with two text files (one not named .txt) exports as a ZIP
 * with each file's text, named as the server names them; an empty one exports with no files (the
 * app then says there's nothing yet); a user who isn't an admin is refused, and so is a collection
 * that isn't there. Everything made is deleted. Only names, counts and statuses are printed.
 */
export async function probeKnowledgeExport({ client, anonymous, capabilities, baseUrl }: { client: OwuiClient; anonymous: OwuiClient; capabilities: Capabilities; baseUrl: string }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  if (!capabilities.isAdmin || !/^http:\/\/127\.0\.0\.1:(3013|3014)\/?$/.test(baseUrl)) {
    steps.push({ name: 'knowledge export', ok: true, note: 'skipped: admins on the scratch servers only' });
    return { steps, fixture };
  }
  const stamp = Date.now().toString(36);
  const collections: string[] = [];
  const fileIds: string[] = [];
  let userId = '';
  const statusOf = (run: () => Promise<unknown>) =>
    run().then(
      () => 200,
      (error: unknown) => {
        if (error instanceof OwuiHttpError) return error.status;
        throw error;
      },
    );

  try {
    const full = (await createWorkspaceKnowledge(client, { name: `APP PROBE export ${stamp}`, description: 'APP PROBE' })).id;
    collections.push(full);
    const texts = [
      { name: `app-probe-${stamp}-a.txt`, text: `APP PROBE export text about tides ${stamp}.` },
      { name: `app-probe-${stamp}-b.md`, text: `# APP PROBE\n\nExport notes about volcanoes ${stamp}.` },
    ];

    await check('two files read into a collection', async () => {
      for (const item of texts) {
        const form = new FormData();
        form.append('file', new Blob([item.text], { type: 'text/plain' }), item.name);
        form.append('metadata', knowledgeUploadMetadata(full, null));
        fileIds.push((await uploadFile(client, form, { process: true })).id);
      }
      const started = Date.now();
      for (;;) {
        const page = await listKnowledgeFiles(client, full, {});
        if (fileIds.every((id) => page.files.some((file) => file.id === id))) break;
        for (const id of fileIds) if ((await getFileText(client, id)).status === 'failed') throw new Error('the server couldn’t read one');
        if (Date.now() - started > 180_000) throw new Error('not both linked after 3 minutes');
        await sleep(2000);
      }
      return `both linked after ${Math.round((Date.now() - started) / 1000)} s`;
    });

    await check('the export: a ZIP with each file’s text, named as the server names them', async () => {
      const bytes = await exportWorkspaceKnowledge(client, full);
      const count = zipEntryCount(bytes);
      const files = unzip(bytes);
      fixture.entries = files.length;
      if (count !== texts.length || files.length !== texts.length) throw new Error(`${String(count)} files counted, ${files.length} read`);
      for (const item of texts) {
        const name = item.name.endsWith('.txt') ? item.name : `${item.name}.txt`;
        const found = files.find((file) => file.name === name);
        if (!found) throw new Error(`no ${name.endsWith('.md.txt') ? '.md.txt' : '.txt'} file for one`);
        if (!found.text.includes(stamp)) throw new Error('a file’s text isn’t what was read');
      }
      return `${bytes.length} bytes; ${files.length} files (a .txt kept, a .md as .md.txt), each with its text`;
    });

    await check('an empty collection exports with no files (the app says there’s nothing yet)', async () => {
      const empty = (await createWorkspaceKnowledge(client, { name: `APP PROBE export empty ${stamp}`, description: 'APP PROBE' })).id;
      collections.push(empty);
      const count = zipEntryCount(await exportWorkspaceKnowledge(client, empty));
      if (count !== 0) throw new Error(`${String(count)} files`);
      return 'a ZIP with 0 files';
    });

    await check('refused for a user who isn’t an admin, and for a collection that isn’t there', async () => {
      const email = `app-probe-export-${stamp}@maviechat.invalid`;
      const password = `Probe-${stamp}-${Math.random().toString(36).slice(2, 10)}`;
      userId = (await addUser(client, { name: 'APP PROBE export', email, password, role: 'user' })).id;
      const signedIn = await signIn(anonymous, email, password);
      if (signedIn.kind !== 'session') throw new Error(`the user’s sign-in answered ${signedIn.kind}`);
      const asUser = await statusOf(() => exportWorkspaceKnowledge(anonymous.withToken(signedIn.session.token), full));
      const missing = await statusOf(() => exportWorkspaceKnowledge(client, `app-probe-missing-${stamp}`));
      fixture.refused = { asUser, missing };
      if (asUser === 200) throw new Error('a user exported it');
      if (missing === 200) throw new Error('a missing collection exported');
      return `a user: ${asUser}; a missing collection: ${missing}`;
    });
  } finally {
    await check('cleaned up', async () => {
      for (const id of collections) await deleteWorkspaceKnowledge(client, id);
      for (const id of fileIds) await deleteFile(client, id).catch(() => undefined);
      if (userId) await deleteUser(client, userId);
      return `${collections.length} collections, ${fileIds.length} files${userId ? ', 1 user' : ''} deleted`;
    });
  }
  return { steps, fixture };
}
