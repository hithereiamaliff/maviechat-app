import {
  deleteFeedback,
  feedbackModels,
  getArenaEnabled,
  getFeedback,
  getLeaderboard,
  listFeedback,
  OwuiHttpError,
  setArenaEnabled,
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

/**
 * M4.7: admin evaluations. A non-admin is refused the leaderboard. Only on the scratch instance:
 * two made-up comparisons seeded (model A beating model B, then a draw), the leaderboard and the
 * feedback list read them (with the rated reply found in the kept chat), both deleted; the arena
 * switch flipped and put back.
 */
export async function probeM4Evaluations({ client, capabilities, allowWrites }: { client: OwuiClient; capabilities: Capabilities; allowWrites: boolean }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const step = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };

  if (!capabilities.isAdmin) {
    await step('admin evaluations: the leaderboard refused to a non-admin', async () => {
      const status = await statusOf(() => getLeaderboard(client));
      if (status === 200) throw new Error('a non-admin read the leaderboard');
      return `refused (${status})`;
    });
    return { steps, fixture };
  }
  if (!allowWrites) return { steps, fixture };

  const stamp = Date.now().toString(36);
  const a = `app-probe-a-${stamp}`;
  const b = `app-probe-b-${stamp}`;
  const made: string[] = [];
  try {
    await step('admin evaluations: seeded comparisons read on the leaderboard and in the feedback, then deleted', async () => {
      const seed = async (rating: number, message: string) => {
        const snapshot = { chat: { history: { messages: { [`${message}-q`]: { id: `${message}-q`, content: 'APP PROBE question' }, [message]: { id: message, parentId: `${message}-q`, content: 'APP PROBE answer' } } } } };
        const row = await client.post<{ id?: string }>('/api/v1/evaluations/feedback', { type: 'rating', data: { rating, model_id: a, sibling_model_ids: [b], reason: 'APP PROBE', comment: '', details: { rating: 7 }, tags: ['probe'] }, meta: { arena: true, chat_id: `chat-${stamp}`, message_id: message, model_id: a }, snapshot });
        if (row.id) made.push(row.id);
      };
      await seed(1, `m1-${stamp}`);
      await seed(0, `m2-${stamp}`);
      const board = await getLeaderboard(client);
      const top = board.find((entry) => entry.modelId === a);
      if (!top || top.won < 1) throw new Error('model A’s win wasn’t on the leaderboard');
      if (!(await feedbackModels(client)).includes(a)) throw new Error('model A wasn’t among the models with feedback');
      const page = await listFeedback(client, { modelId: a });
      if (page.items.filter((item) => made.includes(item.id)).length !== 2) throw new Error(`listed ${page.items.length} for model A`);
      const one = await getFeedback(client, made[0] ?? '');
      if (one.prompt !== 'APP PROBE question' || one.reply !== 'APP PROBE answer' || one.result !== 'won' || one.score !== 7) throw new Error('the feedback didn’t read back with its chat');
      for (const id of made.splice(0)) await deleteFeedback(client, id);
      if ((await getLeaderboard(client)).some((entry) => entry.modelId === a)) throw new Error('the leaderboard still had model A');
      return `A beat B (rating ${top.rating}), a draw; both listed, the rated reply found in its kept chat; both deleted, A gone from the leaderboard`;
    });
  } finally {
    for (const id of made) await deleteFeedback(client, id).catch(() => undefined);
  }

  const arena = await getArenaEnabled(client);
  try {
    await step('admin evaluations: the arena switched and put back', async () => {
      await setArenaEnabled(client, !arena);
      if ((await getArenaEnabled(client)) !== !arena) throw new Error('switching it didn’t take');
      await setArenaEnabled(client, arena);
      if ((await getArenaEnabled(client)) !== arena) throw new Error('it didn’t go back');
      return `${arena ? 'on' : 'off'} → ${arena ? 'off' : 'on'} → back`;
    });
  } finally {
    if ((await getArenaEnabled(client).catch(() => arena)) !== arena) await setArenaEnabled(client, arena).catch(() => undefined);
  }
  return { steps, fixture };
}
