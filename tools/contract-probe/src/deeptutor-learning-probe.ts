import {
  applyTurnEvent,
  createMasteryTopic,
  deleteMasteryPath,
  deleteSavedQuestion,
  deleteSession,
  DtTurnConnection,
  emptyReply,
  getLearningIndex,
  getMasteryTopic,
  getPointReport,
  getSession,
  listMasterySessions,
  listMasteryTopics,
  listModules,
  listSavedQuestions,
  listReviewStrategies,
  mapInput,
  masteryOfPreferences,
  masteryTurnFields,
  overridePoint,
  randomId,
  renameMasteryPath,
  resetMasteryPath,
  saveMasteryMap,
  setMasteryMode,
  setRecallTarget,
  setReviewStrategy,
  socketCookieHeader,
  turnSocketUrl,
  type DtClient,
  type DtMasteryQuestion,
  type DtReply,
  type DtTurnRequest,
} from '@maviechat/deeptutor-protocol';

const NodeWebSocket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;

/**
 * B5.1 against a live DeepTutor, in the test account: the learning hub's index and modules; a
 * mastery path made from a goal with two knowledge points; a study chat on it where the tutor
 * poses a question card, answered as the app answers it (graded, and the attempt recorded);
 * the chat's mode switched; a point marked known and back; renamed; review strategy and recall
 * target set and put back; the map edited (old ids kept); progress reset; then the path, the
 * chat and the practice questions the tutor's cards left in the Question Bank deleted. Uses the
 * account's model for a few turns.
 */
