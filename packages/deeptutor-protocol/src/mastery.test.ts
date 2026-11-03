import { describe, expect, it } from 'vitest';
import { DtClient, DtHttpError } from './http';
import {
  createMasteryTopic,
  mapInput,
  mapProblems,
  masteryOfPreferences,
  masteryTitle,
  masteryTopicOf,
  masteryTurnFields,
  newlyMastered,
  notebookMaterial,
  openingMessage,
  sortedReviews,
  whenPathFree,
} from './mastery';
import { applyTurnEvent, emptyReply } from './turnReply';
import { startTurnCommand, type DtStreamEvent } from './turns';

const rawTopic = {
  path_id: 'topic_abc',
  name: 'Capitals',
  metadata: { goal: 'Learn capitals', description: '', emoji: '🌍', status: 'active', created_at: 10 },
  sources: [
    { id: 's0', kind: 'goal', label: 'Learning goal' },
    { id: 's1', kind: 'knowledge_base', source_id: 'geo', label: 'Geography', available: false },
  ],
  path_revision: 7,
  next: { action: 'probe', knowledge_point_id: 'kp2', knowledge_point_name: 'Japan', module_name: 'Asia', reason: 'not tried', session_id: '' },
  map: {
    counts: { mastered: 1, learning: 1, new: 1, total: 3 },
    complete: false,
    modules: [
      { id: 'm2', name: 'Asia', objective: '', order: 2, mastered: 0, total: 1, knowledge_points: [{ id: 'kp2', name: 'Japan', type: 'memory', status: 'new', mastery: 0 }] },
      {
        id: 'm1',
        name: 'Europe',
        objective: 'Western Europe',
        order: 1,
        mastered: 1,
        total: 2,
        knowledge_points: [
          { id: 'kp0', name: 'France', type: 'memory', status: 'mastered', mastery: 1, mastery_source: 'learner', override_note: 'knew it', prerequisite_ids: [], topic_source_ids: ['s1'] },
          { id: 'kp1', name: 'Spain', type: 'weird', status: 'learning', mastery: 0.5 },
        ],
      },
    ],
  },
  reviews: [
    { id: 'r1', knowledge_point_id: 'kp0', knowledge_point_name: 'France', due_at: 300, due: false, forgetting_risk: 0.1 },
    { id: 'r2', knowledge_point_id: 'kpx', knowledge_point_name: 'Italy', due_at: 100, due: true, forgetting_risk: 0.2, recent_failure: true },
    { id: 'r3', knowledge_point_id: 'kpy', knowledge_point_name: 'Greece', due_at: 50, due: true, forgetting_risk: 0.6 },
    { id: 'r4', knowledge_point_id: 'kpz', knowledge_point_name: 'Malta', due_at: 200, due: false, forgetting_risk: 0.9 },
  ],
  review_settings: { desired_retention: 0.85, strategy: { template_id: 'preset-science', name: 'Science' } },
  learner_profile: { prior_knowledge: 'Some', target_level: 'Fluent', teaching_strategy: 'teach_first' },
  session_count: 2,
  updated_at: 500,
};

