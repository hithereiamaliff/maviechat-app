import {
  addMemoryFact,
  deleteMemoryFact,
  DtHttpError,
  editMemoryFact,
  getMemoryDoc,
  getMemoryOverview,
  getMemoryRun,
  getMemoryRunLimits,
  listModules,
  memoryRunActive,
  parseMemorySheet,
  resetMemoryDoc,
  resolveMemoryFact,
  startMemoryRun,
  undoMemoryRun,
  type DtClient,
  type DtMemoryRun,
} from '@maviechat/deeptutor-protocol';

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
    return 200;
  } catch (error) {
    if (error instanceof DtHttpError) return error.status;
    throw error;
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * B7.2 against a live DeepTutor, in the test account's own memory: the overview; every sheet read
 * and parsed (its fact count matching DeepTutor's); a bad and an unknown fact refused by the
 * resolver; the run sizes read (never written: they're shared by every account); a fact added to
 * the Co-Writer sheet with a made-up source, reworded with its source kept, deleted; a merge run
 * there (no model) followed to its end, then undone; the sheet emptied again if it was empty.
 */
export async function probeMemory(client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const fixture: Record<string, unknown> = {};
  const memory = (await listModules(client)).find((module) => module.id === 'memory');
  fixture.module = memory ? { enabled: memory.enabled, ready: memory.ready } : 'absent';
  if (!memory?.enabled) return { note: 'the memory module is off on this server', fixture };

  const overview = await getMemoryOverview(client);
  fixture.overview = { docs: overview.docs.map((doc) => `${doc.layer}/${doc.key}`), archived: overview.archived };
  if (overview.docs.length !== 11) throw new Error(`expected 7 + 4 sheets, got ${overview.docs.length}`);
  const sheets: Record<string, { entries: number; parsed: number }> = {};
  for (const doc of overview.docs) {
    const parsed = parseMemorySheet(await getMemoryDoc(client, doc.layer, doc.key));
    const facts = parsed.sections.reduce((sum, section) => sum + section.entries.filter((entry) => entry.id).length, 0);
    sheets[`${doc.layer}/${doc.key}`] = { entries: doc.entries, parsed: facts };
    if (doc.exists && facts !== doc.entries) throw new Error(`${doc.layer}/${doc.key}: DeepTutor counts ${doc.entries} facts, the parser found ${facts}`);
  }
  fixture.sheets = sheets;
  fixture.resolveBad = await statusOf(() => resolveMemoryFact(client, 'not-an-id'));
  fixture.resolveUnknown = await statusOf(() => resolveMemoryFact(client, 'm_01JC0000000000000000000000'));
  if (fixture.resolveBad !== 400 || fixture.resolveUnknown !== 404) throw new Error(`the resolver answered ${String(fixture.resolveBad)} and ${String(fixture.resolveUnknown)}, not 400 and 404`);
  fixture.limits = await getMemoryRunLimits(client);

  const stamp = Date.now().toString(36);
  const before = await getMemoryDoc(client, 'L2', 'cowriter');
  const source = `cowriter:mc-probe-${stamp}`;
  const id = await addMemoryFact(client, 'L2', 'cowriter', { section: 'APP PROBE', text: 'APP PROBE fact', refs: [source] });
  if (!id) throw new Error('adding a fact gave no id');
  try {
    let fact = parseMemorySheet(await getMemoryDoc(client, 'L2', 'cowriter')).sections.flatMap((section) => section.entries).find((entry) => entry.id === id);
    if (!fact || fact.text !== 'APP PROBE fact' || fact.refs.join() !== source) throw new Error('the added fact did not read back with its source');
    await editMemoryFact(client, 'L2', 'cowriter', fact, 'APP PROBE fact, reworded');
    fact = parseMemorySheet(await getMemoryDoc(client, 'L2', 'cowriter')).sections.flatMap((section) => section.entries).find((entry) => entry.id === id);
    if (!fact || fact.text !== 'APP PROBE fact, reworded' || fact.refs.join() !== source) throw new Error('the reworded fact lost its words or its source');
  } finally {
    await deleteMemoryFact(client, 'L2', 'cowriter', id).catch(() => undefined);
  }
  if ((await getMemoryDoc(client, 'L2', 'cowriter')).includes(id)) throw new Error('the probe fact was left behind');

  // A merge run tidies footnotes without the model.
  let run: DtMemoryRun = await startMemoryRun(client, { layer: 'L2', key: 'cowriter', mode: 'merge' });
  for (let tries = 0; memoryRunActive(run) && tries < 60; tries += 1) {
    await pause(1000);
    run = await getMemoryRun(client, run.id);
  }
  fixture.mergeRun = { status: run.status, events: run.events > 0 };
  if (run.status !== 'done') throw new Error(`the merge run ended "${run.status}" ${run.error}`);
  fixture.undo = await statusOf(() => undoMemoryRun(client, run.id));
  if (fixture.undo !== 200 && fixture.undo !== 409) throw new Error(`undoing the merge run gave ${String(fixture.undo)}`);

  if (!before) {
    await resetMemoryDoc(client, 'L2', 'cowriter');
    if (await getMemoryDoc(client, 'L2', 'cowriter')) throw new Error('resetting the sheet left text in it');
    fixture.reset = true;
  }
  return {
    note: `11 sheets read and parsed (counts match DeepTutor's); resolver refusals right; a fact added with a source, reworded keeping it, deleted; a merge run done (no model), undo ${fixture.undo === 200 ? 'applied' : 'had nothing to undo'}${before ? '' : '; the sheet emptied again'}`,
    fixture,
  };
}
