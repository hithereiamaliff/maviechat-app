import { describe, expect, it, vi } from 'vitest';
import { ScriptRunner } from './runner';

function setup() {
  const pending: { run: () => void; ms: number; cleared: boolean }[] = [];
  const timers = {
    set: (run: () => void, ms: number) => {
      const handle = { run, ms, cleared: false };
      pending.push(handle);
      return handle;
    },
    clear: (handle: unknown) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  const effects = { file: vi.fn(), open: vi.fn() };
  const runner = new ScriptRunner(effects, timers, 60_000);
  const message = (run: number, body: Record<string, unknown>) => JSON.stringify({ r: run, ...body });
  return { runner, effects, pending, message };
}

describe('the runner for tools’ JavaScript', () => {
  it('runs one at a time, each in its own page, answering with what came back', async () => {
    const { runner, message } = setup();
    const first = runner.run('return 1;');
    const second = runner.run('return 2;');
    expect(runner.getCurrent()).toEqual({ run: 1, code: 'return 1;' });
    runner.receive(message(1, { type: 'done', result: '1' }));
    expect(await first).toEqual({ ok: true, result: 1 });
    expect(runner.getCurrent()).toEqual({ run: 2, code: 'return 2;' });
    runner.receive(message(2, { type: 'error', error: 'nope' }));
    expect(await second).toEqual({ ok: false, error: 'nope' });
    expect(runner.getCurrent()).toBeNull();
  });

  it('keeps the same snapshot until the run changes, and ignores other runs’ messages', () => {
    const { runner, message } = setup();
    void runner.run('a');
    const shown = runner.getCurrent();
    runner.receive(message(7, { type: 'done', result: '1' }));
    runner.receive('not json');
    expect(runner.getCurrent()).toBe(shown);
  });

  it('passes on files and pages the code offers, but only while it runs', () => {
    const { runner, effects, message } = setup();
    runner.navigate('https://before.test');
    void runner.run('a');
    runner.receive(message(1, { type: 'file', name: 'hi.txt', url: 'data:text/plain;base64,aGk=' }));
    runner.receive(message(1, { type: 'open', url: 'https://example.com' }));
    runner.navigate('https://example.com/next');
    runner.navigate('mailto:someone@example.com');
    expect(effects.file).toHaveBeenCalledWith('hi.txt', 'data:text/plain;base64,aGk=');
    expect(effects.open.mock.calls).toEqual([['https://example.com'], ['https://example.com/next']]);
  });

  it('stops a run over its time limit, or whose page stopped, and says why', async () => {
    const { runner, pending } = setup();
    const slow = runner.run('while (true) {}');
    pending[0]?.run();
    expect(await slow).toEqual({ ok: false, error: 'It ran longer than 60 seconds and was stopped.' });
    const crashed = runner.run('a');
    runner.ended();
    expect(await crashed).toEqual({ ok: false, error: 'The page it ran in stopped.' });
    expect(pending[1]?.cleared).toBe(true);
  });

  it('answers everything waiting when it’s put away', async () => {
    const { runner } = setup();
    const running = runner.run('a');
    const waiting = runner.run('b');
    runner.dispose();
    expect(await running).toMatchObject({ ok: false });
    expect(await waiting).toMatchObject({ ok: false });
    expect(runner.getCurrent()).toBeNull();
  });
});