describe('mastery paths', () => {
  it('reads a path: modules in order, points, next step, reviews, settings and you', () => {
    const topic = masteryTopicOf(rawTopic);
    expect(topic.modules.map((module) => module.id)).toEqual(['m1', 'm2']);
    expect(topic.modules[0]!.points[1]!.type).toBe('concept');
    expect(topic.modules[0]!.points[0]).toMatchObject({ status: 'mastered', masterySource: 'learner', overrideNote: 'knew it', sourceIds: ['s1'] });
    expect(topic.sources).toEqual([{ id: 's1', kind: 'knowledge_base', label: 'Geography', available: false }]);
    expect(topic.next).toMatchObject({ action: 'probe', pointId: 'kp2', pointName: 'Japan' });
    expect(topic.counts.total).toBe(3);
    expect(topic.recallTarget).toBe(0.85);
    expect(topic.strategy).toEqual({ id: 'preset-science', name: 'Science' });
    expect(topic.learner).toMatchObject({ priorKnowledge: 'Some', targetLevel: 'Fluent', teachFirst: true });
    expect(topic.revision).toBe(7);
    expect(mapInput(topic)[0]!.points[0]).toMatchObject({ id: 'kp0', name: 'France', sourceIds: ['s1'] });
  });

  it('names a path by its name, else "Exploration trail" and the end of its id', () => {
    expect(masteryTitle({ name: 'Capitals', pathId: 'topic_abc' })).toBe('Capitals');
    expect(masteryTitle({ name: 'topic_abc', pathId: 'topic_abc' })).toBe('Exploration trail · abc');
    expect(masteryTitle({ name: 'unified_1712_x', pathId: 'unified_1712_x9f2a' })).toBe('Exploration trail · 9f2a');
    expect(masteryTitle({ name: ' ', pathId: 'session-7e1d' })).toBe('Exploration trail · 7e1d');
  });

  it('orders reviews due first by risk, then upcoming by date', () => {
    expect(sortedReviews(masteryTopicOf(rawTopic).reviews).map((review) => review.pointName)).toEqual(['Greece', 'Italy', 'Malta', 'France']);
  });

  it('finds points newly mastered between two looks at a path', () => {
    const before = masteryTopicOf(rawTopic);
    const after = masteryTopicOf({
      ...rawTopic,
      map: { ...rawTopic.map, modules: rawTopic.map.modules.map((module) => ({ ...module, knowledge_points: module.knowledge_points.map((point) => ({ ...point, status: 'mastered' })) })) },
    });
    expect(newlyMastered(before, after).map((point) => point.name)).toEqual(['Spain', 'Japan']);
    expect(newlyMastered(undefined, after)).toEqual([]);
  });

  it("checks a map the way DeepTutor would refuse it", () => {
    expect(mapProblems([])).toEqual(['Keep at least one module.']);
    expect(mapProblems([{ name: '', points: [] }])).toEqual(['Module 1 needs a name.', 'Module 1 needs at least one knowledge point.']);
    const eight = Array.from({ length: 8 }, (_, index) => ({ name: `Point ${index}`, type: 'concept' as const }));
    expect(mapProblems([{ name: 'New', points: eight }])).toEqual(['New: a new module holds at most 7 knowledge points.']);
    expect(mapProblems([{ id: 'm1', name: 'Old', points: eight }], new Set(['m1']))).toEqual([]);
    expect(mapProblems([{ name: 'A', points: [{ name: 'x', type: 'memory' }] }])).toEqual(['A: each knowledge point needs a name of two letters or more.']);
  });

  it('reads a chat\'s path from its preferences, and the turn fields that keep it there', () => {
    expect(masteryOfPreferences({ workspace_mode: 'mastery_path', mastery_path_id: 'topic_abc', mastery_session_mode: 'review' })).toEqual({ pathId: 'topic_abc', mode: 'review' });
    expect(masteryOfPreferences({ workspace_mode: 'mastery_path', mastery_path_id: 'topic_abc', mastery_session_mode: 'odd' })).toEqual({ pathId: 'topic_abc', mode: null });
    expect(masteryOfPreferences({ workspace_mode: '' })).toBeNull();
    const command = startTurnCommand({ content: 'B', sessionId: 's1', ...masteryTurnFields('topic_abc', null), masteryAnswer: { question_id: 'q1', text: 'B' } });
    expect(command).toMatchObject({ capability: 'mastery_path', workspace_mode: 'mastery_path', mastery_path_id: 'topic_abc', mastery_answer: { question_id: 'q1', text: 'B' }, session_id: 's1' });
    expect(command).not.toHaveProperty('mastery_session_mode');
    expect(startTurnCommand({ content: 'x', ...masteryTurnFields('p', 'outline'), masterySkip: { question_id: 'q2' } })).toMatchObject({ mastery_session_mode: 'outline', mastery_skip: { question_id: 'q2' } });
  });

  it('opens outline and review chats with a first message, study ones without', () => {
    expect(openingMessage('outline')).toMatch(/outline/);
    expect(openingMessage('review', ['A', 'B', 'C', 'D', 'E', 'F'])).toBe("Review what's due today: A, B, C, D, E.");
    expect(openingMessage('study')).toBeNull();
  });

  it('makes a path with the goal first among its sources', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const client = new DtClient({
      baseUrl: 'https://learn.example.com',
      token: 't',
      fetch: async (url, init) => {
        calls.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify(rawTopic), { status: 200 });
      },
    });
    const notebook = notebookMaterial({ id: 'nb', name: 'Notes', records: [{ title: 'One', summary: 'S', output: 'O' }] });
    const topic = await createMasteryTopic(client, { goal: '  Learn capitals  ', sources: [notebook] });
    expect(topic.pathId).toBe('topic_abc');
    expect(calls[0]!.url).toBe('https://learn.example.com/api/mastery-paths/topics');
    expect(calls[0]!.body).toMatchObject({ goal: 'Learn capitals', emoji: '🧭', modules: [] });
    expect((calls[0]!.body.sources as { kind: string; excerpt: string }[]).map((source) => source.kind)).toEqual(['goal', 'notebook']);
    expect((calls[0]!.body.sources as { excerpt: string }[])[1]!.excerpt).toBe('One\nS\nO');
  });

  it('retries a change while the path is still held after a turn, and nothing else', async () => {
    let tries = 0;
    const busy = () => new DtHttpError(409, 'Active learning turn could not be stopped before changing this path', '/x');
    await expect(
      whenPathFree(async () => {
        tries += 1;
        if (tries < 3) throw busy();
        return 'done';
      }, [0, 0, 0]),
    ).resolves.toBe('done');
    expect(tries).toBe(3);
    tries = 0;
    await expect(
      whenPathFree(async () => {
        tries += 1;
        throw new DtHttpError(404, 'Mastery topic not found', '/x');
      }, [0, 0]),
    ).rejects.toThrow();
    expect(tries).toBe(1);
    await expect(whenPathFree(async () => Promise.reject(busy()), [0])).rejects.toThrow();
  });
});

