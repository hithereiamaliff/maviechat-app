import { describe, expect, it } from 'vitest';
import { applyTurnEvent, emptyReply, replyFromEvents, replySegments, savedReply, toolSummary } from './turnReply';
import { parseServerEvent, resumeTurnCommand, socketCookieHeader, startTurnCommand, turnSocketUrl, type DtStreamEvent } from './turns';

const turn = 'turn_1';
const session = 'unified_1';
let seq = 0;
function event(type: DtStreamEvent['type'], content = '', metadata: Record<string, unknown> = {}, stage = 'responding'): DtStreamEvent {
  seq += 1;
  return { type, content, metadata, source: 'chat', stage, session_id: session, turn_id: turn, seq, timestamp: 1 };
}
const round = (id: string, extra: Record<string, unknown> = {}) => ({ call_id: id, call_kind: 'agent_loop_round', trace_kind: 'llm_chunk', ...extra });

/** A chat turn shaped like DeepTutor 1.7.1's: think, remark, search, think, answer. */
function searchTurn(): DtStreamEvent[] {
  seq = 0;
  return [
    event('session', '', { session_id: session, turn_id: turn }, ''),
    event('stage_start'),
    event('progress', 'Exploring', { call_id: 'r1', call_state: 'running', label: 'Exploring' }),
    event('thinking', 'Need a ', round('r1')),
    event('thinking', 'source.', round('r1')),
    event('content', 'Searching first.', round('r1')),
    event('tool_call', 'web_search', { call_id: 't1', tool_name: 'web_search', args: { query: 'minimum wage' }, assistant_content_offset: 16 }),
    event('tool_result', '### Results', { call_id: 't1', tool_name: 'web_search' }),
    event('progress', 'Exploring', { call_id: 'r2', call_state: 'running', label: 'Exploring' }),
    event('thinking', 'Found it.', round('r2')),
    event('content', 'It is RM1,700.', round('r2')),
    // Text from a capability's inner step is not part of the answer.
    event('content', 'internal', { call_id: 'x', call_kind: 'tool_planning' }),
    event('stage_end'),
    event('sources', '', { sources: [{ type: 'web', url: 'https://a.example', title: 'A' }, { url: 'https://a.example' }, { url: '' }] }),
    event('result', '', { response: 'It is RM1,700.' }, ''),
    event('done', '', { status: 'completed', user_message_id: 5, assistant_message_id: 6 }, ''),
  ];
}

describe('turn protocol frames', () => {
  it('reads events, acks and errors, and skips everything else', () => {
    expect(parseServerEvent('{"type":"content","content":"Hi","seq":3,"turn_id":"t","metadata":{"session_id":"s"},"protocol_version":"2.0"}')).toMatchObject({
      type: 'content',
      content: 'Hi',
      seq: 3,
      turn_id: 't',
      session_id: 's',
      stage: '',
    });
    expect(parseServerEvent({ type: 'command_ack', command_id: 'c', command_type: 'cancel_turn', accepted: true })).toMatchObject({ accepted: true, command_id: 'c' });
    expect(parseServerEvent({ type: 'protocol_error', error_code: 'start_turn_rejected', message: 'No' })).toMatchObject({ retryable: false, session_id: '' });
    expect(parseServerEvent({ type: 'active_turn_info' })).toMatchObject({ status: 'none' });
    expect(parseServerEvent('not json')).toBeNull();
    expect(parseServerEvent({ type: 'novelty' })).toBeNull();
  });

  it('leaves out what the session should keep', () => {
    expect(startTurnCommand({ content: 'Hello' })).toEqual({ protocol_version: '2.0', type: 'start_turn', content: 'Hello', capability: 'chat' });
    expect(
      startTurnCommand({
        content: 'More',
        sessionId: 's',
        tools: [],
        llmSelection: { profile_id: 'p', model_id: 'm' },
        attachments: [],
        clientSubmissionId: 'sub',
      }),
    ).toEqual({ protocol_version: '2.0', type: 'start_turn', content: 'More', capability: 'chat', session_id: 's', tools: [], llm_selection: { profile_id: 'p', model_id: 'm' }, client_submission_id: 'sub' });
    expect(resumeTurnCommand('t', 4.7)).toEqual({ protocol_version: '2.0', type: 'resume_from', turn_id: 't', seq: 4 });
    expect(turnSocketUrl('https://learn.example.com/')).toBe('wss://learn.example.com/ws');
    expect(turnSocketUrl('http://127.0.0.1:3782')).toBe('ws://127.0.0.1:3782/ws');
  });
});

