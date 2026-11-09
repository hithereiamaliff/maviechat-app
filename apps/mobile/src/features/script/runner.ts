import { TOOL_SCRIPT_LIMIT_MS, toolScriptMessage } from '@maviechat/owui-protocol';

/** How a tool's code ended: its answer, or why there is none. */
export type ScriptOutcome = { ok: true; result: unknown } | { ok: false; error: string };

/** What the code asks of the person: a file it offers as a download, a page it opens. */
export interface ScriptEffects {
  file(name: string, dataUrl: string): void;
  open(url: string): void;
}

/** The run the host shows a page for, and its code. */
export interface ScriptRun {
  run: number;
  code: string;
}

interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Job {
  code: string;
  resolve: (outcome: ScriptOutcome) => void;
}

/**
 * Runs tools' JavaScript one at a time, each in a fresh sealed page: the host shows a web view
 * for the current run only and drops it after, so nothing carries from one run to the next. A
 * run over its time limit, or a page that stops, is answered with why. What a page sends is
 * read only as data, and only from the current run.
 */
export class ScriptRunner {
  private runs = 0;
  private current: (ScriptRun & { job: Job; timer: unknown }) | null = null;
  private snapshot: ScriptRun | null = null;
  private readonly queue: Job[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly effects: ScriptEffects,
    private readonly timers: Timers = realTimers,
    private readonly limitMs: number = TOOL_SCRIPT_LIMIT_MS,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The run being shown, or null; the same object until it changes (for useSyncExternalStore). */
  getCurrent = (): ScriptRun | null => this.snapshot;

  run(code: string): Promise<ScriptOutcome> {
    return new Promise((resolve) => {
      this.queue.push({ code, resolve });
      if (!this.current) this.next();
    });
  }

  /** A message from the current run's page. */
  receive(raw: string): void {
    const current = this.current;
    if (!current) return;
    const message = toolScriptMessage(raw, current.run);
    if (!message) return;
    if (message.type === 'done') this.finish({ ok: true, result: message.result });
    else if (message.type === 'error') this.finish({ ok: false, error: message.error });
    else if (message.type === 'file') this.effects.file(message.name, message.url);
    else this.effects.open(message.url);
  }

  /** The page asked to go to another address (a link, or `location`): offered as a page to open. */
  navigate(url: string): void {
    if (this.current && /^https?:\/\//i.test(url)) this.effects.open(url);
  }

  /** The current run's page stopped (the system ended it). */
  ended(): void {
    if (this.current) this.finish({ ok: false, error: 'The page it ran in stopped.' });
  }

  /** Every run waiting or running is answered, and nothing more runs. */
  dispose(): void {
    const waiting = [...this.queue.splice(0), ...(this.current ? [this.current.job] : [])];
    if (this.current) this.timers.clear(this.current.timer);
    this.current = null;
    this.snapshot = null;
    for (const job of waiting) job.resolve({ ok: false, error: 'The app closed the chat’s connection.' });
    this.emit();
  }

  private finish(outcome: ScriptOutcome): void {
    const current = this.current;
    if (!current) return;
    this.timers.clear(current.timer);
    this.current = null;
    current.job.resolve(outcome);
    this.next();
  }

  private next(): void {
    const job = this.queue.shift();
    if (!job) {
      this.snapshot = null;
      this.emit();
      return;
    }
    this.runs += 1;
    const run = this.runs;
    const timer = this.timers.set(() => {
      if (this.current?.run === run) this.finish({ ok: false, error: `It ran longer than ${Math.round(this.limitMs / 1000)} seconds and was stopped.` });
    }, this.limitMs);
    this.current = { run, code: job.code, job, timer };
    this.snapshot = { run, code: job.code };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