const event = (metadata: Record<string, unknown>, seq: number): DtStreamEvent => ({
  type: 'tool_result',
  source: 'mastery',
  stage: '',
  content: '',
  metadata,
  session_id: 's1',
  turn_id: 't1',
  seq,
  timestamp: 0,
});

describe('a mastery chat reply', () => {
  it('collects the cards, rulings, skips, mode switches and outline the tutor sends', () => {
    let reply = emptyReply('s1', 't1');
    reply = applyTurnEvent(reply, event({ call_id: 'c1', tool_name: 'mastery_quiz', tool_metadata: { mastery_question: { question_id: 'q1', prompt: 'Capital of France?', question_type: 'choice', objective: { name: 'France' }, difficulty: 'easy', attempt: 2, options: [{ label: 'A', body: 'Paris' }, { label: 'B', body: 'Lyon' }, { body: 'no label' }] } } }, 1));
    reply = applyTurnEvent(reply, event({ call_id: 'c2', mastery_grade: { result: { question_id: 'q0', is_correct: false, result: 'incorrect', learner_answer: 'B', correct_label: 'A', correct_body: 'Paris', explanation: 'It is Paris.' } } }, 2));
    reply = applyTurnEvent(reply, event({ call_id: 'c3', tool_metadata: { mastery_skip_question: { status: 'skipped', skipped: true, question_id: 'q9' } } }, 3));
    reply = applyTurnEvent(reply, event({ call_id: 'c4', tool_metadata: { mastery_answer_rejected: { question_id: 'q8', message: 'stale' } } }, 4));
    reply = applyTurnEvent(reply, event({ call_id: 'c5', tool_metadata: { mastery_mode: { status: 'switched', previous_mode: 'outline', mode: 'study' } } }, 5));
    reply = applyTurnEvent(reply, event({ call_id: 'c6', tool_metadata: { mastery_build: { status: 'built', modules_added: 2, knowledge_points_added: 6 } } }, 6));
    const { mastery } = reply;
    expect(mastery.questions).toEqual([
      { id: 'q1', prompt: 'Capital of France?', type: 'choice', pointName: 'France', difficulty: 'easy', attempt: 2, options: [{ label: 'A', body: 'Paris' }, { label: 'B', body: 'Lyon' }], freeText: true, parts: [] },
    ]);
    expect(mastery.grades[0]).toMatchObject({ questionId: 'q0', correct: false, result: 'incorrect', correctLabel: 'A', final: true });
    expect(mastery.skipped).toEqual(['q9']);
    expect(mastery.rejected).toEqual(['q8']);
    expect(mastery.mode).toBe('study');
    expect(mastery.built).toEqual({ modules: 2, points: 6 });
    expect(reply.ask).toBeNull();
    expect(reply.status).toBe('running');
  });

  it('reads a group card, and an older card inside an ask_user envelope without pausing the turn', () => {
    const group = {
      question_id: 'g1',
      question_type: 'group',
      prompt: 'Two quick ones',
      questions: [
        { question_id: 'g1a', prompt: 'One', question_type: 'short' },
        { question_id: 'g1b', prompt: 'Two', question_type: 'choice', options: [{ label: 'A', body: 'x' }] },
      ],
    };
    let reply = applyTurnEvent(emptyReply(), event({ tool_metadata: { mastery_question: group } }, 1));
    expect(reply.mastery.questions[0]!.parts.map((part) => part.id)).toEqual(['g1a', 'g1b']);
    reply = applyTurnEvent(reply, event({ tool_metadata: { mastery_question: { ...group, question_id: 'g2', questions: [group.questions[0]] } } }, 2));
    expect(reply.mastery.questions).toHaveLength(1);
    reply = applyTurnEvent(reply, event({ tool_metadata: { ask_user: { kind: 'mastery_question', mastery_question: { question_id: 'old', prompt: 'Old card' } } } }, 3));
    expect(reply.mastery.questions.map((question) => question.id)).toEqual(['g1', 'old']);
    expect(reply.status).not.toBe('waiting');
    expect(reply.ask).toBeNull();
  });
});