/** How DeepTutor's server (Starlette) reads a Cookie header: split on ";", the last value of a name wins. */
function serverCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const chunk of header.split(';')) {
    const [key = '', ...rest] = chunk.split('=');
    if (key.trim() || rest.length) cookies[key.trim()] = rest.join('=').trim();
  }
  return cookies;
}

describe('signing a socket in', () => {
  it('survives iOS appending our cookie to the ones it holds', () => {
    const ours = socketCookieHeader('tok.en');
    // iOS joins its stored cookies and ours with a comma.
    expect(serverCookies(`dt_token=old.tok,${ours}`).dt_token).toBe('tok.en');
    expect(serverCookies(`other=1; dt_token=tok.en,${ours}`).dt_token).toBe('tok.en');
    expect(serverCookies(ours).dt_token).toBe('tok.en');
    // What a plain cookie turned into on the phone:
    expect(serverCookies('dt_token=tok.en,dt_token=tok.en').dt_token).not.toBe('tok.en');
  });
});

describe('a reply built from events', () => {
  it('collects the answer, reasoning per round, tools in place and sources', () => {
    const reply = replyFromEvents(searchTurn());
    expect(reply).toMatchObject({
      sessionId: session,
      turnId: turn,
      status: 'completed',
      answer: 'Searching first.It is RM1,700.',
      thoughts: [
        { id: 'r1', text: 'Need a source.' },
        { id: 'r2', text: 'Found it.' },
      ],
      sources: [{ url: 'https://a.example', title: 'A', type: 'web' }],
      activity: null,
      userMessageId: 5,
      assistantMessageId: 6,
      seq: 16,
    });
    expect(reply.tools).toEqual([{ id: 't1', name: 'web_search', args: { query: 'minimum wage' }, offset: 16, done: true, result: '### Results' }]);
    expect(toolSummary(reply.tools[0]!)).toBe('minimum wage');
    expect(replySegments(reply)).toEqual([
      { kind: 'text', text: 'Searching first.' },
      { kind: 'tools', tools: reply.tools },
      { kind: 'text', text: 'It is RM1,700.' },
    ]);
  });

  it('ignores repeats and shows what it is doing while it runs', () => {
    const events = searchTurn();
    let reply = emptyReply();
    for (const item of events.slice(0, 8)) reply = applyTurnEvent(reply, item);
    expect(reply.status).toBe('running');
    expect(reply.activity).toBe('web_search');
    expect(applyTurnEvent(reply, events[5]!)).toBe(reply);
    reply = applyTurnEvent(reply, events[8]!);
    expect(reply.activity).toBe('Exploring');
  });

  it('takes the answer from the result when nothing streamed, and reports failures', () => {
    seq = 0;
    const quiet = replyFromEvents([event('result', '', { response: 'Only here' }, ''), event('done', '', { status: 'completed' }, '')]);
    expect(quiet.answer).toBe('Only here');
    seq = 0;
    const failed = replyFromEvents([event('error', 'Provider down', { turn_terminal: true }), event('done', '', {}, '')]);
    expect(failed).toMatchObject({ status: 'failed', error: 'Provider down' });
    seq = 0;
    const cancelled = replyFromEvents([event('content', 'Half', round('r1')), event('done', '', { status: 'cancelled' }, '')]);
    expect(cancelled).toMatchObject({ status: 'cancelled', answer: 'Half' });
  });

  it('waits for an answer to its question, then carries on', () => {
    seq = 0;
    let reply = replyFromEvents([event('wait_for_input', 'Which level?', { questions: [{ id: 'q1' }] })]);
    expect(reply).toMatchObject({ status: 'waiting', question: { prompt: 'Which level?' } });
    reply = applyTurnEvent(reply, event('content', 'OK.', round('r2')));
    expect(reply).toMatchObject({ status: 'running', question: null });
  });

  it('rebuilds a saved reply from its text and saved tool events', () => {
    const events = searchTurn().filter((item) => ['tool_call', 'tool_result', 'result', 'done'].includes(item.type));
    const reply = savedReply({ id: 6, role: 'assistant', content: 'Searching first.It is RM1,700.', events });
    expect(reply.status).toBe('completed');
    expect(replySegments(reply).map((segment) => segment.kind)).toEqual(['text', 'tools', 'text']);
    expect(savedReply({ id: 7, role: 'assistant', content: 'Plain' })).toMatchObject({ answer: 'Plain', tools: [], status: 'completed' });
  });

  it('keeps tool steps sensible when offsets are missing or out of range', () => {
    const segments = replySegments({
      answer: 'Hello',
      tools: [
        { id: 'b', name: 'b', args: {}, offset: 99, done: true, result: '' },
        { id: 'a', name: 'a', args: {}, offset: 0, done: true, result: '' },
      ],
    });
    expect(segments.map((segment) => (segment.kind === 'text' ? segment.text : segment.tools.map((tool) => tool.id).join()))).toEqual(['a', 'Hello', 'b']);
  });
});

