import {
  addPartnerAssets,
  archivePartnerSession,
  branchPartnerSession,
  createLinkCode,
  createNotebook,
  createPartner,
  deleteNotebook,
  DtHttpError,
  getPartnerAssets,
  getPartnerSoul,
  getPartnerToolOptions,
  listPartnerCommands,
  listPartnerLinks,
  listPartnerWorkspaces,
  removePartnerAsset,
  removePartnerLink,
  savePartnerSoul,
  updatePartner,
  currentWebSession,
  deletePartner,
  deletePartnerSession,
  DtPartnerChat,
  getLlmOptions,
  getPartner,
  listPartnerGroups,
  listPartners,
  listPartnerSessions,
  listSkillNames,
  listSouls,
  newPartnerSessionKey,
  PARTNER_COLORS,
  partnerHistoryPage,
  partnerSocketUrl,
  recentPartnerConversations,
  recordReply,
  resumePartnerSession,
  socketCookieHeader,
  stopPartner,
  type DtClient,
  type DtPartnerChatState,
  type DtPartnerTurn,
  type DtSocketFactory,
} from '@maviechat/deeptutor-protocol';
import { shapeOf } from './shape';

const NodeWebSocket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;

/** The app's sockets, in Node: the sign-in rides in the Cookie header, never the address. */
function nodeSockets(token: string): DtSocketFactory {
  return (url, handlers) => {
    const socket = new NodeWebSocket(url, { headers: { Cookie: socketCookieHeader(token) } });
    socket.onopen = () => handlers.onOpen();
    socket.onmessage = (event) => handlers.onMessage(event.data);
    socket.onclose = (event) => handlers.onClose(event.code);
    return { send: (data) => socket.send(data), close: () => socket.close() };
  };
}

