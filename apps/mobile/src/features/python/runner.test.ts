import type { CodeOutput } from '@maviechat/owui-protocol';
import { describe, expect, it } from 'vitest';
import { LOAD_LIMIT_MS, PythonRunner, RUN_LIMIT_MS, TIME_LIMIT_MESSAGE } from './runner';
import { pythonPage } from './runnerPage';

interface FakeTimer {
  run: () => void;
  ms: number;
  live: boolean;
}

function setup() {
  const timers: FakeTimer[] = [];
  const clock = {
    set: (run: () => void, ms: number) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return timer;
    },
    clear: (handle: unknown) => {
      if (handle) (handle as FakeTimer).live = false;
    },
  };
  let count = 0;
  const runner = new PythonRunner(clock, () => `job-${++count}`);
  const sent: { id: string; code: string; files: unknown[] }[] = [];
  const attach = () =>
    runner.attach((script) => {
      expect(script.startsWith('window.mavieRun(') && script.endsWith(');true;')).toBe(true);
      sent.push(JSON.parse(script.slice('window.mavieRun('.length, -');true;'.length)) as (typeof sent)[number]);
    });
  const say = (message: Record<string, unknown>) => runner.receive(JSON.stringify({ g: runner.getGeneration(), ...message }));
  const fire = (ms: number) =>
    timers
      .filter((timer) => timer.live && timer.ms === ms)
      .forEach((timer) => {
        timer.live = false;
        timer.run();
      });
  return { runner, sent, attach, say, fire };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PythonRunner', () => {
  it('starts Python on the first job, sends jobs once it is ready, and keeps it for the next', async () => {
    const { runner, sent, attach, say } = setup();
    expect(runner.getGeneration()).toBe(0);
    const first = runner.run({ code: 'print(1)', files: [{ name: 'a.csv', base64: 'eA==' }] });
    expect(runner.getGeneration()).toBe(1);
    attach();
    expect(sent).toEqual([]);
    say({ type: 'ready' });
    expect(sent).toEqual([{ id: 'job-1', code: 'print(1)', files: [{ name: 'a.csv', base64: 'eA==' }] }]);
    say({ type: 'started', id: 'job-1' });
    say({ type: 'done', id: 'job-1', stdout: '1\n', stderr: '', result: null });
    await expect(first).resolves.toEqual({ stdout: '1\n', stderr: '', result: null });

    const second = runner.run({ code: 'x = 2\nx' });
    expect(sent.at(-1)).toEqual({ id: 'job-2', code: 'x = 2\nx', files: [] });
    say({ type: 'done', id: 'job-2', stdout: '', stderr: '', result: 2 });
    await expect(second).resolves.toMatchObject({ result: 2 });
    expect(runner.getGeneration()).toBe(1);
  });

  it('reads only its own page, and only answers for jobs it sent', async () => {
    const { runner, attach, say } = setup();
    let answered: CodeOutput | null = null;
    void runner.run({ code: 'pass' }).then((output) => (answered = output));
    attach();
    runner.receive('not json');
    runner.receive(JSON.stringify({ g: 99, type: 'ready' }));
    say({ type: 'done', id: 'job-1', stdout: 'too early' });
    await settle();
    expect(answered).toBeNull();
    say({ type: 'ready' });
    say({ type: 'done', id: 'job-7', stdout: 'not ours' });
    say({ type: 'done', id: 'job-1', stdout: 3, stderr: 'oops', result: [1] });
    await settle();
    expect(answered).toEqual({ stdout: '', stderr: 'oops', result: [1] });
  });

  it('stops code over the time limit, as the web does, and throws that Python away', async () => {
    const { runner, attach, say, fire } = setup();
    const job = runner.run({ code: 'while True: pass' });
    attach();
    say({ type: 'ready' });
    say({ type: 'started', id: 'job-1' });
    fire(RUN_LIMIT_MS);
    await expect(job).resolves.toEqual({ stdout: '', stderr: TIME_LIMIT_MESSAGE, result: null });
    expect(runner.getGeneration()).toBe(0);
  });

  it('starts a fresh Python for jobs queued behind one that ran too long', async () => {
    const { runner, sent, attach, say, fire } = setup();
    const slow = runner.run({ code: 'slow()' });
    const next = runner.run({ code: 'quick()' });
    attach();
    say({ type: 'ready' });
    expect(sent.map((job) => job.id)).toEqual(['job-1', 'job-2']);
    say({ type: 'started', id: 'job-1' });
    fire(RUN_LIMIT_MS);
    await expect(slow).resolves.toMatchObject({ stderr: TIME_LIMIT_MESSAGE });
    expect(runner.getGeneration()).toBe(2);
    // The old page can't answer for the new one.
    runner.receive(JSON.stringify({ g: 1, type: 'done', id: 'job-2', stdout: 'stale' }));
    attach();
    say({ type: 'ready' });
    expect(sent.map((job) => job.id)).toEqual(['job-1', 'job-2', 'job-2']);
    say({ type: 'done', id: 'job-2', stdout: 'fresh' });
    await expect(next).resolves.toMatchObject({ stdout: 'fresh' });
  });

  it('answers every job when Python cannot load, takes too long to load, or is ended', async () => {
    const failing = setup();
    const a = failing.runner.run({ code: '1' });
    const b = failing.runner.run({ code: '2' });
    failing.say({ type: 'failed', error: 'the server did not send Python' });
    await expect(a).resolves.toMatchObject({ stderr: "Python couldn't start: the server did not send Python" });
    await expect(b).resolves.toMatchObject({ stderr: "Python couldn't start: the server did not send Python" });
    expect(failing.runner.getGeneration()).toBe(0);

    const slow = setup();
    const c = slow.runner.run({ code: '1' });
    slow.fire(LOAD_LIMIT_MS);
    await expect(c).resolves.toMatchObject({ stderr: "Python didn't start in time. Check your connection and try again." });

    const ended = setup();
    const d = ended.runner.run({ code: '1' });
    ended.attach();
    ended.say({ type: 'ready' });
    ended.runner.ended();
    await expect(d).resolves.toMatchObject({ stderr: 'Python stopped: iOS ended it, often to free memory. Try again.' });
    expect(ended.runner.getGeneration()).toBe(0);
  });
});

describe('pythonPage', () => {
  it('loads Pyodide from the server and keeps its address and code inside the script', () => {
    const page = pythonPage('https://chat.example.com/pyodide/', 3);
    expect(page).toContain('var INDEX = "https://chat.example.com/pyodide/";');
    expect(page).toContain('var GENERATION = 3;');
    expect(page).toContain("script.src = INDEX + 'pyodide.js';");
    expect(pythonPage('https://x.test/</script><script>alert(1)</script>/pyodide/', 1)).not.toContain('</script><script>alert(1)');
  });
});