describe('DeepTutor modes', () => {
  it('collects Quiz questions as they stream and from the result', () => {
    seq = 0;
    const qa = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ question_id: id, question: `Q ${id}`, question_type: type, correct_answer: 'A', explanation: 'Because.', ...extra });
    const reply = replyFromEvents([
      event('stage_start', '', {}, 'quizzing'),
      event('content', '### Question 1', { call_kind: 'quiz_question_emitted', call_id: 'q1', qa_pair: qa('q_1', 'Multiple Choice', { options: { A: 'Yes', B: 'No' } }) }, 'quizzing'),
      event('stage_end', '', {}, 'quizzing'),
      event('result', '', { response: 'Two questions.', summary: { results: [{ qa_pair: qa('q_1', 'choice', { options: { A: 'Yes', B: 'No' } }) }, { qa_pair: qa('q_2', 'fill-in-the-blank') }] } }, ''),
    ]);
    expect(reply.answer).toBe('Two questions.');
    expect(reply.stages).toEqual([{ name: 'quizzing', done: true }]);
    expect(reply.quiz.map((question) => [question.id, question.type, question.options.map((option) => option.key).join('')])).toEqual([
      ['q_1', 'choice', 'AB'],
      ['q_2', 'fill_in_blank', ''],
    ]);
  });

  it('reads a visualization and a Research outline from the result', () => {
    seq = 0;
    const visual = replyFromEvents([
      event('result', '', { render_type: 'chartjs', payload: { format: 'application/vnd.chartjs+json', data: { type: 'bar' } }, presentation: { title: 'Moons' } }, ''),
    ]).visual;
    expect(visual).toMatchObject({ renderType: 'chartjs', title: 'Moons', code: { language: 'json' } });
    expect(JSON.parse(visual!.data)).toEqual({ type: 'bar' });

    seq = 0;
    const outline = replyFromEvents([
      event('result', '', { response: '', outline_preview: true, topic: 'Water', sub_topics: [{ title: 'Stores', overview: 'Where water sits' }, { title: '' }], research_config: { mode: 'notes', depth: 'quick' } }, ''),
    ]).outline;
    expect(outline).toEqual({ topic: 'Water', subTopics: [{ title: 'Stores', overview: 'Where water sits' }], config: { mode: 'notes', depth: 'quick' } });
  });

  it('waits on Ask Questions until your answers go back, and keeps them', () => {
    seq = 0;
    const ask = { intro: 'A few details:', questions: [{ id: 'goal', header: 'Goal', prompt: 'What for?', multi_select: true, options: [{ label: 'Exam', description: 'A test' }], allow_free_text: true }] };
    let reply = replyFromEvents([
      event('progress', '', { trace_kind: 'ask_user_draft', ask_user_draft: { intro: 'A few', questions: [] } }),
      event('tool_call', 'ask_user', { call_id: 't1', tool_name: 'ask_user', args: ask }),
      event('tool_result', '[awaiting user reply to: What for?]', { call_id: 't1', tool_name: 'ask_user', tool_metadata: { ask_user: ask } }),
    ]);
    expect(reply.status).toBe('waiting');
    expect(reply.ask).toEqual({ intro: 'A few details:', questions: [{ id: 'goal', header: 'Goal', prompt: 'What for?', options: [{ label: 'Exam', description: 'A test' }], multiSelect: true, freeText: true, placeholder: '' }] });
    reply = applyTurnEvent(reply, event('progress', '', { trace_kind: 'user_reply', answers: [{ questionId: 'goal', text: 'Exam' }] }));
    expect(reply).toMatchObject({ status: 'running', askAnswers: { goal: 'Exam' } });
    reply = applyTurnEvent(reply, event('done', '', { status: 'completed' }, ''));
    expect(reply.status).toBe('completed');
  });

  it('sends a mode with its settings, and a continuation without a new message', () => {
    expect(startTurnCommand({ content: 'Water', sessionId: 's', capability: 'deep_research', config: { depth: 'quick', confirmed_outline: [] }, persistUserMessage: false })).toEqual({
      protocol_version: '2.0',
      type: 'start_turn',
      content: 'Water',
      capability: 'deep_research',
      session_id: 's',
      config: { depth: 'quick', confirmed_outline: [] },
      persist_user_message: false,
    });
    expect(startTurnCommand({ content: 'Hi', config: {} })).not.toHaveProperty('config');
  });
});