/** A partner chat that reports to promises: ready, and each reply's end. */
function chatHarness(baseUrl: string, token: string, partnerId: string) {
  let state: DtPartnerChatState = 'closed';
  let live: DtPartnerTurn | null = null;
  let sawStream = 0;
  const waiters: { test: () => boolean; resolve: () => void }[] = [];
  const ended: DtPartnerTurn[] = [];
  const refused: string[] = [];
  const check = () => {
    for (const waiter of [...waiters]) {
      if (waiter.test()) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  };
  const chat = new DtPartnerChat({
    url: partnerSocketUrl(baseUrl, partnerId),
    connect: nodeSockets(token),
    onState: (next) => {
      state = next;
      check();
    },
    onTurn: (turn) => {
      if (turn && live && turn.reply.answer !== live.reply.answer) sawStream += 1;
      live = turn;
      check();
    },
    onEnd: (turn) => {
      ended.push(turn);
      check();
    },
    onRefused: (_prompt, reason, message) => {
      refused.push(`${reason}: ${message}`);
      check();
    },
  });
  const until = (what: string, test: () => boolean, ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (test()) return resolve();
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what} (state ${state}${refused.length ? `; refused ${refused.join(', ')}` : ''})`)), ms);
      waiters.push({ test, resolve: () => (clearTimeout(timer), resolve()) });
    });
  return {
    chat,
    ended,
    refused,
    get state() {
      return state;
    },
    get live() {
      return live;
    },
    get streamed() {
      return sawStream;
    },
    ready: (ms = 90_000) => until('ready', () => state === 'ready', ms),
    nextEnd: (count: number, ms = 180_000) => until(`reply ${count}`, () => ended.length >= count || refused.length > 0, ms),
    streaming: (ms = 120_000) => until('the reply to stream', () => Boolean(live && live.accepted && live.reply.answer.length > 0), ms),
  };
}

/**
 * B6.1 against a live DeepTutor, in the test account: a partner made as the app makes one (a
 * library soul, the default model, every skill), then a conversation over `/ws/partners/{id}`
 * (the sign-in in the Cookie header): a reply streamed and read back from history the same; a
 * second reply followed again after the socket was dropped mid-way; the conversation listed,
 * archived, brought back and deleted; the partner stopped and deleted. No chat-app channels, so
 * nothing outside DeepTutor is contacted. Uses the account's model for two short replies.
 */
export async function probePartners(baseUrl: string, token: string, client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const fixture: Record<string, unknown> = {};
  const own = await listPartners(client);
  const groups = await listPartnerGroups(client);
  const recent = await recentPartnerConversations(client);
  const souls = await listSouls(client);
  const models = await getLlmOptions(client);
  const skills = await listSkillNames(client);
  fixture.before = { partners: own.length, groups: groups.length, recent: recent.length, souls: souls.map((soul) => soul.id), models: models.options.length, skills: skills.length };
  const soul = souls.find((item) => item.id === 'companion') ?? souls[0];
  if (!soul) throw new Error('the soul library is empty');

  const name = `APP PROBE partner ${Date.now().toString(36)}`;
  let partnerId = '';
  let harness: ReturnType<typeof chatHarness> | null = null;
  try {
    const made = await createPartner(client, { name, description: 'Made by the app’s probe; deleted at the end.', emoji: '🦉', color: PARTNER_COLORS[3], language: 'en', soul: { source: 'library', id: soul.id }, skills });
    partnerId = made.partner.id;
    if (!partnerId) throw new Error('no partner id came back');
    if (made.startError) throw new Error(`created, but: ${made.startError}`);
    const detail = await getPartner(client, partnerId);
    fixture.partner = { shape: shapeOf(detail) };
    if (!detail.canManage || detail.channels.length || detail.name !== name || detail.emoji !== '🦉') throw new Error('the new partner reads back different');

    // A reply, streamed, then read back from history the same.
    const key = newPartnerSessionKey();
    harness = chatHarness(baseUrl, token, partnerId);
    harness.chat.open(key);
    await harness.ready();
    if (!harness.chat.send('APP PROBE: reply with just the word tangerine, nothing else.')) throw new Error('the message could not be sent');
    await harness.nextEnd(1);
    if (harness.refused.length) throw new Error(`refused: ${harness.refused.join('; ')}`);
    const first = harness.ended[0] as DtPartnerTurn;
    if (!first.accepted || first.reply.status !== 'completed' || !/tangerine/i.test(first.reply.answer)) throw new Error(`the reply was ${first.reply.status}: ${first.reply.answer.slice(0, 80) || first.reply.error || '(empty)'}`);
    let page = await partnerHistoryPage(client, partnerId, key);
    const saved = page.records.filter((record) => record.role === 'assistant').at(-1);
    fixture.history = { total: page.total, shape: page.records[1] ? shapeOf({ ...page.records[1], events: page.records[1].events.slice(0, 1) }) : null };
    if (page.records.length !== 2 || !saved) throw new Error(`history has ${page.records.length} messages`);
    if (recordReply(saved).answer.trim() !== first.reply.answer.trim()) throw new Error('the saved reply differs from the streamed one');

    // A longer reply, the socket dropped mid-way, then followed again to its end.
    if (!harness.chat.send('APP PROBE: count from 1 to 30, one number per line, then write DONE.')) throw new Error('the second message could not be sent');
    await harness.streaming();
    harness.chat.reconnect();
    await harness.ready();
    await harness.nextEnd(2);
    const second = harness.ended[1] as DtPartnerTurn;
    page = await partnerHistoryPage(client, partnerId, key);
    const latest = page.records.filter((record) => record.role === 'assistant').at(-1);
    if (second.reply.status !== 'completed' || !latest || latest.content.trim() !== second.reply.answer.trim()) throw new Error(`after reconnecting, the reply was ${second.reply.status} and ${latest?.content.trim() === second.reply.answer.trim() ? 'matched' : 'did not match'} history`);
    if (!/DONE/.test(second.reply.answer)) throw new Error('the followed reply is missing its end');
    harness.chat.close();
    harness = null;

    // The conversation: listed, archived, brought back, deleted.
    let sessions = await listPartnerSessions(client, partnerId);
    fixture.sessions = { shape: sessions[0] ? shapeOf(sessions[0]) : null };
    if (currentWebSession(sessions)?.key !== key) throw new Error('the conversation is not the one to carry on');
    await archivePartnerSession(client, partnerId, key);
    sessions = await listPartnerSessions(client, partnerId);
    if (!sessions.find((session) => session.key === key)?.archived || currentWebSession(sessions)) throw new Error('archiving did not take');
    await resumePartnerSession(client, partnerId, key);
    if ((await listPartnerSessions(client, partnerId)).find((session) => session.key === key)?.archived !== false) throw new Error('bringing it back did not take');
    const navigation = await recentPartnerConversations(client);
    if (!navigation.some((row) => row.kind === 'partner' && row.ownerId === partnerId && row.sessionKey === key)) throw new Error('the sidebar does not list the conversation');
    await deletePartnerSession(client, partnerId, key);
    if ((await listPartnerSessions(client, partnerId)).some((session) => session.key === key)) throw new Error('the conversation is still listed after deleting');

    const setup = await probePartnerSetup(baseUrl, token, client, partnerId, models.options);
    fixture.setup = setup.fixture;

    await stopPartner(client, partnerId);
    if ((await getPartner(client, partnerId)).running) throw new Error('still running after stop');
    return {
      note: `a partner made from the "${soul.id}" soul; a reply streamed and read back the same; a second followed again after a dropped socket; the conversation listed, archived, brought back and deleted; ${setup.note}; the partner stopped (${own.length} partners and ${groups.length} groups of the account's own left alone)`,
      fixture,
    };
  } finally {
    harness?.chat.close();
    if (partnerId) await deletePartner(client, partnerId).catch(() => undefined);
  }
}