export async function probeLearning(baseUrl: string, token: string, client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const notes: string[] = [];
  const fixture: Record<string, unknown> = {};
  const word = `zq${randomId().slice(0, 6)}`;
  let pathId: string | null = null;
  let madePath: string | null = null;
  let sessionId: string | null = null;
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
      if (event.type === 'done' || reply.status === 'waiting') wake();
    },
    onError: (error) => {
      reply = { ...reply, status: 'failed', error: `${error.error_code ?? 'error'}: ${error.message ?? ''}` };
      wake();
    },
  });

  /** One turn; a pause for questions (the tutor's intake) is answered plainly, up to three times. */
  const turn = async (request: DtTurnRequest): Promise<DtReply> => {
    reply = emptyReply();
    const settle = () =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no answer within 4 minutes')), 240_000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    let waiting = settle();
    const started = await connection.startTurn(request);
    sessionId = started.sessionId;
    for (let round = 0; round < 4; round += 1) {
      await waiting;
      if (reply.status !== 'waiting' || !reply.ask || !reply.turnId) break;
      waiting = settle();
      const answers = reply.ask.questions.map((question) => ({ questionId: question.id, text: question.options[0]?.label || 'No experience yet; a basic level is enough; about ten minutes.' }));
      await connection.reply(reply.turnId, { answers });
    }
    if (reply.status === 'failed') throw new Error(`the turn failed: ${reply.error ?? 'no reason given'}`);
    return reply;
  };

  /** Waits until none of the path's chats is running (DeepTutor lets go of a path just after a turn ends). */
  const settled = async (id: string) => {
    for (let tries = 0; tries < 30; tries += 1) {
      const sessions = await listMasterySessions(client, id);
      if (!sessions.some((session) => session.running)) return tries;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("the path's chat still reads running after 30 s");
  };

  try {
    // The hub: modules and the index.
    const modules = await listModules(client);
    const learningPages = ['/learning/books', '/learning/mastery', '/learning/practice', '/learning/reading'].filter((page) =>
      modules.some((module) => module.enabled && module.ready && module.navigation.some((item) => page === item || page.startsWith(`${item}/`))),
    );
    fixture.learningPages = learningPages;
    notes.push(`${learningPages.length} of 4 learning pages switched on`);

    // A path from a goal, with its outline given (so study can start at once).
    const goal = `${'APP PROBE:'} ${word} learn the capital cities of France and Japan`;
    let topic = await createMasteryTopic(client, {
      goal,
      emoji: '🧭',
      modules: [{ name: 'Capital cities', points: [{ name: 'Capital of France', type: 'memory' }, { name: 'Capital of Japan', type: 'memory' }] }],
    });
    pathId = topic.pathId;
    madePath = topic.pathId;
    const id = topic.pathId;
    if (!/^topic_/.test(id)) throw new Error(`the new path's id reads ${id}`);
    if (topic.counts.total !== 2 || topic.modules.length !== 1) throw new Error(`the path has ${topic.counts.total} points in ${topic.modules.length} modules`);
    if (!topic.name.trim()) throw new Error('the path has no name');
    fixture.topicKeys = { next: topic.next?.action ?? null, sources: topic.sources.length, recallTarget: topic.recallTarget, strategy: topic.strategy?.id ?? null };
    const listed = await listMasteryTopics(client);
    if (!listed.some((item) => item.pathId === id)) throw new Error("the path isn't in the list");
    const index = await getLearningIndex(client);
    if (!index.activities.some((item) => item.kind === 'mastery' && item.id === id)) throw new Error("the learning hub doesn't list the path");
    notes.push(`path made and named (next: ${topic.next?.action ?? 'none'}); listed, and in the hub`);

    // A study chat: the tutor poses a question card.
    const fields = masteryTurnFields(id, 'study');
    let studied = await turn({ content: 'Give me a quick check of what I know: one multiple-choice question, please.', ...fields, tools: [] });
    let card: DtMasteryQuestion | undefined = studied.mastery.questions[0];
    if (!card) {
      studied = await turn({ content: 'Please ask me one multiple-choice question about it now.', sessionId: sessionId ?? undefined, ...masteryTurnFields(id, null), tools: [] });
      card = studied.mastery.questions[0];
    }
    if (!card || !sessionId) throw new Error('the tutor posed no question card in two turns');
    const chat = sessionId;
    fixture.card = { type: card.type, options: card.options.length, freeText: card.freeText, hasPoint: Boolean(card.pointName), attempt: card.attempt };
    notes.push(`study chat: the tutor posed a ${card.type} card (${card.options.length} options)`);

    // Answered as the app answers: the option's letter, as the message and the answer.
    const answer = card.options[0]?.label || 'Paris';
    const graded = await turn({ content: answer, sessionId: chat, ...masteryTurnFields(id, null), masteryAnswer: { question_id: card.id, text: answer }, tools: [] });
    const grade = graded.mastery.grades.find((item) => item.questionId === card.id);
    if (!grade) throw new Error('no grade came back for the answer');
    fixture.grade = { result: grade.result, correctKnown: grade.correct !== null, hasCorrectLabel: Boolean(grade.correctLabel), final: grade.final };
    topic = await getMasteryTopic(client, id);
    const point = topic.modules.flatMap((module) => module.points).find((item) => item.name === card.pointName) ?? topic.modules[0]!.points[0]!;
    const report = await getPointReport(client, id, point.id);
    if (report.attempts.length === 0) throw new Error(`no attempt recorded on "${point.name}"`);
    notes.push(`answered "${answer}": graded ${grade.result || (grade.correct ? 'correct' : 'incorrect')}; the attempt is on the point (${report.gate} gate)`);

    // The chat belongs to the path; its mode switches.
    const waited = await settled(id);
    fixture.settleSeconds = waited;
    const sessions = await listMasterySessions(client, id);
    if (!sessions.some((session) => session.id === chat)) throw new Error("the path's chats don't include the study chat");
    const before = masteryOfPreferences((await getSession(client, chat)).preferences);
    if (before?.pathId !== id || before.mode !== 'study') throw new Error(`the chat's saved path/mode reads ${JSON.stringify(before)}`);
    await setMasteryMode(client, id, chat, 'review');
    const after = masteryOfPreferences((await getSession(client, chat)).preferences);
    if (after?.mode !== 'review') throw new Error(`the mode reads ${after?.mode ?? 'nothing'} after switching to review`);
    notes.push('the chat is filed under the path; switched to review');

    // "I already know this", and back.
    const other = topic.modules[0]!.points.find((item) => item.id !== point.id)!;
    await overridePoint(client, id, other.id, true, 'Known before the probe');
    let marked = (await getMasteryTopic(client, id)).modules[0]!.points.find((item) => item.id === other.id)!;
    if (marked.status !== 'mastered' || marked.masterySource !== 'learner') throw new Error(`marked known, the point reads ${marked.status}/${marked.masterySource}`);
    await overridePoint(client, id, other.id, false);
    marked = (await getMasteryTopic(client, id)).modules[0]!.points.find((item) => item.id === other.id)!;
    if (marked.status === 'mastered') throw new Error('back to assessment, the point still reads mastered');
    notes.push('a point marked known, then back');

    // Rename, review strategy and recall target (put back after).
    await renameMasteryPath(client, id, `APP PROBE ${word} renamed`);
    if ((await getMasteryTopic(client, id)).name !== `APP PROBE ${word} renamed`) throw new Error("the new name didn't read back");
    const strategies = await listReviewStrategies(client);
    const preset = strategies.find((item) => item.builtin);
    if (!preset) throw new Error('no preset review strategies');
    fixture.strategies = { presets: strategies.filter((item) => item.builtin).length, custom: strategies.filter((item) => !item.builtin).length };
    let tuned = await setReviewStrategy(client, id, preset.id);
    if (tuned.strategy?.id !== preset.id) throw new Error(`the strategy reads ${tuned.strategy?.id ?? 'default'}`);
    tuned = await setRecallTarget(client, id, 0.85);
    if (Math.abs(tuned.recallTarget - 0.85) > 1e-6) throw new Error(`the recall target reads ${tuned.recallTarget}`);
    tuned = await setReviewStrategy(client, id, '');
    if (tuned.strategy) throw new Error('the default strategy did not come back');
    notes.push(`renamed; strategy ${preset.name} and recall 85% set, default put back`);

    // The map edited: old points keep their ids (and evidence), a new one joins.
    const current = await getMasteryTopic(client, id);
    const edited = mapInput(current);
    edited[0]!.points.push({ name: 'Capital of Kenya', type: 'memory' });
    const saved = await saveMasteryMap(client, id, edited);
    const ids = saved.modules[0]!.points.map((item) => item.id);
    if (saved.counts.total !== 3 || !current.modules[0]!.points.every((item) => ids.includes(item.id))) throw new Error('the edited map lost or renamed points');
    const kept = await getPointReport(client, id, point.id);
    if (kept.attempts.length === 0) throw new Error('editing the map lost the answered point\'s attempts');
    notes.push('map edited: 3 points, old ids and attempts kept');

    // Reset keeps the modules and clears the progress.
    await resetMasteryPath(client, id);
    const reset = await getMasteryTopic(client, id);
    if (reset.counts.total !== 3 || (await getPointReport(client, id, point.id)).attempts.length !== 0) throw new Error("reset didn't clear the attempts, or lost points");
    notes.push('reset: points kept, attempts cleared');

    // Delete: gone from the list.
    await deleteMasteryPath(client, id);
    pathId = null;
    if ((await listMasteryTopics(client)).some((item) => item.pathId === id)) throw new Error('the deleted path is still listed');
    const missing = await getMasteryTopic(client, id).then(
      () => false,
      () => true,
    );
    if (!missing) throw new Error('the deleted path still opens');
    notes.push('deleted');
    return { note: notes.join('; '), fixture };
  } catch (error) {
    throw new Error(`${notes.join('; ')}${notes.length ? '; then ' : ''}${error instanceof Error ? error.message : String(error)}`);
  } finally {
    connection.close();
    if (pathId) await deleteMasteryPath(client, pathId).catch(() => undefined);
    if (sessionId) await deleteSession(client, sessionId).catch(() => undefined);
    // The tutor's cards are kept as practice questions; they outlive the path, so they go too.
    if (madePath) {
      const left = await listSavedQuestions(client, { limit: 100 }).catch(() => ({ items: [] }));
      for (const item of left.items) {
        if ((item as Record<string, unknown>).mastery_path_id === madePath) await deleteSavedQuestion(client, Number(item.id)).catch(() => undefined);
      }
    }
  }
}
