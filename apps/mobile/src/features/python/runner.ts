import { uuidv4, type CodeOutput } from '@maviechat/owui-protocol';

/** A file put in `/mnt/uploads` before the code runs, as the web does for the code interpreter. */
export interface PythonFile {
  name: string;
  base64: string;
}

export interface PythonJob {
  code: string;
  files?: PythonFile[];
}

interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** How long code may run, as on the web; then its answer says so and that Python is thrown away. */
export const RUN_LIMIT_MS = 60_000;
/** How long loading Python, or the packages a job imports, may take (a phone may be on a slow network). */
export const LOAD_LIMIT_MS = 240_000;

export const TIME_LIMIT_MESSAGE = 'Execution Time Limit Exceeded';

interface Entry {
  job: PythonJob;
  resolve: (output: CodeOutput) => void;
  sent: boolean;
  timer: unknown;
}

/**
 * Runs Python for the app in a hidden web view (the host), one job at a time. The web view is
 * started on the first job and kept, so later jobs share Python's state, as the web's worker does;
 * a job over its time limit, or the web view ending, throws it away. Messages from the page are
 * the code's own output, so they are only ever read as data.
 */
export class PythonRunner {
  /** The host shows one web view per generation; 0 while none is wanted. Never reused, so an old page can't answer. */
  private generation = 0;
  private generations = 0;
  private ready = false;
  private inject: ((script: string) => void) | null = null;
  private loadTimer: unknown = null;
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly timers: Timers = realTimers,
    private readonly newId: () => string = uuidv4,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getGeneration = (): number => this.generation;

  run(job: PythonJob): Promise<CodeOutput> {
    return new Promise((resolve) => {
      const id = this.newId();
      this.entries.set(id, { job, resolve, sent: false, timer: null });
      if (this.generation === 0) this.start();
      else if (this.ready) this.send(id);
    });
  }

  /** The host's web view for the current generation, or null when it goes. */
  attach(inject: ((script: string) => void) | null): void {
    this.inject = inject;
    if (inject && this.ready) for (const key of [...this.entries.keys()]) this.send(key);
  }

  /** A message from the page. */
  receive(data: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!message || typeof message !== 'object' || message.g !== this.generation || this.generation === 0) return;
    const id = typeof message.id === 'string' ? message.id : '';
    const entry = this.entries.get(id);
    switch (message.type) {
      case 'ready':
        if (this.ready) return;
        this.ready = true;
        this.clearLoadTimer();
        for (const key of [...this.entries.keys()]) this.send(key);
        return;
      case 'failed':
        this.stopAll(`Python couldn't start: ${typeof message.error === 'string' ? message.error : 'unknown error'}`);
        return;
      case 'started':
        if (!entry?.sent) return;
        this.timers.clear(entry.timer);
        entry.timer = this.timers.set(() => this.expire(id, TIME_LIMIT_MESSAGE), RUN_LIMIT_MS);
        return;
      case 'done':
        if (!entry?.sent) return;
        this.timers.clear(entry.timer);
        this.entries.delete(id);
        entry.resolve({ stdout: text(message.stdout), stderr: text(message.stderr), result: message.result ?? null });
        return;
      default:
    }
  }

  /** The web view's process ended (iOS ends a hidden one to free memory). */
  ended(): void {
    if (this.generation === 0) return;
    this.stopAll('Python stopped: iOS ended it, often to free memory. Try again.');
  }

  /** Answers everything waiting and lets the web view go (signing out, switching account). */
  dispose(): void {
    this.stopAll('Python was stopped.');
  }

  private start(): void {
    this.generations += 1;
    this.generation = this.generations;
    this.ready = false;
    this.inject = null;
    this.clearLoadTimer();
    this.loadTimer = this.timers.set(() => this.stopAll("Python didn't start in time. Check your connection and try again."), LOAD_LIMIT_MS);
    this.emit();
  }

  private send(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.sent || !this.inject) return;
    entry.sent = true;
    entry.timer = this.timers.set(() => this.expire(id, 'Python took too long to load the packages this code needs.'), LOAD_LIMIT_MS);
    const job = { id, code: entry.job.code, files: entry.job.files ?? [] };
    this.inject(`window.mavieRun(${JSON.stringify(job)});true;`);
  }

  /** A job over its limit is answered, and this Python thrown away; any others start again in a fresh one. */
  private expire(id: string, message: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    entry.resolve({ stdout: '', stderr: message, result: null });
    for (const other of this.entries.values()) {
      this.timers.clear(other.timer);
      other.sent = false;
      other.timer = null;
    }
    if (this.entries.size) {
      this.start();
      return;
    }
    this.halt();
  }

  private stopAll(message: string): void {
    const waiting = [...this.entries.values()];
    this.entries.clear();
    for (const entry of waiting) {
      this.timers.clear(entry.timer);
      entry.resolve({ stdout: '', stderr: message, result: null });
    }
    this.halt();
  }

  private halt(): void {
    this.clearLoadTimer();
    this.ready = false;
    this.inject = null;
    if (this.generation !== 0) {
      this.generation = 0;
      this.emit();
    }
  }

  private clearLoadTimer(): void {
    if (this.loadTimer !== null) this.timers.clear(this.loadTimer);
    this.loadTimer = null;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