/** A 1×1 PNG, as the picture set for a moment. */
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const statusOf = (error: unknown) => (error instanceof DtHttpError ? error.status : undefined);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * B6.2 on the probe's own partner: its settings changed and read back (identity and picture, soul,
 * model and backup, tools), its library (a skill out and back, a notebook in and out), a link code
 * (redeeming one needs a chat app, so only the code and the empty list), the slash commands, a file
 * sent with a message and read by the partner, a command DeepTutor answers itself, and a branched
 * conversation. Uses the account's model for one reply.
 */
async function probePartnerSetup(baseUrl: string, token: string, client: DtClient, partnerId: string, models: { profile_id: string; model_id: string }[]): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const fixture: Record<string, unknown> = {};

  // Identity and picture.
  let partner = await updatePartner(client, partnerId, { description: 'Renamed by the probe', emoji: '🧠', color: PARTNER_COLORS[0], language: 'ms', avatar: TINY_PNG });
  partner = await getPartner(client, partnerId);
  if (partner.emoji !== '🧠' || partner.color !== PARTNER_COLORS[0] || partner.language !== 'ms' || partner.avatar !== TINY_PNG || partner.description !== 'Renamed by the probe') throw new Error('the identity did not read back');
  await updatePartner(client, partnerId, { avatar: '' });
  if ((await getPartner(client, partnerId)).avatar) throw new Error('the picture was not removed');
  try {
    await updatePartner(client, partnerId, { avatar: 'https://example.com/a.png' });
    throw new Error('a picture that is not a data: image was taken');
  } catch (error) {
    if (statusOf(error) !== 422) throw error;
  }

  // Soul.
  const before = await getPartnerSoul(client, partnerId);
  if (!before.trim()) throw new Error('the soul is empty');
  await savePartnerSoul(client, partnerId, '# APP PROBE soul\nAnswer in one short sentence.');
  if ((await getPartnerSoul(client, partnerId)).trim() !== '# APP PROBE soul\nAnswer in one short sentence.') throw new Error('the soul did not save');

  // Model and backup (the account's own models), then DeepTutor's default again.
  const pick = (model: { profile_id: string; model_id: string } | undefined) => (model ? { profile_id: model.profile_id, model_id: model.model_id } : null);
  if (models[0]) {
    await updatePartner(client, partnerId, { llmSelection: pick(models[0]), backupLlmSelection: pick(models[1]) });
    partner = await getPartner(client, partnerId);
    if (!same(partner.llmSelection, { profile_id: models[0].profile_id, model_id: models[0].model_id })) throw new Error('the model did not read back');
    await updatePartner(client, partnerId, { llmSelection: null, backupLlmSelection: null });
    partner = await getPartner(client, partnerId);
    if (partner.llmSelection || partner.backupLlmSelection) throw new Error('back to the default model did not take');
  }

  // Tools: a short list, then all again.
  const options = await getPartnerToolOptions(client);
  fixture.tools = { tools: options.tools.length, builtin: options.builtin.length, mcp: options.mcp.length };
  const someTools = options.tools.slice(0, 2).map((tool) => tool.name);
  const someBuiltin = options.builtin.slice(0, 1).map((tool) => tool.name);
  await updatePartner(client, partnerId, { enabledTools: someTools, builtinTools: someBuiltin, mcpTools: [] });
  partner = await getPartner(client, partnerId);
  if (!same(partner.enabledTools, someTools) || !same(partner.builtinTools, someBuiltin) || !same(partner.mcpTools, [])) throw new Error('the tools did not read back');
  await updatePartner(client, partnerId, { enabledTools: null, builtinTools: null });
  partner = await getPartner(client, partnerId);
  if (partner.enabledTools !== null || partner.builtinTools !== null) throw new Error('all tools again did not take');

  // Library: a skill out and back in; a notebook in and out.
  const workspaces = await listPartnerWorkspaces(client, partnerId);
  let assets = await getPartnerAssets(client, partnerId);
  fixture.library = { workspaces: workspaces.length, knowledgeBases: assets.knowledgeBases.length, skills: assets.skills.length, notebooks: assets.notebooks.length };
  const skill = assets.skills[0];
  if (skill) {
    assets = await removePartnerAsset(client, partnerId, 'skill', skill);
    if (assets.skills.includes(skill)) throw new Error('the skill was not removed');
    const back = await addPartnerAssets(client, partnerId, { skills: [skill] });
    if (back.errors.length || !back.assets.skills.includes(skill)) throw new Error(`the skill did not come back: ${back.errors.join('; ')}`);
  }
  const notebook = await createNotebook(client, 'APP PROBE: partner notebook', 'Deleted by the probe');
  try {
    const added = await addPartnerAssets(client, partnerId, { notebooks: [notebook.id] });
    if (added.errors.length || !added.assets.notebooks.some((item) => item.id === notebook.id)) throw new Error(`the notebook was not copied: ${added.errors.join('; ')}`);
    assets = await removePartnerAsset(client, partnerId, 'notebook', notebook.id);
    if (assets.notebooks.some((item) => item.id === notebook.id)) throw new Error('the notebook was not removed from the library');
  } finally {
    await deleteNotebook(client, notebook.id).catch(() => undefined);
  }

  // A workspace instead of the private library, then back.
  const workspace = workspaces[0];
  if (workspace) {
    await updatePartner(client, partnerId, { workspaceId: workspace.id });
    if ((await getPartner(client, partnerId)).workspaceId !== workspace.id) throw new Error('binding to a workspace did not take');
    try {
      await addPartnerAssets(client, partnerId, { skills: skill ? [skill] : [] });
      throw new Error('a bound partner took library assets');
    } catch (error) {
      if (statusOf(error) !== 400) throw error;
    } finally {
      await updatePartner(client, partnerId, { workspaceId: '' });
    }
    if ((await getPartner(client, partnerId)).workspaceId) throw new Error('unbinding did not take');
    if (skill && !(await getPartnerAssets(client, partnerId)).skills.includes(skill)) throw new Error('the private library did not come back');
  }

  // Links (redeeming needs a chat app).
  const code = await createLinkCode(client, partnerId);
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code.code) || code.command !== `/link ${code.code}`) throw new Error('the link code looks wrong');
  if ((await listPartnerLinks(client, partnerId)).length) throw new Error('a link is listed before any was made');
  try {
    await removePartnerLink(client, partnerId, 'telegram:0');
    throw new Error('unlinking an account that was never linked was taken');
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
  }

  // Commands.
  const commands = (await listPartnerCommands(client)).map((row) => row.command);
  fixture.commands = commands;
  for (const wanted of ['/help', '/new', '/branch', '/resume', '/delete', '/sessions']) if (!commands.includes(wanted)) throw new Error(`no ${wanted} in the commands`);

  // A file with a message, a command DeepTutor answers, then a branch.
  const key = newPartnerSessionKey();
  const harness = chatHarness(baseUrl, token, partnerId);
  try {
    harness.chat.open(key);
    await harness.ready();
    const file = { type: 'file' as const, filename: 'probe-note.txt', mimeType: 'text/plain', base64: Buffer.from('The secret word is marmalade.').toString('base64') };
    if (!harness.chat.send('APP PROBE: what is the secret word in the attached file? Reply with just the word.', [file])) throw new Error('the message with a file could not be sent');
    await harness.nextEnd(1);
    if (harness.refused.length) throw new Error(`refused: ${harness.refused.join('; ')}`);
    const read = harness.ended[0] as DtPartnerTurn;
    if (!/marmalade/i.test(read.reply.answer)) throw new Error(`the partner did not read the file: ${read.reply.answer.slice(0, 80) || read.reply.error || '(empty)'}`);
    const history = await partnerHistoryPage(client, partnerId, key);
    const sent = history.records.find((record) => record.role === 'user');
    if (!sent?.attachments.some((name) => name.endsWith('probe-note.txt'))) throw new Error('the file is not on the stored message');

    if (!harness.chat.send('/help')) throw new Error('/help could not be sent');
    await harness.nextEnd(2);
    const help = harness.ended[1] as DtPartnerTurn;
    if (!help.reply.answer.includes('/')) throw new Error('/help answered without commands');
    // DeepTutor answers a command itself: the words only, with no reply events before them.
    if (help.reply.seq !== 0) throw new Error('/help came as a model reply');
  } finally {
    harness.chat.close();
  }

  const branch = newPartnerSessionKey();
  await branchPartnerSession(client, partnerId, key, branch);
  const sessions = await listPartnerSessions(client, partnerId);
  const source = sessions.find((session) => session.key === key);
  const copy = sessions.find((session) => session.key === branch);
  if (!source?.archived || !copy || copy.archived || copy.messageCount !== source.messageCount) throw new Error('the branch is not a copy with the original archived');
  for (const session of [branch, key]) await deletePartnerSession(client, partnerId, session);

  return {
    note: `then its identity, picture, soul, model, tools and library changed and read back, a link code made, a file read by the partner, /help answered by DeepTutor, and a branch made${workspace ? '; bound to a workspace and back' : ''}`,
    fixture,
  };
}
